import { RESERVATION_STATUSES, type ReservationStatus } from '../reservations/reservation.schema.js';
import { addDays, addMinutes } from '../reservations/local-time.js';
import {
  A_TYPE_LABELS,
  type BillLike,
  type BlockLike,
  CONFIRMED_STATUSES,
  type HallLike,
  type Outcome,
  REVENUE_BILL_STATUSES,
  type ReservationLike,
  SOURCE_LABELS,
  conversionReport,
  datesBetween,
  functionDate,
  hours,
  noOutcomes,
  outcomeOf,
  overlapMinutes,
  percent,
  slotDates,
} from './report-math.js';

/**
 * Monthly summaries behind the yearly reports. Each summary holds one property's figures for one
 * calendar month, day by day, so a report over any range adds up the days it covers instead of
 * reading every booking and bill again. The builders and readers here are pure; the cache service
 * decides when a month must be rebuilt. They give the same figures as the matching functions in
 * report-math.ts, which stay the reference (see report-summary.spec.ts).
 */

export type SummaryKind = 'functions' | 'conversion' | 'revenue';
/** Figures by date (YYYY-MM-DD). */
export type Days<T> = Record<string, T>;
/** A month's figures by day, for ranges that start or end inside it, and for the whole month. */
export interface MonthSummary<T> {
  days: Days<T>;
  total: T;
}

/** Whether the range covers the whole month, so its total can be read instead of its days. */
export function wholeMonth(month: string, from: string, to: string) {
  const b = monthBounds(month);
  return from <= b.from && to >= b.to;
}

/** A month's total in the shape of its days, dated on the 1st, for the readers below. */
export const asDays = <T>(month: string, total: T): Days<T> => ({ [`${month}-01`]: total });

/** What the readers need from stored months: the total of each month the range covers whole, otherwise its days. */
export function forRange<T>(months: ({ month: string } & MonthSummary<T>)[], from: string, to: string): Days<T>[] {
  return months.map((m) => (wholeMonth(m.month, from, to) ? asDays(m.month, m.total) : m.days));
}

/** The months (YYYY-MM) that the dates from `from` to `to` fall in. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) out.push(m);
  return out;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** First and last date of a month. */
export function monthBounds(month: string) {
  return { from: `${month}-01`, to: addDays(`${nextMonth(month)}-01`, -1) };
}

/* ---------- Bookings: status by function date, and hall use ---------- */

export interface StatusCount {
  bookings: number;
  guaranteedPax: number;
  expectedMaxPax: number;
}

export interface HallDay {
  confirmedMinutes: number;
  provisionalMinutes: number;
  /** Days the hall was held: 1 for a day, up to the month's length in a month's total. */
  daysUsed: number;
  /** Bookings that held the hall only within this day (or month), each counted here once. */
  functions: number;
  /** Bookings that also held the hall outside it, so a range counts each of them once by id. */
  ids?: string[];
}

export interface FunctionDay {
  status?: Partial<Record<ReservationStatus, StatusCount>>;
  halls?: Record<string, HallDay>;
}

const hallOf = (day: FunctionDay, hallId: string) => ((day.halls ??= {})[hallId] ??= { confirmedMinutes: 0, provisionalMinutes: 0, daysUsed: 0, functions: 0 });
const addStatus = (day: FunctionDay, r: ReservationLike) => {
  const c = ((day.status ??= {})[r.status] ??= { bookings: 0, guaranteedPax: 0, expectedMaxPax: 0 });
  c.bookings += 1;
  c.guaranteedPax += r.guaranteedPax;
  c.expectedMaxPax += r.expectedMaxPax;
};

/** One property's booking figures for one month, from the bookings with a hall slot in that month. */
export function functionMonth(reservations: ReservationLike[], month: string): MonthSummary<FunctionDay> {
  const { from, to } = monthBounds(month);
  const days: Days<FunctionDay> = {};
  const total: FunctionDay = {};
  const day = (d: string) => (days[d] ??= {});
  for (const r of reservations) {
    const date = functionDate(r);
    if (date >= from && date <= to) {
      addStatus(day(date), r);
      addStatus(total, r);
    }
    const confirmed = CONFIRMED_STATUSES.includes(r.status);
    if (!confirmed && r.status !== 'provisional') continue;
    // Minutes held per hall and date, over the whole booking, to tell whether it stays inside a day or the month.
    const held = new Map<string, Map<string, number>>();
    for (const slot of r.slots) {
      for (const d of slotDates(slot, slot.start.slice(0, 10), '9999-12-31')) {
        const m = overlapMinutes(slot, `${d}T00:00`, `${addDays(d, 1)}T00:00`);
        if (!m) continue;
        const dates = held.get(slot.hallId) ?? new Map<string, number>();
        dates.set(d, (dates.get(d) ?? 0) + m);
        held.set(slot.hallId, dates);
      }
    }
    for (const [hallId, dates] of held) {
      const inMonth = [...dates].filter(([d]) => d >= from && d <= to);
      if (!inMonth.length) continue;
      const t = hallOf(total, hallId);
      for (const [d, m] of inMonth) {
        const h = hallOf(day(d), hallId);
        for (const x of [h, t]) {
          if (confirmed) x.confirmedMinutes += m;
          else x.provisionalMinutes += m;
        }
        h.daysUsed = 1;
        if (dates.size === 1) h.functions += 1;
        else (h.ids ??= []).push(r.id);
      }
      if (inMonth.length === dates.size) t.functions += 1;
      else (t.ids ??= []).push(r.id);
    }
  }
  for (const d of Object.values(days)) for (const hallId of Object.keys(d.halls ?? {})) hallOf(total, hallId).daysUsed += 1;
  return { days, total };
}

/** The dates of `days` that fall from `from` to `to`, across every summary given. */
function* daysIn<T>(summaries: Days<T>[], from: string, to: string): Generator<T> {
  for (const days of summaries) for (const [d, v] of Object.entries(days)) if (d >= from && d <= to) yield v;
}

const STATUS_ORDER = new Map<string, number>(RESERVATION_STATUSES.map((s, i) => [s, i]));

/** Same figures as report-math bookingsByStatus, with rows in the order a booking moves through. */
export function readBookingsByStatus(summaries: Days<FunctionDay>[], from: string, to: string) {
  const rows = new Map<ReservationStatus, { status: ReservationStatus } & StatusCount>();
  for (const day of daysIn(summaries, from, to)) {
    for (const [status, c] of Object.entries(day.status ?? {}) as [ReservationStatus, StatusCount][]) {
      const row = rows.get(status) ?? { status, bookings: 0, guaranteedPax: 0, expectedMaxPax: 0 };
      row.bookings += c.bookings;
      row.guaranteedPax += c.guaranteedPax;
      row.expectedMaxPax += c.expectedMaxPax;
      rows.set(status, row);
    }
  }
  const list = [...rows.values()].sort((a, b) => (STATUS_ORDER.get(a.status) ?? 99) - (STATUS_ORDER.get(b.status) ?? 99));
  return {
    rows: list,
    total: list.reduce(
      (t, r) => ({ bookings: t.bookings + r.bookings, guaranteedPax: t.guaranteedPax + r.guaranteedPax, expectedMaxPax: t.expectedMaxPax + r.expectedMaxPax }),
      { bookings: 0, guaranteedPax: 0, expectedMaxPax: 0 },
    ),
  };
}

/** Same figures as report-math hallOccupancy. Blocks are few, so they are read as they are. */
export function readHallOccupancy(halls: HallLike[], summaries: Days<FunctionDay>[], blocks: BlockLike[], from: string, to: string) {
  const daysInRange = datesBetween(from, to).length;
  const start = `${from}T00:00`;
  const end = `${addDays(to, 1)}T00:00`;
  const byHall = new Map<string, { confirmed: number; provisional: number; daysUsed: number; functions: number; ids: Set<string> }>();
  for (const day of daysIn(summaries, from, to)) {
    for (const [hallId, h] of Object.entries(day.halls ?? {})) {
      const row = byHall.get(hallId) ?? { confirmed: 0, provisional: 0, daysUsed: 0, functions: 0, ids: new Set<string>() };
      row.confirmed += h.confirmedMinutes;
      row.provisional += h.provisionalMinutes;
      row.daysUsed += h.daysUsed;
      row.functions += h.functions;
      for (const id of h.ids ?? []) row.ids.add(id);
      byHall.set(hallId, row);
    }
  }
  const blocked = new Map<string, number>();
  for (const b of blocks) blocked.set(b.hallId, (blocked.get(b.hallId) ?? 0) + overlapMinutes(b, start, end));
  return halls.map((hall) => {
    const row = byHall.get(hall.id);
    const used = row?.daysUsed ?? 0;
    return {
      hallId: hall.id,
      hallName: hall.name,
      propertyId: hall.propertyId,
      functions: (row?.functions ?? 0) + (row?.ids.size ?? 0),
      confirmedHours: hours(row?.confirmed ?? 0),
      provisionalHours: hours(row?.provisional ?? 0),
      blockedHours: hours(blocked.get(hall.id) ?? 0),
      daysUsed: used,
      daysInRange,
      occupancyPercent: percent(used, daysInRange),
    };
  });
}

/* ---------- Enquiry conversion, by the day a booking was taken (UTC) ---------- */

export type ConversionDay = Record<string, Record<Outcome, number>>;

const utcDate = (at: Date | string | undefined) => (at ? new Date(at).toISOString().slice(0, 10) : '');

/** One property's outcome counts per function type for one month, from the bookings taken in it. */
export function conversionMonth(reservations: ReservationLike[], month: string): MonthSummary<ConversionDay> {
  const { from, to } = monthBounds(month);
  const days: Days<ConversionDay> = {};
  const total: ConversionDay = {};
  for (const r of reservations) {
    const d = utcDate(r.createdAt);
    if (d < from || d > to) continue;
    const o = outcomeOf(r);
    ((days[d] ??= {})[r.functionTypeId] ??= noOutcomes())[o] += 1;
    (total[r.functionTypeId] ??= noOutcomes())[o] += 1;
  }
  return { days, total };
}

/** Same figures as report-math enquiryConversion. */
export function readEnquiryConversion(summaries: Days<ConversionDay>[], functionTypeNames: Map<string, string>, from: string, to: string) {
  const byType = new Map<string, Record<Outcome, number>>();
  for (const day of daysIn(summaries, from, to)) {
    for (const [typeId, c] of Object.entries(day)) {
      const row = byType.get(typeId) ?? noOutcomes();
      for (const o of Object.keys(row) as Outcome[]) row[o] += c[o] ?? 0;
      byType.set(typeId, row);
    }
  }
  return conversionReport(byType, functionTypeNames);
}

/* ---------- Revenue, by function date ---------- */

export interface RevenueSum {
  bills: number;
  amount: number;
  discount: number;
  taxable: number;
  taxTotal: number;
  roundOff: number;
  total: number;
  collected: number;
  balance: number;
}

export interface RevenueSplit {
  taxable: number;
  tax: number;
  total: number;
}

export interface RevenueDay {
  sum: RevenueSum;
  aType: Record<string, RevenueSplit>;
  source: Record<string, RevenueSplit>;
  taxes: Record<string, { name: string; amount: number }>;
}

const emptySum = (): RevenueSum => ({ bills: 0, amount: 0, discount: 0, taxable: 0, taxTotal: 0, roundOff: 0, total: 0, collected: 0, balance: 0 });
const addSum = (into: RevenueSum, s: RevenueSum) => {
  for (const k of Object.keys(into) as (keyof RevenueSum)[]) into[k] += s[k];
};
const addSplit = (into: Record<string, RevenueSplit>, key: string, s: RevenueSplit) => {
  const row = (into[key] ??= { taxable: 0, tax: 0, total: 0 });
  row.taxable += s.taxable;
  row.tax += s.tax;
  row.total += s.total;
};
const money = (n: number) => Math.round(n * 100) / 100;

export const collectedOf = (b: Pick<BillLike, 'advances' | 'payments'>) =>
  b.advances.reduce((s, a) => s + a.amount, 0) + b.payments.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0);

/** One property's revenue for one month, from its final bills with a function date in that month. */
export function revenueMonth(bills: BillLike[], month: string): MonthSummary<RevenueDay> {
  const { from, to } = monthBounds(month);
  const days: Days<RevenueDay> = {};
  const total: RevenueDay = { sum: emptySum(), aType: {}, source: {}, taxes: {} };
  for (const b of bills) {
    if (!(REVENUE_BILL_STATUSES as readonly string[]).includes(b.status) || !b.totals || b.functionDate < from || b.functionDate > to) continue;
    const collected = collectedOf(b);
    for (const day of [(days[b.functionDate] ??= { sum: emptySum(), aType: {}, source: {}, taxes: {} }), total]) {
      addSum(day.sum, {
        bills: 1, amount: b.totals.amount, discount: b.totals.discount, taxable: b.totals.taxable, taxTotal: b.totals.taxTotal,
        roundOff: b.totals.roundOff, total: b.totals.total, collected, balance: b.totals.total - collected,
      });
      for (const l of b.totals.lines) {
        const split = { taxable: l.taxable, tax: l.taxes.reduce((s, t) => s + t.amount, 0), total: l.total };
        addSplit(day.aType, l.aType, split);
        addSplit(day.source, l.source, split);
      }
      for (const t of b.totals.taxes) {
        const row = (day.taxes[t.id] ??= { name: t.name, amount: 0 });
        row.amount += t.amount;
      }
    }
  }
  return { days, total };
}

/**
 * Same totals as report-math revenue (without the bill list). `summaries` carries each
 * property's months; properties are listed in `propertyIds` order.
 */
export function readRevenue(summaries: { propertyId: string; days: Days<RevenueDay> }[], currencies: Map<string, string>, propertyIds: string[], from: string, to: string) {
  const byProperty = new Map<string, RevenueSum>();
  const aType: Record<string, RevenueSplit> = {};
  const source: Record<string, RevenueSplit> = {};
  const taxes = new Map<string, { id: string; name: string; amount: number }>();
  for (const s of summaries) {
    for (const day of daysIn([s.days], from, to)) {
      if (!day.sum.bills) continue;
      const sum = byProperty.get(s.propertyId) ?? emptySum();
      addSum(sum, day.sum);
      byProperty.set(s.propertyId, sum);
      for (const [k, v] of Object.entries(day.aType)) addSplit(aType, k, v);
      for (const [k, v] of Object.entries(day.source)) addSplit(source, k, v);
      for (const [id, t] of Object.entries(day.taxes)) {
        const row = taxes.get(id) ?? { id, name: t.name, amount: 0 };
        row.amount += t.amount;
        taxes.set(id, row);
      }
    }
  }
  const rounded = (s: RevenueSum) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'bills' ? v : money(v)])) as unknown as RevenueSum;
  const order = new Map(propertyIds.map((id, i) => [id, i]));
  const properties = [...byProperty.keys()].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));
  const used = new Set(properties.map((p) => currencies.get(p) ?? ''));
  const oneCurrency = used.size <= 1;
  const total = emptySum();
  for (const s of byProperty.values()) addSum(total, s);
  const splits = (rows: Record<string, RevenueSplit>, labels: Record<string, string>) =>
    Object.entries(rows)
      .map(([key, r]) => ({ key, label: labels[key] ?? key, taxable: money(r.taxable), tax: money(r.tax), total: money(r.total) }))
      .sort((a, b) => a.label.localeCompare(b.label));

  return {
    currency: oneCurrency ? ([...used][0] ?? null) : null,
    mixedCurrencies: !oneCurrency,
    total: oneCurrency ? rounded(total) : null,
    byProperty: properties.map((propertyId) => ({ propertyId, currency: currencies.get(propertyId) ?? '', ...rounded(byProperty.get(propertyId)!) })),
    // Splits and taxes add amounts across bills, so they are only given in one currency.
    byAType: oneCurrency ? splits(aType, A_TYPE_LABELS) : [],
    bySource: oneCurrency ? splits(source, SOURCE_LABELS) : [],
    taxes: oneCurrency ? [...taxes.values()].map((t) => ({ ...t, amount: money(t.amount) })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) : [],
    /** Final bills in the range, in every currency. */
    billCount: properties.reduce((n, p) => n + byProperty.get(p)!.bills, 0),
  };
}

/* ---------- What a changed record touches ---------- */

/**
 * The months whose summary a record belongs to: for bookings, the months a hall slot overlaps (the
 * test each month's own query makes) or the month the booking was taken; for bills, the month of
 * the function date.
 */
export function monthsOf(kind: SummaryKind, record: ReservationLike | BillLike): string[] {
  if (kind === 'revenue') return [(record as BillLike).functionDate.slice(0, 7)];
  const r = record as ReservationLike;
  if (kind === 'conversion') {
    const taken = utcDate(r.createdAt);
    return taken ? [taken.slice(0, 7)] : [];
  }
  const months = new Set<string>();
  for (const s of r.slots) {
    const last = s.end > s.start ? addMinutes(s.end, -1) : s.start;
    for (const month of monthsBetween(s.start.slice(0, 10), last.slice(0, 10))) {
      if (s.end > `${month}-01T00:00` && s.start < `${nextMonth(month)}-01T00:00`) months.add(month);
    }
  }
  return [...months].sort();
}

/** The summaries a booking feeds, as it is now. */
export function reservationKeys(r: { propertyId: string; slots: { start: string; end: string }[]; createdAt?: Date | string }) {
  const like = r as ReservationLike;
  return (['functions', 'conversion'] as const).flatMap((kind) => monthsOf(kind, like).map((month) => ({ kind: kind as SummaryKind, propertyId: r.propertyId, month })));
}

/** The summary a bill feeds: the month of its function date, once the bill is final. */
export function billKeys(b: { propertyId: string; status?: string; functionDate?: string | null }) {
  if (!b.functionDate || !(REVENUE_BILL_STATUSES as readonly string[]).includes(b.status ?? '')) return [];
  return [{ kind: 'revenue' as SummaryKind, propertyId: b.propertyId, month: b.functionDate.slice(0, 7) }];
}
