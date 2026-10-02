import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill } from '../billing/bill.schema.js';
import { addDays } from '../reservations/local-time.js';
import { Reservation } from '../reservations/reservation.schema.js';
import { type BillLike, REVENUE_BILL_STATUSES, type ReservationLike } from './report-math.js';
import { LeanBill, LeanReservation, toBillLike, toLike } from './report-records.js';
import * as summary from './report-summary.js';
import type { ConversionDay, Days, FunctionDay, MonthSummary, RevenueDay, SummaryKind } from './report-summary.js';
import { ReportSummary, ReportWatermark } from './report-summary.schema.js';

/**
 * A change can become readable a little after the time it is stamped with (the save is in flight).
 * Each check therefore looks this far before the previous one again, and each build checks this
 * far before it started, once its summaries are saved, for changes it may have missed.
 */
const COMMIT_MARGIN_MS = 20_000;
/**
 * Records stamped further ahead than this (a server clock running fast) are picked up once the
 * clock reaches their stamp, rather than on every check until then.
 */
const CLOCK_SKEW_MS = 60_000;
/** Past this many changes since the last check, rebuilding everything is cheaper than sorting out what changed. */
const MAX_CHANGES = 5_000;

const FUNCTION_FIELDS = { updatedAt: 1, status: 1, propertyId: 1, guaranteedPax: 1, expectedMaxPax: 1, slots: 1 } as const;
const CONVERSION_FIELDS = { updatedAt: 1, status: 1, propertyId: 1, functionTypeId: 1, history: 1, createdAt: 1 } as const;
const BILL_FIELDS = { updatedAt: 1, propertyId: 1, status: 1, functionDate: 1, totals: 1, advances: 1, payments: 1 } as const;

interface Built<T> {
  propertyId: string;
  month: string;
  days: Days<T>;
}

/**
 * Monthly report summaries per tenant and property, kept in step with bookings and bills.
 *
 * Bookings and bills are changed by other modules, so this service never relies on being told:
 * before each report it reads what was saved since its last check (by updatedAt), and drops every
 * summary that read an older version of one of those records, or that a changed record now
 * belongs to but was not read by it. Missing months are then rebuilt from the records. Every
 * query is filtered by tenant, so summaries never mix tenants, and reports only read the
 * properties the caller may see.
 */
@Injectable()
export class ReportCacheService {
  constructor(
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(Bill.name) private readonly bills: Model<Bill>,
    @InjectModel(ReportSummary.name) private readonly summaries: Model<ReportSummary>,
    @InjectModel(ReportWatermark.name) private readonly watermarks: Model<ReportWatermark>,
  ) {}

  functionDays(tenantId: Types.ObjectId, propertyIds: string[], from: string, to: string) {
    return this.get<FunctionDay>(tenantId, 'functions', propertyIds, from, to).then((list) => list.map((s) => s.days));
  }

  conversionDays(tenantId: Types.ObjectId, propertyIds: string[], from: string, to: string) {
    return this.get<ConversionDay>(tenantId, 'conversion', propertyIds, from, to).then((list) => list.map((s) => s.days));
  }

  revenueDays(tenantId: Types.ObjectId, propertyIds: string[], from: string, to: string) {
    return this.get<RevenueDay>(tenantId, 'revenue', propertyIds, from, to);
  }

  private async get<T>(tenantId: Types.ObjectId, kind: SummaryKind, propertyIds: string[], from: string, to: string): Promise<Built<T>[]> {
    if (!propertyIds.length) return [];
    await this.refresh(tenantId);
    const months = summary.monthsBetween(from, to);
    // Months the range covers whole are read as one total; the first and last may need their days.
    const whole = months.filter((m) => summary.wholeMonth(m, from, to));
    const part = months.filter((m) => !whole.includes(m));
    const read = (list: string[], field: 'total' | 'days') =>
      list.length
        ? this.summaries.find({ tenantId, kind, propertyId: { $in: propertyIds }, month: { $in: list } }).select({ propertyId: 1, month: 1, [field]: 1 }).lean()
        : Promise.resolve([]);
    const found = (await Promise.all([read(whole, 'total'), read(part, 'days')])).flat();
    const have = new Set(found.map((s) => `${s.propertyId}|${s.month}`));
    const missing = months.flatMap((month) => propertyIds.filter((p) => !have.has(`${p}|${month}`)).map((propertyId) => ({ propertyId, month })));
    const built = missing.length ? await this.build<T>(tenantId, kind, missing) : [];
    return [
      ...found.map((s) => ({ propertyId: s.propertyId, month: s.month, days: (s.total ? summary.asDays(s.month, s.total) : s.days) as Days<T> })),
      ...built.map((b) => ({ propertyId: b.propertyId, month: b.month, days: summary.forRange([b], from, to)[0] })),
    ];
  }

  /** Drops the summaries that bookings and bills saved since the last check have made stale. */
  private async refresh(tenantId: Types.ObjectId) {
    const now = new Date();
    const mark = await this.watermarks.findOne({ tenantId }).lean();
    if (!mark) {
      // Nothing is known about earlier changes, so no summary of this tenant can be trusted.
      await this.summaries.deleteMany({ tenantId });
    } else {
      await this.applyChanges(tenantId, new Date(mark.checkedAt.getTime() - COMMIT_MARGIN_MS), now);
    }
    try {
      await this.watermarks.updateOne({ tenantId }, { $max: { checkedAt: now } }, { upsert: true });
    } catch (err) {
      // Two first reports at once: the other one created the mark.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }

  /** Drops the summaries made stale by bookings and bills saved from `since`. */
  private async applyChanges(tenantId: Types.ObjectId, since: Date, now: Date) {
    const updatedAt = { $gte: since, $lte: new Date(now.getTime() + CLOCK_SKEW_MS) };
    const [reservations, bills] = await Promise.all([
      this.reservations
        .find({ tenantId, updatedAt })
        .select({ propertyId: 1, 'slots.start': 1, 'slots.end': 1, createdAt: 1, updatedAt: 1 })
        .limit(MAX_CHANGES + 1)
        .lean<{ _id: Types.ObjectId; propertyId: string; slots?: { start: string; end: string }[]; createdAt?: Date; updatedAt: Date }[]>(),
      this.bills
        .find({ tenantId, updatedAt })
        .select({ propertyId: 1, status: 1, functionDate: 1, updatedAt: 1 })
        .limit(MAX_CHANGES + 1)
        .lean<{ _id: Types.ObjectId; propertyId: string; status: string; functionDate?: string; updatedAt: Date }[]>(),
    ]);
    if (reservations.length > MAX_CHANGES || bills.length > MAX_CHANGES) {
      await this.summaries.deleteMany({ tenantId });
      return;
    }
    await this.dropStale(tenantId, [
      ...reservations.map((r) => ({ id: r._id, at: r.updatedAt, keys: summary.reservationKeys({ ...r, slots: r.slots ?? [] }) })),
      ...bills.map((b) => ({ id: b._id, at: b.updatedAt, keys: summary.billKeys(b) })),
    ]);
  }

  private async dropStale(tenantId: Types.ObjectId, changes: { id: Types.ObjectId; at: Date; keys: { kind: SummaryKind; propertyId: string; month: string }[] }[]) {
    if (!changes.length) return;
    const keyOf = (k: { kind: string; propertyId: string; month: string }) => `${k.kind}|${k.propertyId}|${k.month}`;
    const version = new Map(changes.map((c) => [String(c.id), c.at.getTime()]));
    // Where each changed record belongs now; the summaries it fed before are found by `sources`.
    const belongs = new Map<string, { key: { kind: SummaryKind; propertyId: string; month: string }; ids: string[] }>();
    for (const c of changes) {
      for (const key of c.keys) {
        const entry = belongs.get(keyOf(key)) ?? { key, ids: [] };
        entry.ids.push(String(c.id));
        belongs.set(keyOf(key), entry);
      }
    }
    const ids = changes.map((c) => c.id);
    const found = await this.summaries.aggregate<{ _id: Types.ObjectId; kind: string; propertyId: string; month: string; read: { _id: Types.ObjectId; at: Date | null }[] }>([
      { $match: { tenantId, $or: [{ 'sources._id': { $in: ids } }, ...[...belongs.values()].map((b) => b.key)] } },
      { $project: { kind: 1, propertyId: 1, month: 1, read: { $filter: { input: '$sources', as: 's', cond: { $in: ['$$s._id', ids] } } } } },
    ]);
    const stale = found.filter((s) => {
      const read = new Map(s.read.map((r) => [String(r._id), r.at?.getTime()]));
      // It counted an older version of a changed record.
      for (const [id, at] of read) if (at !== version.get(id)) return true;
      // A changed record belongs here now but was not read when it was built.
      return (belongs.get(keyOf(s))?.ids ?? []).some((id) => !read.has(id));
    });
    if (stale.length) await this.summaries.deleteMany({ tenantId, _id: { $in: stale.map((s) => s._id) } });
  }

  /**
   * Builds the missing months from the bookings or bills: one query per run of consecutive
   * months, for every property missing any of them, shared out to the months afterwards.
   */
  private async build<T>(tenantId: Types.ObjectId, kind: SummaryKind, keys: { propertyId: string; month: string }[]): Promise<({ propertyId: string; month: string } & MonthSummary<T>)[]> {
    const builtAt = new Date();
    const months = [...new Set(keys.map((k) => k.month))].sort();
    const runs: string[][] = [];
    for (const m of months) {
      const run = runs.at(-1);
      if (run && summary.nextMonth(run.at(-1)!) === m) run.push(m);
      else runs.push([m]);
    }

    const built = (
      await Promise.all(
        runs.map(async (run) => {
          const wanted = keys.filter((k) => run.includes(k.month));
          const docs = await this.load(tenantId, kind, [...new Set(wanted.map((k) => k.propertyId))], `${run[0]}-01`, summary.monthBounds(run.at(-1)!).to);
          // Each record goes to the months it belongs to, among those being built.
          const records = new Map<string, { doc: (typeof docs)[number]; like: ReservationLike | BillLike }[]>();
          for (const doc of docs) {
            const like = kind === 'revenue' ? toBillLike(doc as LeanBill) : toLike(doc as LeanReservation);
            for (const month of summary.monthsOf(kind, like)) {
              const key = `${doc.propertyId}|${month}`;
              const list = records.get(key) ?? [];
              list.push({ doc, like });
              records.set(key, list);
            }
          }
          return wanted.map(({ propertyId, month }) => {
            const own = records.get(`${propertyId}|${month}`) ?? [];
            const figures =
              kind === 'functions' ? summary.functionMonth(own.map((r) => r.like as ReservationLike), month)
              : kind === 'conversion' ? summary.conversionMonth(own.map((r) => r.like as ReservationLike), month)
              : summary.revenueMonth(own.map((r) => r.like as BillLike), month);
            return { propertyId, month, ...(figures as unknown as MonthSummary<T>), sources: own.map((r) => ({ _id: r.doc._id, at: r.doc.updatedAt ?? null })) };
          });
        }),
      )
    ).flat();
    try {
      // Written as they are: the summaries are plain data, and casting large source lists is slow.
      await this.summaries.collection.bulkWrite(
        built.map((b) => ({
          replaceOne: {
            filter: { tenantId, kind, propertyId: b.propertyId, month: b.month },
            replacement: { tenantId, kind, propertyId: b.propertyId, month: b.month, builtAt, sources: b.sources, days: b.days, total: b.total },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (err) {
      // Another report built the same month at the same time; either copy will do.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    // A change saved while the build was reading may have been checked for before these
    // summaries existed; looking again now catches it.
    await this.applyChanges(tenantId, new Date(builtAt.getTime() - COMMIT_MARGIN_MS), new Date());
    return built.map(({ propertyId, month, days, total }) => ({ propertyId, month, days, total }));
  }

  private async load(tenantId: Types.ObjectId, kind: SummaryKind, propertyIds: string[], from: string, to: string): Promise<{ _id: Types.ObjectId; propertyId: string; updatedAt?: Date }[]> {
    const next = addDays(to, 1);
    if (kind === 'functions') {
      return this.reservations
        .find({ tenantId, propertyId: { $in: propertyIds }, slots: { $elemMatch: { end: { $gt: `${from}T00:00` }, start: { $lt: `${next}T00:00` } } } })
        .select(FUNCTION_FIELDS)
        .lean();
    }
    if (kind === 'conversion') {
      return this.reservations
        .find({ tenantId, propertyId: { $in: propertyIds }, createdAt: { $gte: new Date(`${from}T00:00:00Z`), $lt: new Date(`${next}T00:00:00Z`) } })
        .select(CONVERSION_FIELDS)
        .lean();
    }
    return this.bills
      .find({ tenantId, propertyId: { $in: propertyIds }, status: { $in: [...REVENUE_BILL_STATUSES] }, functionDate: { $gte: from, $lte: to } })
      .select(BILL_FIELDS)
      .lean();
  }
}
