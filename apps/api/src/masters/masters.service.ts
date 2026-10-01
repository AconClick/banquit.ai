import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FieldDef, MASTER_BY_KIND, MASTERS, MasterDef } from './definitions.js';
import { MasterRecord, MasterRecordDocument } from './master-record.schema.js';
import { isTimeZone, todayIn } from '../reservations/local-time.js';

export interface PackageGroup {
  subGroupId: string;
  min: number;
  max: number;
  itemIds: string[];
}

export const masterView = (r: MasterRecordDocument) => ({ id: r.id as string, active: r.active, ...r.values });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

@Injectable()
export class MastersService {
  constructor(@InjectModel(MasterRecord.name) private readonly records: Model<MasterRecord>) {}

  definition(kind: string): MasterDef {
    const def = MASTER_BY_KIND.get(kind);
    if (!def) throw new NotFoundException('Unknown master.');
    return def;
  }

  list(tenantId: Types.ObjectId, kind: string, includeInactive: boolean) {
    this.definition(kind);
    const filter: Record<string, unknown> = { tenantId, kind };
    if (!includeInactive) filter.active = true;
    return this.records.find(filter).sort({ uniqueKey: 1 });
  }

  async get(tenantId: Types.ObjectId, kind: string, id: string) {
    const record = Types.ObjectId.isValid(id) ? await this.records.findOne({ tenantId, kind, _id: id }) : null;
    if (!record) throw new NotFoundException(`${this.definition(kind).singular} not found.`);
    return record;
  }

  /** Today's date at the property, in its own time zone. */
  async propertyToday(tenantId: Types.ObjectId, propertyId: string) {
    const property = await this.get(tenantId, 'property', propertyId).catch(() => null);
    return todayIn(property?.values.timeZone as string | undefined);
  }

  async create(tenantId: Types.ObjectId, kind: string, input: Record<string, unknown>) {
    const def = this.definition(kind);
    const values = await this.validate(tenantId, def, input);
    const uniqueKey = this.uniqueKey(def, values);
    await this.checkUnique(tenantId, def, uniqueKey);
    return this.records.create({ tenantId, kind, uniqueKey, values, active: true });
  }

  async update(tenantId: Types.ObjectId, kind: string, id: string, input: Record<string, unknown>) {
    const def = this.definition(kind);
    const record = await this.get(tenantId, kind, id);
    const values = await this.validate(tenantId, def, input);
    const uniqueKey = this.uniqueKey(def, values);
    await this.checkUnique(tenantId, def, uniqueKey, record._id);
    record.values = values;
    record.uniqueKey = uniqueKey;
    record.markModified('values');
    return record.save();
  }

  /** Records are never deleted, only deactivated. A record still used by active records stays active. */
  async setActive(tenantId: Types.ObjectId, kind: string, id: string, active: boolean) {
    const def = this.definition(kind);
    const record = await this.get(tenantId, kind, id);
    if (!active) {
      const usedBy = await this.usage(tenantId, kind, record.id as string);
      if (usedBy.length) {
        throw new ConflictException(`This ${def.singular.toLowerCase()} is still used by: ${usedBy.join(', ')}. Change or deactivate those first.`);
      }
    }
    record.active = active;
    return record.save();
  }

  private async usage(tenantId: Types.ObjectId, kind: string, id: string): Promise<string[]> {
    const found: string[] = [];
    for (const other of MASTERS) {
      for (const field of other.fields) {
        let path: string | null = null;
        if ((field.type === 'ref' || field.type === 'refs') && field.refKind === kind) path = `values.${field.key}`;
        if (field.type === 'packageGroups' && kind === 'subGroup') path = `values.${field.key}.subGroupId`;
        if (field.type === 'packageGroups' && kind === 'menuItem') path = `values.${field.key}.itemIds`;
        if (!path) continue;
        const count = await this.records.countDocuments({ tenantId, kind: other.kind, active: true, [path]: id });
        if (count) found.push(`${count} ${count === 1 ? other.singular : other.label}`.toLowerCase());
      }
    }
    return found;
  }

  private uniqueKey(def: MasterDef, values: Record<string, unknown>) {
    return String(values[def.unique]).trim().toLowerCase();
  }

  private async checkUnique(tenantId: Types.ObjectId, def: MasterDef, uniqueKey: string, exceptId?: Types.ObjectId) {
    const filter: Record<string, unknown> = { tenantId, kind: def.kind, uniqueKey };
    if (exceptId) filter._id = { $ne: exceptId };
    if (await this.records.exists(filter)) {
      const label = def.fields.find((f) => f.key === def.unique)?.label ?? def.unique;
      throw new ConflictException(`A ${def.singular.toLowerCase()} with this ${label.toLowerCase()} already exists.`);
    }
  }

  /** Checks every field against the definition and returns the clean values to store. */
  private async validate(tenantId: Types.ObjectId, def: MasterDef, input: Record<string, unknown>) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid data.');
    const problems: string[] = [];
    const values: Record<string, unknown> = {};

    for (const field of def.fields) {
      const raw = input[field.key] ?? field.default;
      if (isEmpty(raw) || (Array.isArray(raw) && raw.length === 0)) {
        if (field.required && field.type !== 'boolean') problems.push(`${field.label} is required.`);
        else if (field.type === 'boolean') values[field.key] = false;
        else if (field.type === 'refs' || field.type === 'packageGroups') values[field.key] = [];
        else values[field.key] = null;
        continue;
      }
      const result = await this.checkField(tenantId, field, raw);
      if (typeof result === 'object' && result && 'problem' in result) problems.push(`${field.label}: ${result.problem}`);
      else values[field.key] = result;
    }

    if (def.kind === 'tax' && !problems.length) {
      if (values.taxType === 'percentage' && (values.rate as number) > 100) problems.push('Tax rate: a percentage cannot be over 100.');
      if (values.validTill && (values.validTill as string) < (values.validFrom as string)) {
        problems.push('Valid till must be on or after valid from.');
      }
    }
    if (problems.length) throw new BadRequestException(problems);
    return values;
  }

  private async checkField(tenantId: Types.ObjectId, field: FieldDef, raw: unknown): Promise<unknown> {
    const fail = (problem: string) => ({ problem });
    switch (field.type) {
      case 'text': {
        if (typeof raw !== 'string' && typeof raw !== 'number') return fail('must be text.');
        let value = String(raw).trim();
        if (field.uppercase) value = value.toUpperCase();
        if (field.maxLength && value.length > field.maxLength) return fail(`must be at most ${field.maxLength} characters.`);
        if (field.pattern && !new RegExp(field.pattern).test(value)) return fail(`must be ${field.patternHint ?? 'in the right format'}.`);
        if (field.timeZone && !isTimeZone(value)) return fail('must be a time zone name such as Asia/Kolkata or Europe/London.');
        return value;
      }
      case 'number': {
        const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(value)) return fail('must be a number.');
        if (field.integer && !Number.isInteger(value)) return fail('must be a whole number.');
        if (field.min !== undefined && value < field.min) return fail(`must be at least ${field.min}.`);
        if (field.max !== undefined && value > field.max) return fail(`must be at most ${field.max}.`);
        return Math.round(value * 10000) / 10000;
      }
      case 'date': {
        const value = String(raw).trim();
        if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return fail('must be a date (YYYY-MM-DD).');
        return value;
      }
      case 'boolean':
        if (typeof raw !== 'boolean') return fail('must be yes or no.');
        return raw;
      case 'enum':
        if (typeof raw !== 'string' || !field.options?.[raw]) return fail(`must be one of ${Object.values(field.options ?? {}).join(', ')}.`);
        return raw;
      case 'ref': {
        const ids = await this.existing(tenantId, field.refKind!, [raw]);
        return ids ? ids[0] : fail('choose an active entry from the list.');
      }
      case 'refs': {
        if (!Array.isArray(raw)) return fail('must be a list.');
        const ids = await this.existing(tenantId, field.refKind!, [...new Set(raw)]);
        return ids ?? fail('choose active entries from the list.');
      }
      case 'packageGroups':
        return this.checkPackageGroups(tenantId, raw);
    }
  }

  /** Returns the ids if every one is an active record of the kind in this tenant, else null. */
  private async existing(tenantId: Types.ObjectId, kind: string, ids: unknown[]): Promise<string[] | null> {
    if (!ids.every((id) => typeof id === 'string' && Types.ObjectId.isValid(id))) return null;
    const count = await this.records.countDocuments({ tenantId, kind, active: true, _id: { $in: ids } });
    return count === ids.length ? (ids as string[]) : null;
  }

  private async checkPackageGroups(tenantId: Types.ObjectId, raw: unknown) {
    const fail = (problem: string) => ({ problem });
    if (!Array.isArray(raw)) return fail('must be a list.');
    const groups: PackageGroup[] = [];
    const seen = new Set<string>();
    for (const [i, g] of raw.entries()) {
      const n = i + 1;
      if (!g || typeof g !== 'object') return fail(`rule ${n} is invalid.`);
      const { subGroupId, min, max, itemIds } = g as Record<string, unknown>;
      const [sub] = (await this.existing(tenantId, 'subGroup', [subGroupId])) ?? [];
      if (!sub) return fail(`rule ${n}: choose an active sub-group.`);
      if (seen.has(sub)) return fail(`rule ${n}: each sub-group can appear only once.`);
      seen.add(sub);
      if (!Array.isArray(itemIds) || itemIds.length === 0) return fail(`rule ${n}: choose at least one item.`);
      const unique = [...new Set(itemIds)];
      if (!unique.every((id) => typeof id === 'string' && Types.ObjectId.isValid(id))) return fail(`rule ${n}: invalid item.`);
      const items = await this.records.find({ tenantId, kind: 'menuItem', active: true, _id: { $in: unique } });
      if (items.length !== unique.length) return fail(`rule ${n}: choose active menu items.`);
      const wrong = items.find((it) => it.values.subGroupId !== sub || it.values.aType !== 'package');
      if (wrong) return fail(`rule ${n}: "${String(wrong.values.description)}" must be a Package item of the chosen sub-group.`);
      if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0 || (max as number) < 1) {
        return fail(`rule ${n}: minimum and maximum must be whole numbers, maximum at least 1.`);
      }
      if ((min as number) > (max as number)) return fail(`rule ${n}: minimum cannot be more than maximum.`);
      if ((max as number) > unique.length) return fail(`rule ${n}: maximum cannot be more than the number of items (${unique.length}).`);
      groups.push({ subGroupId: sub, min: min as number, max: max as number, itemIds: unique as string[] });
    }
    return groups;
  }
}
