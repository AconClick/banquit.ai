import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { MasterRecordDocument } from '../masters/master-record.schema.js';
import { MastersService, type PackageGroup } from '../masters/masters.service.js';
import { PRICED_KINDS, PricedKind, PropertyRate, PropertyRateDocument, PropertySettings } from './pricing.schema.js';
import type { TaxRate } from './proforma.js';
import { settingsProblems, withDefaults, type PropertySettingsValues, type TaxGroup } from './settings.js';

export interface RateInput {
  offered: boolean;
  rate: number | null;
  taxInclusive: boolean | null;
  taxIds: string[] | null;
}

/** An item as one property sells it: the group record with that property's changes applied. */
export interface PricedItem {
  kind: PricedKind;
  id: string;
  code: string;
  name: string;
  aType: TaxGroup;
  unit: string | null;
  offered: boolean;
  groupRate: number;
  rate: number;
  groupTaxInclusive: boolean;
  taxInclusive: boolean;
  /** null: the property's default taxes for the A-Type. */
  taxIds: string[] | null;
  overridden: boolean;
  groups?: PackageGroup[];
}

@Injectable()
export class PricingService {
  constructor(
    @InjectModel(PropertyRate.name) private readonly rates: Model<PropertyRate>,
    @InjectModel(PropertySettings.name) private readonly settingsModel: Model<PropertySettings>,
    private readonly masters: MastersService,
  ) {}

  async settings(tenantId: Types.ObjectId, propertyId: string): Promise<PropertySettingsValues> {
    await this.property(tenantId, propertyId);
    const saved = await this.settingsModel.findOne({ tenantId, propertyId });
    return withDefaults(saved?.values);
  }

  async saveSettings(tenantId: Types.ObjectId, propertyId: string, input: Partial<PropertySettingsValues>) {
    await this.property(tenantId, propertyId);
    if (!input || typeof input !== 'object') throw new BadRequestException('Invalid settings.');
    const saved = await this.settingsModel.findOne({ tenantId, propertyId });
    const values = withDefaults({ ...saved?.values, ...input });
    const problems = settingsProblems(values);
    for (const [group, ids] of Object.entries(values.defaultTaxIds)) {
      for (const id of ids) {
        const tax = await this.masters.get(tenantId, 'tax', id).catch(() => null);
        if (!tax?.active) problems.push(`Default taxes for ${group}: choose active taxes.`);
        else if (!(tax.values.propertyIds as string[]).includes(propertyId)) {
          problems.push(`${String(tax.values.description)} is not set up for this property (see Taxes).`);
        }
      }
    }
    if (problems.length) throw new BadRequestException([...new Set(problems)]);
    values.cancellationSlabs = [...values.cancellationSlabs].sort((a, b) => b.fromDays - a.fromDays)
      .map((s) => ({ fromDays: s.fromDays, percent: s.percent }));
    await this.settingsModel.updateOne({ tenantId, propertyId }, { $set: { values } }, { upsert: true });
    return values;
  }

  /** Rate & Tax Mapping: every package, ala carte / service item and modifier available to the property. */
  async rateSheet(tenantId: Types.ObjectId, propertyId: string): Promise<PricedItem[]> {
    await this.property(tenantId, propertyId);
    const [packages, items, modifiers, units, overrides] = await Promise.all([
      this.masters.list(tenantId, 'package', false),
      this.masters.list(tenantId, 'menuItem', false),
      this.masters.list(tenantId, 'modifier', false),
      this.masters.list(tenantId, 'unit', false),
      this.rates.find({ tenantId, propertyId }),
    ]);
    const unitName = new Map(units.map((u) => [u.id as string, String(u.values.shortDescription)]));
    const byKey = new Map(overrides.map((o) => [`${o.kind}:${o.itemId}`, o]));
    const at = (r: MasterRecordDocument) => {
      const ids = (r.values.propertyIds as string[] | undefined) ?? [];
      return r.kind === 'package' ? ids.includes(propertyId) : ids.length === 0 || ids.includes(propertyId);
    };
    const result: PricedItem[] = [];
    for (const p of packages.filter(at)) {
      result.push(this.apply(byKey.get(`package:${p.id}`), {
        kind: 'package', id: p.id as string, code: String(p.values.code), name: String(p.values.description), aType: 'package',
        unit: 'pax', groupRate: p.values.ratePerPax as number, groupTaxInclusive: !!p.values.taxInclusive,
        groups: p.values.groups as PackageGroup[],
      }));
    }
    for (const m of items.filter(at).filter((m) => m.values.aType !== 'package')) {
      result.push(this.apply(byKey.get(`menuItem:${m.id}`), {
        kind: 'menuItem', id: m.id as string, code: String(m.values.code), name: String(m.values.description),
        aType: m.values.aType as TaxGroup, unit: unitName.get(m.values.unitId as string) ?? null,
        groupRate: m.values.defaultRate as number, groupTaxInclusive: false,
      }));
    }
    for (const m of modifiers.filter(at)) {
      result.push(this.apply(byKey.get(`modifier:${m.id}`), {
        kind: 'modifier', id: m.id as string, code: String(m.values.code), name: String(m.values.description), aType: 'alacarte',
        unit: unitName.get(m.values.unitId as string) ?? null, groupRate: m.values.rate as number, groupTaxInclusive: false,
      }));
    }
    return result;
  }

  async saveRate(tenantId: Types.ObjectId, propertyId: string, kind: string, itemId: string, input: RateInput) {
    if (!(PRICED_KINDS as readonly string[]).includes(kind)) throw new NotFoundException('Unknown item type.');
    const sheet = await this.rateSheet(tenantId, propertyId);
    if (!sheet.some((i) => i.kind === kind && i.id === itemId)) {
      throw new BadRequestException('This item is not available at this property. Check the item\'s properties first.');
    }
    const problems: string[] = [];
    if (typeof input.offered !== 'boolean') problems.push('Offered must be yes or no.');
    if (input.rate !== null && (typeof input.rate !== 'number' || !Number.isFinite(input.rate) || input.rate < 0)) {
      problems.push('Rate must be a number of 0 or more, or empty to use the group rate.');
    }
    if (input.taxInclusive !== null && typeof input.taxInclusive !== 'boolean') problems.push('Includes tax must be yes, no or empty.');
    if (input.taxIds !== null) {
      if (!Array.isArray(input.taxIds)) problems.push('Taxes must be a list.');
      else {
        for (const id of new Set(input.taxIds)) {
          const tax = typeof id === 'string' ? await this.masters.get(tenantId, 'tax', id).catch(() => null) : null;
          if (!tax?.active || !(tax.values.propertyIds as string[]).includes(propertyId)) problems.push('Taxes: choose active taxes set up for this property.');
        }
      }
    }
    if (problems.length) throw new BadRequestException([...new Set(problems)]);
    const values = {
      offered: input.offered,
      rate: input.rate === null ? null : Math.round(input.rate * 100) / 100,
      taxInclusive: input.taxInclusive,
      taxIds: input.taxIds === null ? null : [...new Set(input.taxIds)],
    };
    if (values.offered && values.rate === null && values.taxInclusive === null && values.taxIds === null) {
      await this.rates.deleteOne({ tenantId, propertyId, kind, itemId });
    } else {
      await this.rates.updateOne({ tenantId, propertyId, kind, itemId }, { $set: values }, { upsert: true });
    }
    return (await this.rateSheet(tenantId, propertyId)).find((i) => i.kind === kind && i.id === itemId)!;
  }

  /** The taxes on an item at a property on a date: its mapping, else the property default for its A-Type. */
  async taxesFor(tenantId: Types.ObjectId, propertyId: string, item: Pick<PricedItem, 'taxIds' | 'aType'>, onDate: string): Promise<TaxRate[]> {
    const settings = await this.settings(tenantId, propertyId);
    const ids = item.taxIds ?? settings.defaultTaxIds[item.aType] ?? [];
    const taxes: TaxRate[] = [];
    for (const id of ids) {
      const t = await this.masters.get(tenantId, 'tax', id).catch(() => null);
      if (!t?.active) continue;
      const from = t.values.validFrom as string;
      const till = t.values.validTill as string | null;
      if (from > onDate || (till && till < onDate)) continue;
      taxes.push({ id: t.id as string, name: String(t.values.description), type: t.values.taxType as TaxRate['type'], rate: t.values.rate as number });
    }
    return taxes;
  }

  private apply(o: PropertyRateDocument | undefined, base: Omit<PricedItem, 'offered' | 'rate' | 'taxInclusive' | 'taxIds' | 'overridden'>): PricedItem {
    return {
      ...base,
      offered: o?.offered ?? true,
      rate: o?.rate ?? base.groupRate,
      taxInclusive: o?.taxInclusive ?? base.groupTaxInclusive,
      taxIds: o?.taxIds ?? null,
      overridden: !!o,
    };
  }

  private async property(tenantId: Types.ObjectId, propertyId: string) {
    const p = typeof propertyId === 'string' ? await this.masters.get(tenantId, 'property', propertyId).catch(() => null) : null;
    if (!p?.active) throw new NotFoundException('Property not found.');
    return p;
  }
}
