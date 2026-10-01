import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MastersService, type PackageGroup } from '../masters/masters.service.js';
import { PricingService, type PricedItem } from '../pricing/pricing.service.js';
import { proforma, round2, type PriceLine, type Proforma } from '../pricing/proforma.js';
import { slabFor, type PropertySettingsValues } from '../pricing/settings.js';
import { addDays, isDate } from './local-time.js';
import { Counter, ExtraLine, PackageLine, ReservationDocument, SETTLEMENT_MODES, type SettlementMode } from './reservation.schema.js';

export interface MenuInput {
  packages: { packageId: string; pax: number; choices: string[] }[];
  extras: { kind: 'menuItem' | 'modifier'; itemId: string; qty: number; note?: string }[];
}

export interface ReceiptInput {
  amount: number;
  mode: SettlementMode;
  date?: string;
  reference?: string;
}

/** Statuses that can still be cancelled with a charge (enquiries and waitlist never pay one). */
const CHARGEABLE = ['provisional', 'confirmed'];

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const functionDate = (r: ReservationDocument) => r.slots.map((s) => s.start.slice(0, 10)).sort()[0];

/**
 * Everything on a booking beyond the diary: package menus, extras, the proforma estimate,
 * advances and cancellation charges (docs/workflows/billing-stages.md, stages 1 and 2).
 */
@Injectable()
export class BookingDetailsService {
  constructor(
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly masters: MastersService,
    private readonly pricing: PricingService,
  ) {}

  /** Proforma on guaranteed pax at the agreed rates, with the taxes valid on the function date. */
  async quote(tenantId: Types.ObjectId, r: ReservationDocument): Promise<{ proforma: Proforma; settings: PropertySettingsValues }> {
    const [settings, sheet] = await Promise.all([this.pricing.settings(tenantId, r.propertyId), this.pricing.rateSheet(tenantId, r.propertyId)]);
    const onDate = functionDate(r);
    const mapping = (kind: string, id: string) => sheet.find((i) => i.kind === kind && i.id === id)?.taxIds ?? null;
    const lines: PriceLine[] = [];
    for (const p of r.packages) {
      const taxes = await this.pricing.taxesFor(tenantId, r.propertyId, { aType: 'package', taxIds: mapping('package', p.packageId) }, onDate);
      lines.push({ label: p.name, aType: 'package', qty: p.pax, rate: p.rate, taxInclusive: p.taxInclusive, taxes });
    }
    for (const e of r.extras) {
      const taxes = await this.pricing.taxesFor(tenantId, r.propertyId, { aType: e.aType, taxIds: mapping(e.kind, e.itemId) }, onDate);
      lines.push({ label: e.name, aType: e.aType, qty: e.qty, rate: e.rate, taxInclusive: e.taxInclusive, taxes });
    }
    return { proforma: proforma(lines, settings.roundTotal), settings };
  }

  paid(r: ReservationDocument) {
    return round2(r.receipts.reduce((s, x) => s + x.amount, 0));
  }

  /** Advance needed to confirm, and the second instalment, from the property settings. */
  advance(r: ReservationDocument, total: number, settings: PropertySettingsValues) {
    const paid = this.paid(r);
    const required = round2((total * settings.advancePercent) / 100);
    const second = settings.secondInstalmentPercent > 0
      ? { amount: round2((total * settings.secondInstalmentPercent) / 100), dueDate: addDays(functionDate(r), -settings.secondInstalmentDaysBefore) }
      : null;
    return { percent: settings.advancePercent, required, paid, shortBy: round2(Math.max(0, required - paid)), secondInstalment: second };
  }

  /** What cancelling today would cost, or null when no charge applies. */
  cancellationPreview(r: ReservationDocument, total: number, settings: PropertySettingsValues) {
    if (!CHARGEABLE.includes(r.status)) return null;
    const daysBefore = daysBetween(today(), functionDate(r));
    const slab = slabFor(settings.cancellationSlabs, daysBefore);
    const computed = round2((total * slab.percent) / 100);
    return { daysBefore, percent: slab.percent, computed, ...this.split(computed, this.paid(r)) };
  }

  split(charge: number, paid: number) {
    const retained = round2(Math.min(paid, charge));
    return { charge, retained, refundDue: round2(paid - retained), balanceDue: round2(charge - retained) };
  }

  async details(tenantId: Types.ObjectId, r: ReservationDocument) {
    const { proforma: quote, settings } = await this.quote(tenantId, r);
    const items = await this.masters.list(tenantId, 'menuItem', true);
    const itemName = new Map(items.map((i) => [i.id as string, String(i.values.description)]));
    return {
      packages: r.packages.map((p) => ({
        packageId: p.packageId, name: p.name, pax: p.pax, rate: p.rate, taxInclusive: p.taxInclusive,
        choices: p.choices.map((id) => ({ id, name: itemName.get(id) ?? '(removed item)' })),
      })),
      extras: r.extras.map((e) => ({ kind: e.kind, itemId: e.itemId, name: e.name, aType: e.aType, qty: e.qty, rate: e.rate, taxInclusive: e.taxInclusive, note: e.note })),
      receipts: r.receipts.map((x) => ({ number: x.number, date: x.date, amount: x.amount, mode: x.mode, reference: x.reference, at: x.at })),
      proforma: quote,
      advance: this.advance(r, quote.total, settings),
      cancellation: r.cancellation
        ? { daysBefore: r.cancellation.daysBefore, percent: r.cancellation.percent, computed: r.cancellation.computed, charge: r.cancellation.charge,
          retained: r.cancellation.retained, refundDue: r.cancellation.refundDue, balanceDue: r.cancellation.balanceDue }
        : null,
      cancellationPreview: this.cancellationPreview(r, quote.total, settings),
      menuWarnings: await this.menuWarnings(tenantId, r),
      guaranteeCutoff: this.cutoff(r, settings),
    };
  }

  /** Packages and extras this booking's property offers, with the menu choices for each package. */
  async menuOptions(tenantId: Types.ObjectId, propertyId: string) {
    const [sheet, items, subGroups] = await Promise.all([
      this.pricing.rateSheet(tenantId, propertyId),
      this.masters.list(tenantId, 'menuItem', false),
      this.masters.list(tenantId, 'subGroup', false),
    ]);
    const itemName = new Map(items.map((i) => [i.id as string, String(i.values.description)]));
    const subName = new Map(subGroups.map((g) => [g.id as string, String(g.values.description)]));
    const offered = sheet.filter((i) => i.offered);
    return {
      packages: offered.filter((i) => i.kind === 'package').map((p) => ({
        id: p.id, code: p.code, name: p.name, rate: p.rate, taxInclusive: p.taxInclusive,
        groups: (p.groups ?? []).map((g) => ({
          subGroupId: g.subGroupId, name: subName.get(g.subGroupId) ?? '', min: g.min, max: g.max,
          items: g.itemIds.filter((id) => itemName.has(id)).map((id) => ({ id, name: itemName.get(id)! })),
        })),
      })),
      extras: offered.filter((i) => i.kind !== 'package').map((e) => ({
        kind: e.kind, id: e.id, code: e.code, name: e.name, aType: e.aType, unit: e.unit, rate: e.rate, taxInclusive: e.taxInclusive,
      })),
    };
  }

  /** Replaces the packages and extras. Lines already on the booking keep their agreed rate. */
  async applyMenu(tenantId: Types.ObjectId, r: ReservationDocument, input: MenuInput) {
    if (!input || !Array.isArray(input.packages) || !Array.isArray(input.extras)) throw new BadRequestException('Invalid menu.');
    const sheet = await this.pricing.rateSheet(tenantId, r.propertyId);
    const find = (kind: string, id: string): PricedItem | undefined => sheet.find((i) => i.kind === kind && i.id === id && i.offered);
    const problems: string[] = [];

    const packages: PackageLine[] = [];
    for (const [n, line] of input.packages.entries()) {
      const item = find('package', line?.packageId);
      if (!item) { problems.push(`Package ${n + 1}: not offered at this property.`); continue; }
      if (!Number.isInteger(line.pax) || line.pax < 1) problems.push(`${item.name}: pax must be a whole number of at least 1.`);
      const choices = [...new Set(Array.isArray(line.choices) ? line.choices : [])];
      const groups = item.groups ?? [];
      for (const c of choices) {
        if (!groups.some((g) => g.itemIds.includes(c))) problems.push(`${item.name}: a chosen item is not part of this package.`);
      }
      for (const g of groups) {
        const picked = choices.filter((c) => g.itemIds.includes(c)).length;
        if (picked > g.max) problems.push(`${item.name}: pick at most ${g.max} from one of its groups (you picked ${picked}).`);
      }
      const existing = r.packages.find((p) => p.packageId === item.id);
      packages.push({
        packageId: item.id, name: item.name, pax: line.pax, choices,
        rate: existing?.rate ?? item.rate, taxInclusive: existing?.taxInclusive ?? item.taxInclusive,
      });
    }
    const extras: ExtraLine[] = [];
    for (const [n, line] of input.extras.entries()) {
      const item = find(line?.kind, line?.itemId);
      if (!item) { problems.push(`Extra ${n + 1}: not offered at this property.`); continue; }
      if (typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0) problems.push(`${item.name}: quantity must be more than 0.`);
      const existing = r.extras.find((e) => e.kind === item.kind && e.itemId === item.id);
      extras.push({
        kind: item.kind as ExtraLine['kind'], itemId: item.id, name: item.name, aType: item.aType as ExtraLine['aType'],
        qty: Math.round(line.qty * 100) / 100, note: typeof line.note === 'string' ? line.note.trim().slice(0, 200) : '',
        rate: existing?.rate ?? item.rate, taxInclusive: existing?.taxInclusive ?? item.taxInclusive,
      });
    }
    if (problems.length) throw new BadRequestException([...new Set(problems)]);
    r.packages = packages;
    r.extras = extras;
  }

  async addReceipt(tenantId: Types.ObjectId, userId: string, r: ReservationDocument, input: ReceiptInput) {
    const problems: string[] = [];
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) problems.push('Amount must be more than 0.');
    if (!SETTLEMENT_MODES.includes(input.mode)) problems.push('Choose how the money was paid.');
    const date = input.date || today();
    if (!isDate(date) || date > today()) problems.push('Receipt date must be today or earlier.');
    if (problems.length) throw new BadRequestException(problems);
    const c = await this.counters.findOneAndUpdate({ tenantId, name: 'receipt' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    r.receipts.push({
      number: `RC-${String(c!.seq).padStart(6, '0')}`, date, amount: round2(input.amount), mode: input.mode,
      reference: (input.reference ?? '').trim().slice(0, 100), byUserId: userId, at: new Date(),
    });
  }

  /** The moment after which menu and guarantee are frozen. */
  cutoff(r: ReservationDocument, settings: PropertySettingsValues) {
    const first = r.slots.map((s) => s.start).sort()[0];
    const at = new Date(Date.parse(`${first}:00Z`) - settings.guaranteeCutoffHours * 3_600_000);
    return at.toISOString().slice(0, 16);
  }

  /** Packages whose menu still needs more choices. Not an error: menus are often finalised later. */
  private async menuWarnings(tenantId: Types.ObjectId, r: ReservationDocument) {
    const warnings: string[] = [];
    for (const p of r.packages) {
      const pkg = await this.masters.get(tenantId, 'package', p.packageId).catch(() => null);
      for (const g of (pkg?.values.groups as PackageGroup[] | undefined) ?? []) {
        const picked = p.choices.filter((c) => g.itemIds.includes(c)).length;
        if (picked < g.min) {
          const sub = await this.masters.get(tenantId, 'subGroup', g.subGroupId).catch(() => null);
          warnings.push(`${p.name}: choose ${g.min - picked} more from ${String(sub?.values.description ?? 'a group')}.`);
        }
      }
    }
    return warnings;
  }
}
