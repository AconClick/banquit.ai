import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MastersService } from '../masters/masters.service.js';
import { Counter } from '../reservations/reservation.schema.js';
import { calculateBill, round2, type AType, type BillLineInput, type BillTotals, type Discount, type LineSource, type TaxRate } from './bill-engine.js';
import { Bill, BillDocument, BillLine, BillStatus, PAYMENT_MODES, type PaymentMode } from './bill.schema.js';
import { BOOKING_SOURCE, type BillingBooking, type BookingSource } from './booking-source.js';

export interface LineInput {
  /** Existing line to change; leave out for a new line. */
  id?: string;
  source: LineSource;
  label?: string;
  aType?: AType;
  kind?: string;
  itemId?: string;
  hallId?: string;
  actualPax?: number | null;
  qty?: number;
  rate?: number;
  taxInclusive?: boolean;
  /** Leave out to use the item's mapped taxes (or the property default for its A-Type). */
  taxIds?: string[];
  discount?: Discount | null;
  remark?: string;
}

export interface DraftInput {
  lines: LineInput[];
  billDiscount?: Discount | null;
}

export interface PaymentInput {
  kind?: 'payment' | 'refund';
  amount: number;
  mode: PaymentMode;
  date?: string;
  reference?: string;
}

/** A draft can be started from confirmation (to post running charges); finalising needs the function completed. */
const BILLABLE: string[] = ['confirmed', 'inFunction', 'completed'];
/** Lines added on the bill (running charges, hall hire, licence) can be changed freely while drafting. */
const ADDED: LineSource[] = ['running', 'hallHire', 'liquorLicence'];
/** Month the financial year starts (April). Series Setup will make this a per-property setting. */
const FINANCIAL_YEAR_START_MONTH = 4;

const today = () => new Date().toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hoursBetween = (start: string, end: string) => round2((Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 3_600_000);

/** Financial year label for a date, e.g. 2026-27 for 2026-10-01 when the year starts in April. */
export function financialYear(date: string, startMonth = FINANCIAL_YEAR_START_MONTH) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (startMonth === 1) return String(y);
  const first = m >= startMonth ? y : y - 1;
  return `${first}-${String((first + 1) % 100).padStart(2, '0')}`;
}

export const STATUS_LABELS: Record<BillStatus, string> = {
  draft: 'Draft', finalised: 'Final', partiallySettled: 'Partly settled', settled: 'Settled', void: 'Void',
};

/**
 * Banquet bills (docs/workflows/billing-stages.md): proforma, draft, final bill and settlement.
 * Bookings are read through BookingSource only.
 */
@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Bill.name) private readonly bills: Model<Bill>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    @Inject(BOOKING_SOURCE) private readonly source: BookingSource,
    private readonly masters: MastersService,
  ) {}

  /** Everything the bill screen needs for one booking: the booking, its bills, and the proforma. */
  async forReservation(tenantId: Types.ObjectId, reservationId: string) {
    const booking = await this.booking(tenantId, reservationId);
    const bills = await this.bills.find({ tenantId, reservationId }).sort({ createdAt: -1 });
    const current = bills.find((b) => b.status !== 'void') ?? null;
    return {
      booking: this.bookingView(booking),
      proforma: { ...(await this.source.proforma(tenantId, booking.id)), advances: round2(booking.receipts.reduce((s, r) => s + r.amount, 0)) },
      bill: current ? await this.view(tenantId, current, booking) : null,
      voided: bills.filter((b) => b.status === 'void').map((b) => ({ id: b.id as string, number: b.number ?? null, voidReason: b.voidReason ?? '' })),
    };
  }

  async list(tenantId: Types.ObjectId, filter: { propertyId?: string; status?: string; from?: string; to?: string }) {
    const q: Record<string, unknown> = { tenantId };
    if (filter.propertyId) q.propertyId = filter.propertyId;
    if (filter.status) q.status = filter.status;
    if (filter.from || filter.to) {
      q.functionDate = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}) };
    }
    const bills = await this.bills.find(q).sort({ functionDate: -1, createdAt: -1 }).limit(500);
    return bills.map((b) => {
      const totals = b.totals ?? null;
      return {
        id: b.id as string, number: b.number ?? null, status: b.status, reservationId: b.reservationId,
        reservationNumber: b.reservationNumber, hostName: b.hostName, functionDate: b.functionDate, propertyId: b.propertyId,
        total: totals?.total ?? null, balance: totals ? this.balance(b, totals.total) : null,
      };
    });
  }

  async get(tenantId: Types.ObjectId, id: string) {
    const bill = Types.ObjectId.isValid(id) ? await this.bills.findOne({ tenantId, _id: id }) : null;
    if (!bill) throw new NotFoundException('Bill not found.');
    return bill;
  }

  async getView(tenantId: Types.ObjectId, id: string) {
    const bill = await this.get(tenantId, id);
    return this.view(tenantId, bill, await this.booking(tenantId, bill.reservationId));
  }

  /** Stage 5 starts: a draft built from the booking's packages and pre-booked extras. */
  async createDraft(tenantId: Types.ObjectId, userId: string, reservationId: string) {
    const booking = await this.booking(tenantId, reservationId);
    if (!BILLABLE.includes(booking.status)) throw new BadRequestException('Only a confirmed booking can be billed.');
    if (await this.bills.exists({ tenantId, reservationId, status: { $ne: 'void' } })) {
      throw new ConflictException(`${booking.number} already has a bill.`);
    }
    const lines = await this.bookingLines(tenantId, booking);
    const bill = await this.bills.create({
      tenantId,
      propertyId: booking.propertyId,
      reservationId: booking.id,
      reservationNumber: booking.number,
      hostName: booking.hostName,
      functionDate: booking.functionDate,
      status: 'draft',
      lines,
      roundTotal: await this.source.roundTotal(tenantId, booking.propertyId),
      history: [{ action: 'Draft created', at: new Date(), byUserId: userId }],
    });
    return this.view(tenantId, bill, booking);
  }

  /** Saves the draft's lines and discounts. Package and booked lines keep their agreed rate. */
  async saveDraft(tenantId: Types.ObjectId, userId: string, id: string, input: DraftInput) {
    const bill = await this.get(tenantId, id);
    if (bill.status !== 'draft') throw new BadRequestException('Only a draft bill can be changed. Void it and draft again to correct a final bill.');
    if (!input || !Array.isArray(input.lines)) throw new BadRequestException('Invalid bill.');
    const booking = await this.booking(tenantId, bill.reservationId);
    const problems: string[] = [];
    const existing = new Map(bill.lines.map((l) => [l.id, l]));
    const lines: BillLine[] = [];
    const seen = new Set<string>();

    for (const [n, raw] of input.lines.entries()) {
      const where = `Line ${n + 1}`;
      const old = raw?.id ? existing.get(raw.id) : undefined;
      if (raw?.id && !old) { problems.push(`${where}: not on this bill.`); continue; }
      if (old && seen.has(old.id)) { problems.push(`${where}: listed twice.`); continue; }
      if (old) seen.add(old.id);
      const line = old ? this.changeLine(old, raw, where, problems) : await this.newLine(tenantId, booking, raw, where, problems, bill.lines.length + n + 1);
      if (!line) continue;
      line.taxIds = await this.taxIds(tenantId, booking.propertyId, line, raw.taxIds, where, problems);
      line.discount = this.discount(raw.discount, line.discount, `${line.label}: discount`, problems);
      lines.push(line);
    }
    for (const l of bill.lines) {
      if (l.source === 'package' && !seen.has(l.id)) problems.push(`${l.label} is a booked package and cannot be removed from the bill.`);
    }
    const billDiscount = this.discount(input.billDiscount, null, 'Bill discount', problems);
    if (problems.length) throw new BadRequestException([...new Set(problems)]);

    bill.lines = lines;
    bill.billDiscount = billDiscount;
    bill.history.push({ action: 'Draft saved', at: new Date(), byUserId: userId });
    await bill.save();
    return this.view(tenantId, bill, booking);
  }

  /** Re-reads package and booked lines from the booking (after an amendment), keeping actual pax and lines added on the bill. */
  async refreshDraft(tenantId: Types.ObjectId, userId: string, id: string) {
    const bill = await this.get(tenantId, id);
    if (bill.status !== 'draft') throw new BadRequestException('Only a draft bill can be refreshed.');
    const booking = await this.booking(tenantId, bill.reservationId);
    const fresh = await this.bookingLines(tenantId, booking);
    for (const line of fresh) {
      const old = bill.lines.find((l) => l.source === line.source && l.kind === line.kind && l.itemId === line.itemId);
      if (old) {
        line.id = old.id;
        line.actualPax = old.actualPax ?? line.actualPax;
        line.discount = old.discount;
        line.remark = old.remark;
        if (line.source === 'extra') line.qty = old.qty;
      }
    }
    bill.lines = [...fresh, ...bill.lines.filter((l) => ADDED.includes(l.source))];
    bill.hostName = booking.hostName;
    bill.functionDate = booking.functionDate;
    bill.history.push({ action: 'Refreshed from booking', at: new Date(), byUserId: userId });
    await bill.save();
    return this.view(tenantId, bill, booking);
  }

  /** Stage 7: bill number, locked lines and tax rates, advances applied. */
  async finalise(tenantId: Types.ObjectId, userId: string, id: string) {
    const bill = await this.get(tenantId, id);
    if (bill.status !== 'draft') throw new BadRequestException('Only a draft bill can be finalised.');
    const booking = await this.booking(tenantId, bill.reservationId);
    const problems: string[] = [];
    if (booking.status !== 'completed') problems.push('Complete the function (with its actual pax) on the booking before finalising the bill.');
    if (bill.lines.length === 0) problems.push('Add at least one line before finalising.');
    for (const l of bill.lines) {
      if (l.source === 'package' && (l.actualPax === null || l.actualPax === undefined)) problems.push(`${l.label}: enter the actual pax.`);
    }
    if (problems.length) throw new BadRequestException(problems);

    const rates = await this.taxRates(tenantId, bill);
    const advances = booking.receipts.filter((r) => r.amount > 0).map((r) => ({ number: r.number, date: r.date, amount: round2(r.amount), mode: r.mode }));
    const totals = calculateBill(this.engineInput(bill, rates, booking, advances.reduce((s, a) => s + a.amount, 0)));
    const fy = financialYear(today());
    const seq = await this.next(tenantId, `bill:${bill.propertyId}:${fy}`);
    const number = `B/${fy}/${String(seq).padStart(6, '0')}`;
    const status = this.statusFor(totals.balance, advances.length > 0);

    const done = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, status: 'draft' },
      {
        $set: {
          status, number, finalisedAt: new Date(), advances, taxRates: Object.fromEntries(rates),
          totals: this.storedTotals(totals),
        },
        $push: { history: { action: `Finalised as ${number}`, at: new Date(), byUserId: userId } },
      },
      { returnDocument: 'after' },
    );
    if (!done) throw new ConflictException('This bill was changed by someone else. Reload it and try again.');
    if (status === 'settled') await this.source.markBilled(tenantId, done.reservationId, userId, number);
    return this.view(tenantId, done, booking);
  }

  /** Stage 8: a payment against the balance, or a refund of excess advances. */
  async addPayment(tenantId: Types.ObjectId, userId: string, id: string, input: PaymentInput) {
    const bill = await this.get(tenantId, id);
    if (bill.status !== 'finalised' && bill.status !== 'partiallySettled') throw new BadRequestException('Payments are taken on a final bill that is not yet settled.');
    const kind = input.kind ?? 'payment';
    const balance = this.balance(bill, bill.totals!.total);
    const problems: string[] = [];
    if (kind !== 'payment' && kind !== 'refund') problems.push('Choose payment or refund.');
    if (!isMoney(input.amount) || input.amount <= 0) problems.push('Amount must be more than 0.');
    else if (kind === 'payment' && round2(input.amount) > balance) problems.push(balance > 0 ? `The balance is ${balance.toFixed(2)}; take no more than that.` : 'Nothing is left to collect on this bill.');
    else if (kind === 'refund' && round2(input.amount) > -balance) problems.push(balance < 0 ? `Only ${(-balance).toFixed(2)} is due back to the guest.` : 'Nothing is due back to the guest.');
    if (!(PAYMENT_MODES as readonly string[]).includes(input.mode)) problems.push('Choose how the money was paid.');
    const date = input.date || today();
    if (!DATE.test(date) || date > today()) problems.push('Date must be today or earlier.');
    if (problems.length) throw new BadRequestException(problems);

    const seq = await this.next(tenantId, kind === 'refund' ? 'billRefund' : 'billPayment');
    const payment = {
      number: `${kind === 'refund' ? 'RF' : 'PY'}-${String(seq).padStart(6, '0')}`, kind, date, amount: round2(input.amount),
      mode: input.mode, reference: text(input.reference, 100), byUserId: userId, at: new Date(),
    };
    const after = this.balance({ advances: bill.advances, payments: [...bill.payments, payment] }, bill.totals!.total);
    const status = this.statusFor(after, true);
    // Matching on the number of payments stops two people settling the same balance at once.
    const done = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, status: bill.status, [`payments.${bill.payments.length}`]: { $exists: false } },
      {
        $push: { payments: payment, history: { action: `${kind === 'refund' ? 'Refund' : 'Payment'} ${payment.number}`, at: new Date(), byUserId: userId } },
        $set: { status },
      },
      { returnDocument: 'after' },
    );
    if (!done) throw new ConflictException('This bill was changed by someone else. Reload it and try again.');
    if (status === 'settled') await this.source.markBilled(tenantId, done.reservationId, userId, done.number!);
    return this.getView(tenantId, id);
  }

  /** Void a draft, or a final bill nobody has paid against yet. The booking can then be billed again. */
  async void(tenantId: Types.ObjectId, userId: string, id: string, reason: string) {
    const bill = await this.get(tenantId, id);
    const why = text(reason, 300);
    if (!why) throw new BadRequestException('Give a reason for voiding the bill.');
    if (bill.status === 'void') throw new BadRequestException('This bill is already void.');
    if (bill.payments.length > 0 || bill.status === 'settled') {
      throw new BadRequestException('Payments have been taken against this bill, so it cannot be voided. Refund them first.');
    }
    const done = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, status: bill.status, payments: { $size: 0 } },
      { $set: { status: 'void', voidReason: why }, $push: { history: { action: 'Voided', at: new Date(), byUserId: userId, note: why } } },
      { returnDocument: 'after' },
    );
    if (!done) throw new ConflictException('This bill was changed by someone else. Reload it and try again.');
    return this.view(tenantId, done, await this.booking(tenantId, done.reservationId));
  }

  // ---- building and pricing ----

  private async booking(tenantId: Types.ObjectId, reservationId: string) {
    const booking = await this.source.booking(tenantId, reservationId);
    if (!booking) throw new NotFoundException('Reservation not found.');
    return booking;
  }

  private async bookingLines(tenantId: Types.ObjectId, booking: BillingBooking): Promise<BillLine[]> {
    const lines: BillLine[] = [];
    const defaults = await this.source.taxDefaults(tenantId, booking.propertyId);
    // The booking's actual pax (entered when the function is completed) fills a single package line.
    const actual = booking.packages.length === 1 ? booking.actualPax : null;
    let n = 0;
    for (const p of booking.packages) {
      lines.push({
        id: `L${++n}`, source: 'package', aType: 'package', label: p.name, kind: 'package', itemId: p.packageId,
        guaranteedPax: p.pax, actualPax: actual, qty: p.pax, rate: p.rate, taxInclusive: p.taxInclusive,
        taxIds: defaults({ aType: 'package', kind: 'package', itemId: p.packageId }),
        discount: null, remark: '',
      });
    }
    for (const e of booking.extras) {
      lines.push({
        id: `L${++n}`, source: 'extra', aType: e.aType, label: e.name, kind: e.kind, itemId: e.itemId,
        actualPax: null, qty: e.qty, rate: e.rate, taxInclusive: e.taxInclusive,
        taxIds: defaults({ aType: e.aType, kind: e.kind, itemId: e.itemId }),
        discount: null, remark: '',
      });
    }
    return lines;
  }

  /** Changes allowed on a line already on the draft. */
  private changeLine(old: BillLine, raw: LineInput, where: string, problems: string[]): BillLine {
    // Lines are Mongoose sub-documents; copy their plain values.
    const plain = (old as BillLine & { toObject?: () => BillLine }).toObject?.() ?? old;
    const line: BillLine = { ...plain, remark: raw.remark !== undefined ? text(raw.remark, 200) : old.remark };
    if (raw.source !== undefined && raw.source !== old.source) problems.push(`${where}: a line cannot change type.`);
    if (old.source === 'package') {
      if (raw.actualPax !== undefined) {
        if (raw.actualPax !== null && (!Number.isInteger(raw.actualPax) || raw.actualPax < 0)) problems.push(`${old.label}: actual pax must be a whole number of 0 or more.`);
        else line.actualPax = raw.actualPax;
      }
      return line;
    }
    if (raw.qty !== undefined) {
      if (!isMoney(raw.qty) || raw.qty <= 0) problems.push(`${old.label}: quantity must be more than 0.`);
      else line.qty = round2(raw.qty);
    }
    if (ADDED.includes(old.source)) {
      if (raw.rate !== undefined) {
        if (!isMoney(raw.rate)) problems.push(`${old.label}: rate must be 0 or more.`);
        else line.rate = round2(raw.rate);
      }
      if (raw.taxInclusive !== undefined) line.taxInclusive = raw.taxInclusive === true;
      if (raw.label !== undefined && old.source === 'running' && !old.itemId) {
        const label = text(raw.label, 120);
        if (!label) problems.push(`${where}: describe the charge.`);
        else line.label = label;
      }
    }
    return line;
  }

  /** A line added on the bill: a running charge, hall hire or liquor licence. */
  private async newLine(tenantId: Types.ObjectId, booking: BillingBooking, raw: LineInput, where: string, problems: string[], seq: number): Promise<BillLine | null> {
    if (!raw || !ADDED.includes(raw.source)) {
      problems.push(`${where}: only running charges, hall hire and liquor licence can be added on the bill. Packages come from the booking.`);
      return null;
    }
    if (!isMoney(raw.qty) || raw.qty <= 0) problems.push(`${where}: quantity must be more than 0.`);
    if (raw.rate !== undefined && !isMoney(raw.rate)) problems.push(`${where}: rate must be 0 or more.`);
    const base = {
      id: `N${seq}-${new Types.ObjectId().toHexString().slice(-6)}`, source: raw.source, actualPax: null,
      qty: isMoney(raw.qty) ? round2(raw.qty) : 0, rate: isMoney(raw.rate) ? round2(raw.rate) : 0,
      taxInclusive: raw.taxInclusive === true, taxIds: [], discount: null, remark: text(raw.remark, 200),
    };

    if (raw.source === 'hallHire') {
      const slot = booking.slots.find((s) => s.hallId === raw.hallId);
      if (!slot) { problems.push(`${where}: choose a hall on this booking.`); return null; }
      const hall = await this.masters.get(tenantId, 'hall', slot.hallId).catch(() => null);
      return { ...base, aType: 'services', label: `Hall hire: ${String(hall?.values.description ?? 'Hall')}`, hallId: slot.hallId };
    }
    if (raw.source === 'liquorLicence') {
      return { ...base, aType: 'services', label: text(raw.label, 120) || 'Liquor licence' };
    }
    // Running charge: a menu item or modifier from the masters, or a described charge.
    if (raw.itemId) {
      const kind = raw.kind === 'modifier' ? 'modifier' : 'menuItem';
      const item = await this.masters.get(tenantId, kind, raw.itemId).catch(() => null);
      if (!item?.active) { problems.push(`${where}: choose an active item.`); return null; }
      const aType = kind === 'modifier' ? 'alacarte' : (item.values.aType as AType);
      if (aType === 'package') { problems.push(`${where}: package items are billed through the package.`); return null; }
      const rate = raw.rate !== undefined ? base.rate : round2((kind === 'modifier' ? item.values.rate : item.values.defaultRate) as number);
      return { ...base, rate, aType, kind, itemId: item.id as string, label: String(item.values.description) };
    }
    const label = text(raw.label, 120);
    if (!label) problems.push(`${where}: choose an item or describe the charge.`);
    if (raw.aType !== 'alacarte' && raw.aType !== 'services') problems.push(`${where}: choose Ala-carte or Services.`);
    if (raw.rate === undefined) problems.push(`${where}: enter a rate.`);
    return { ...base, aType: raw.aType === 'services' ? 'services' : 'alacarte', label };
  }

  private async taxIds(tenantId: Types.ObjectId, propertyId: string, line: BillLine, given: string[] | undefined, where: string, problems: string[]) {
    if (given === undefined) {
      if (line.taxIds.length || line.source === 'package' || line.source === 'extra') return line.taxIds;
      return (await this.source.taxDefaults(tenantId, propertyId))({ aType: line.aType, kind: line.kind, itemId: line.itemId });
    }
    if (!Array.isArray(given)) { problems.push(`${where}: taxes must be a list.`); return line.taxIds; }
    const ids = [...new Set(given)];
    for (const id of ids) {
      const tax = typeof id === 'string' ? await this.masters.get(tenantId, 'tax', id).catch(() => null) : null;
      if (!tax?.active || !(tax.values.propertyIds as string[]).includes(propertyId)) problems.push(`${line.label}: choose active taxes set up for this property.`);
    }
    return ids;
  }

  private discount(raw: Discount | null | undefined, current: { type: 'percent' | 'amount'; value: number; reason: string } | null, label: string, problems: string[]) {
    if (raw === undefined) return current;
    if (raw === null || raw.value === 0) return null;
    if (raw.type !== 'percent' && raw.type !== 'amount') { problems.push(`${label}: choose percent or amount.`); return current; }
    if (!isMoney(raw.value) || (raw.type === 'percent' && raw.value > 100)) { problems.push(`${label}: enter a ${raw.type === 'percent' ? 'percentage from 0 to 100' : 'positive amount'}.`); return current; }
    const reason = text(raw.reason, 200);
    if (!reason) { problems.push(`${label}: give a reason.`); return current; }
    return { type: raw.type, value: round2(raw.value), reason };
  }

  /** Tax rates for every tax on the bill, valid on the function date. Taxes not valid then are left out. */
  private async taxRates(tenantId: Types.ObjectId, bill: Pick<Bill, 'lines' | 'functionDate' | 'taxRates' | 'propertyId'>): Promise<Map<string, TaxRate>> {
    if (bill.taxRates) return new Map(Object.entries(bill.taxRates));
    const ids = [...new Set(bill.lines.flatMap((l) => l.taxIds))];
    const rates = await this.source.taxRates(tenantId, bill.propertyId, ids, bill.functionDate);
    return new Map(rates.map((t) => [t.id, t]));
  }

  private engineInput(bill: Pick<Bill, 'lines' | 'billDiscount' | 'roundTotal'>, rates: Map<string, TaxRate>, booking: BillingBooking | null, advances: number, paid = 0) {
    const lines: BillLineInput[] = bill.lines.map((l) => ({
      id: l.id, source: l.source, aType: l.aType, label: l.label, guaranteedPax: l.guaranteedPax, actualPax: l.actualPax,
      qty: l.qty, rate: l.rate, taxInclusive: l.taxInclusive, discount: l.discount,
      taxes: l.taxIds.map((id) => rates.get(id)).filter((t): t is TaxRate => !!t),
    }));
    return { lines, billDiscount: bill.billDiscount, roundTotal: bill.roundTotal, advances, paid, expectedMaxPax: booking?.expectedMaxPax };
  }

  private paidOf(payments: { kind: string; amount: number }[]) {
    return round2(payments.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0));
  }

  private balance(bill: { advances: { amount: number }[]; payments: { kind: string; amount: number }[] }, total: number) {
    return round2(total - bill.advances.reduce((s, a) => s + a.amount, 0) - this.paidOf(bill.payments));
  }

  private statusFor(balance: number, anyMoney: boolean): BillStatus {
    if (balance === 0) return 'settled';
    return anyMoney ? 'partiallySettled' : 'finalised';
  }

  private storedTotals(t: BillTotals) {
    const { lines, amount, discount, taxable, taxes, taxTotal, roundOff, total } = t;
    return { lines, amount, discount, taxable, taxes, taxTotal, roundOff, total };
  }

  /** Priced lines with what the screen needs to edit them. */
  private withLineDetails(totals: BillTotals, lines: BillLine[]) {
    const byId = new Map(lines.map((l) => [l.id, l]));
    return {
      ...totals,
      lines: totals.lines.map((p) => {
        const l = byId.get(p.id);
        return { ...p, kind: l?.kind ?? null, itemId: l?.itemId ?? null, hallId: l?.hallId ?? null, taxIds: l?.taxIds ?? [], lineDiscount: l?.discount ?? null, remark: l?.remark ?? '' };
      }),
    };
  }

  private async view(tenantId: Types.ObjectId, bill: BillDocument, booking: BillingBooking | null) {
    let totals: BillTotals;
    const advances = bill.status === 'draft'
      ? round2((booking?.receipts ?? []).reduce((s, r) => s + r.amount, 0))
      : round2(bill.advances.reduce((s, a) => s + a.amount, 0));
    const paid = this.paidOf(bill.payments);
    if (bill.totals) {
      totals = { ...bill.totals, advances, paid, balance: round2(bill.totals.total - advances - paid), warnings: [] };
    } else {
      totals = calculateBill(this.engineInput(bill, await this.taxRates(tenantId, bill), booking, advances, paid));
    }
    return {
      id: bill.id as string,
      number: bill.number ?? null,
      status: bill.status,
      reservationId: bill.reservationId,
      reservationNumber: bill.reservationNumber,
      propertyId: bill.propertyId,
      hostName: bill.hostName,
      functionDate: bill.functionDate,
      roundTotal: bill.roundTotal,
      billDiscount: bill.billDiscount ?? null,
      finalisedAt: bill.finalisedAt ?? null,
      voidReason: bill.voidReason ?? null,
      advanceReceipts: bill.status === 'draft'
        ? (booking?.receipts ?? []).map((r) => ({ number: r.number, date: r.date, amount: r.amount, mode: r.mode }))
        : bill.advances.map((a) => ({ number: a.number, date: a.date, amount: a.amount, mode: a.mode })),
      payments: bill.payments.map((p) => ({ number: p.number, kind: p.kind, date: p.date, amount: p.amount, mode: p.mode, reference: p.reference })),
      history: bill.history.map((h) => ({ action: h.action, at: h.at, byUserId: h.byUserId, note: h.note ?? null })),
      ...this.withLineDetails(totals, bill.lines),
    };
  }

  private bookingView(b: BillingBooking) {
    return {
      id: b.id, number: b.number, status: b.status, propertyId: b.propertyId, hostName: b.hostName, contactName: b.contactName,
      phone: b.phone, email: b.email, functionDate: b.functionDate, guaranteedPax: b.guaranteedPax, expectedMaxPax: b.expectedMaxPax,
      halls: b.slots.map((s) => ({ hallId: s.hallId, start: s.start, end: s.end, hours: hoursBetween(s.start, s.end) })),
    };
  }

  private async next(tenantId: Types.ObjectId, name: string) {
    const c = await this.counters.findOneAndUpdate({ tenantId, name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    return c!.seq;
  }
}
