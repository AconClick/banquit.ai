import type { ReservationStatus } from '../reservations/reservation.schema.js';
import { addDays, toMinutes } from '../reservations/local-time.js';

/**
 * Pure report calculations. The service loads tenant-scoped records and hands them here,
 * so every rule below can be tested without a database.
 */

export interface SlotLike {
  hallId: string;
  start: string;
  end: string;
}

export interface ReservationLike {
  id: string;
  number: string;
  status: ReservationStatus;
  propertyId: string;
  hostName: string;
  functionTypeId: string;
  seatingStyleId?: string | null;
  guaranteedPax: number;
  expectedMaxPax: number;
  actualPax?: number | null;
  slots: SlotLike[];
  history: { from: ReservationStatus | null; to: ReservationStatus; at: Date | string }[];
  createdAt?: Date | string;
  packages?: { packageId: string; name: string; pax: number; choices: string[] }[];
  extras?: { itemId: string; name: string; aType: 'alacarte' | 'services'; qty: number }[];
}

export interface BlockLike {
  hallId: string;
  start: string;
  end: string;
}

export interface HallLike {
  id: string;
  name: string;
  propertyId: string;
  capacity: number;
}

/** The function has happened or is firmly on: the hall is used. */
export const CONFIRMED_STATUSES: ReservationStatus[] = ['confirmed', 'inFunction', 'completed', 'billed'];
/** Still being worked on: neither won nor lost. */
export const OPEN_STATUSES: ReservationStatus[] = ['enquiry', 'provisional', 'waitlisted'];

/** Each date from `from` up to and including `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Minutes of the slot that fall inside [start, end). */
export function overlapMinutes(slot: { start: string; end: string }, start: string, end: string): number {
  const a = slot.start > start ? slot.start : start;
  const b = slot.end < end ? slot.end : end;
  return a < b ? toMinutes(b) - toMinutes(a) : 0;
}

/** The function's date: the day its first hall slot starts. */
export function functionDate(r: Pick<ReservationLike, 'slots'>): string {
  return r.slots.map((s) => s.start).sort()[0].slice(0, 10);
}

const rangeOf = (from: string, to: string) => ({ start: `${from}T00:00`, end: `${addDays(to, 1)}T00:00` });
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** Bookings whose function date falls in the range, counted by status. */
export function bookingsByStatus(reservations: ReservationLike[], from: string, to: string) {
  const rows = new Map<ReservationStatus, { status: ReservationStatus; bookings: number; guaranteedPax: number; expectedMaxPax: number }>();
  for (const r of reservations) {
    const date = functionDate(r);
    if (date < from || date > to) continue;
    const row = rows.get(r.status) ?? { status: r.status, bookings: 0, guaranteedPax: 0, expectedMaxPax: 0 };
    row.bookings += 1;
    row.guaranteedPax += r.guaranteedPax;
    row.expectedMaxPax += r.expectedMaxPax;
    rows.set(r.status, row);
  }
  const list = [...rows.values()];
  return {
    rows: list,
    total: list.reduce(
      (t, r) => ({ bookings: t.bookings + r.bookings, guaranteedPax: t.guaranteedPax + r.guaranteedPax, expectedMaxPax: t.expectedMaxPax + r.expectedMaxPax }),
      { bookings: 0, guaranteedPax: 0, expectedMaxPax: 0 },
    ),
  };
}

/**
 * How much each hall was used in the range. A hall counts as used on a day when a confirmed or
 * provisional booking holds it for any part of that day. Occupancy is used days over days in range.
 */
export function hallOccupancy(halls: HallLike[], reservations: ReservationLike[], blocks: BlockLike[], from: string, to: string) {
  const dates = datesBetween(from, to);
  const { start, end } = rangeOf(from, to);
  return halls.map((hall) => {
    let confirmedMin = 0;
    let provisionalMin = 0;
    let blockedMin = 0;
    const functions = new Set<string>();
    const usedDays = new Set<string>();
    for (const r of reservations) {
      const confirmed = CONFIRMED_STATUSES.includes(r.status);
      if (!confirmed && r.status !== 'provisional') continue;
      for (const s of r.slots) {
        if (s.hallId !== hall.id) continue;
        const m = overlapMinutes(s, start, end);
        if (!m) continue;
        functions.add(r.id);
        if (confirmed) confirmedMin += m;
        else provisionalMin += m;
        for (const d of dates) if (overlapMinutes(s, `${d}T00:00`, `${addDays(d, 1)}T00:00`)) usedDays.add(d);
      }
    }
    for (const b of blocks) if (b.hallId === hall.id) blockedMin += overlapMinutes(b, start, end);
    return {
      hallId: hall.id,
      hallName: hall.name,
      propertyId: hall.propertyId,
      functions: functions.size,
      confirmedHours: hours(confirmedMin),
      provisionalHours: hours(provisionalMin),
      blockedHours: hours(blockedMin),
      daysUsed: usedDays.size,
      daysInRange: dates.length,
      occupancyPercent: percent(usedDays.size, dates.length),
    };
  });
}

export type Outcome = 'converted' | 'open' | 'lost' | 'cancelledBeforeConfirm' | 'cancelledAfterConfirm';

/** Where a booking ended up, from its status and history. */
export function outcomeOf(r: Pick<ReservationLike, 'status' | 'history'>): Outcome {
  if (CONFIRMED_STATUSES.includes(r.status)) return 'converted';
  if (OPEN_STATUSES.includes(r.status)) return 'open';
  if (r.status === 'lost') return 'lost';
  return r.history.some((h) => h.to === 'confirmed') ? 'cancelledAfterConfirm' : 'cancelledBeforeConfirm';
}

/**
 * Bookings received in the range (by the date they were taken) and what became of them.
 * Conversion counts bookings that reached Confirmed, including ones later cancelled, over all
 * bookings received; open ones are shown apart so a young pipeline is not read as lost.
 */
export function enquiryConversion(reservations: ReservationLike[], functionTypeNames: Map<string, string>) {
  const empty = (): Record<Outcome, number> => ({ converted: 0, open: 0, lost: 0, cancelledBeforeConfirm: 0, cancelledAfterConfirm: 0 });
  const total = empty();
  const byType = new Map<string, Record<Outcome, number>>();
  for (const r of reservations) {
    const o = outcomeOf(r);
    total[o] += 1;
    const row = byType.get(r.functionTypeId) ?? empty();
    row[o] += 1;
    byType.set(r.functionTypeId, row);
  }
  const summarise = (c: Record<Outcome, number>) => {
    const received = Object.values(c).reduce((a, b) => a + b, 0);
    const won = c.converted + c.cancelledAfterConfirm;
    return { received, ...c, conversionPercent: percent(won, received), decidedConversionPercent: percent(won, received - c.open) };
  };
  return {
    total: summarise(total),
    byFunctionType: [...byType].map(([functionTypeId, c]) => ({
      functionTypeId,
      functionType: functionTypeNames.get(functionTypeId) ?? 'Unknown',
      ...summarise(c),
    })),
  };
}

/** One row per hall slot of every confirmed function in the range, in date and time order. */
export function functionSheets(reservations: ReservationLike[], hallNames: Map<string, string>, functionTypeNames: Map<string, string>, from: string, to: string) {
  const { start, end } = rangeOf(from, to);
  const rows = reservations
    .filter((r) => CONFIRMED_STATUSES.includes(r.status))
    .flatMap((r) =>
      r.slots
        .filter((s) => overlapMinutes(s, start, end) > 0)
        .map((s) => ({
          reservationId: r.id,
          number: r.number,
          status: r.status,
          propertyId: r.propertyId,
          date: s.start.slice(0, 10),
          start: s.start,
          end: s.end,
          hallId: s.hallId,
          hall: hallNames.get(s.hallId) ?? 'Unknown',
          hostName: r.hostName,
          functionType: functionTypeNames.get(r.functionTypeId) ?? 'Unknown',
          guaranteedPax: r.guaranteedPax,
          expectedMaxPax: r.expectedMaxPax,
          actualPax: r.actualPax ?? null,
        })),
    );
  return rows.sort((a, b) => a.start.localeCompare(b.start) || a.hall.localeCompare(b.hall));
}

export type CellState = 'free' | 'enquiry' | 'provisional' | 'confirmed' | 'blocked';
const RANK: Record<CellState, number> = { free: 0, enquiry: 1, provisional: 2, confirmed: 3, blocked: 4 };

function cellState(status: ReservationStatus): CellState | null {
  if (CONFIRMED_STATUSES.includes(status)) return 'confirmed';
  if (status === 'provisional') return 'provisional';
  if (status === 'enquiry' || status === 'waitlisted') return 'enquiry';
  return null;
}

/**
 * Availability of every hall on every day of the range, with the pax expected each day.
 * A cell shows its strongest claim: blocked, then confirmed, provisional, enquiry, free.
 * Pax counts confirmed and provisional bookings once, on their function date.
 */
export function availabilityForecast(halls: HallLike[], reservations: ReservationLike[], blocks: BlockLike[], from: string, to: string) {
  const dates = datesBetween(from, to);
  const cells = new Map<string, { state: CellState; heldHours: number; bookings: string[] }>();
  const key = (hallId: string, date: string) => `${hallId}|${date}`;
  for (const h of halls) for (const d of dates) cells.set(key(h.id, d), { state: 'free', heldHours: 0, bookings: [] });

  const mark = (hallId: string, slot: { start: string; end: string }, state: CellState, number?: string) => {
    for (const d of dates) {
      const cell = cells.get(key(hallId, d));
      if (!cell) continue;
      const m = overlapMinutes(slot, `${d}T00:00`, `${addDays(d, 1)}T00:00`);
      if (!m) continue;
      if (RANK[state] > RANK[cell.state]) cell.state = state;
      if (state === 'confirmed' || state === 'provisional') cell.heldHours = hours(cell.heldHours * 60 + m);
      if (number && !cell.bookings.includes(number)) cell.bookings.push(number);
    }
  };

  const days = new Map(dates.map((d) => [d, { date: d, functions: 0, guaranteedPax: 0, expectedMaxPax: 0, tentativePax: 0 }]));
  for (const r of reservations) {
    const state = cellState(r.status);
    if (!state) continue;
    for (const s of r.slots) mark(s.hallId, s, state, r.number);
    const day = days.get(functionDate(r));
    if (!day) continue;
    if (state === 'enquiry') {
      day.tentativePax += r.expectedMaxPax;
      continue;
    }
    day.functions += 1;
    day.guaranteedPax += r.guaranteedPax;
    day.expectedMaxPax += r.expectedMaxPax;
  }
  for (const b of blocks) mark(b.hallId, b, 'blocked');

  return {
    dates,
    halls: halls.map((h) => ({
      hallId: h.id,
      hallName: h.name,
      propertyId: h.propertyId,
      capacity: h.capacity,
      days: dates.map((d) => ({ date: d, ...cells.get(key(h.id, d))! })),
    })),
    days: dates.map((d) => {
      const free = halls.filter((h) => cells.get(key(h.id, d))!.state === 'free' || cells.get(key(h.id, d))!.state === 'enquiry').length;
      return { ...days.get(d)!, hallsAvailable: free, hallsTotal: halls.length };
    }),
  };
}

/**
 * What the kitchen and banquet team must prepare for functions in the range: packages and their
 * pax, each chosen menu item with the pax it serves, and ala carte items and services booked.
 * Counts confirmed and provisional bookings, with the provisional part shown apart.
 */
export function menuDemand(reservations: ReservationLike[], itemNames: Map<string, string>, from: string, to: string) {
  const packages = new Map<string, { packageId: string; name: string; bookings: number; pax: number; provisionalPax: number }>();
  const dishes = new Map<string, { itemId: string; name: string; pax: number; provisionalPax: number }>();
  const extras = new Map<string, { itemId: string; name: string; aType: 'alacarte' | 'services'; qty: number; provisionalQty: number }>();
  for (const r of reservations) {
    const confirmed = CONFIRMED_STATUSES.includes(r.status);
    if (!confirmed && r.status !== 'provisional') continue;
    const date = functionDate(r);
    if (date < from || date > to) continue;
    const share = (n: number) => (confirmed ? 0 : n);
    for (const p of r.packages ?? []) {
      const row = packages.get(p.packageId) ?? { packageId: p.packageId, name: p.name, bookings: 0, pax: 0, provisionalPax: 0 };
      row.bookings += 1;
      row.pax += p.pax;
      row.provisionalPax += share(p.pax);
      packages.set(p.packageId, row);
      for (const itemId of p.choices) {
        const dish = dishes.get(itemId) ?? { itemId, name: itemNames.get(itemId) ?? 'Unknown', pax: 0, provisionalPax: 0 };
        dish.pax += p.pax;
        dish.provisionalPax += share(p.pax);
        dishes.set(itemId, dish);
      }
    }
    for (const e of r.extras ?? []) {
      const row = extras.get(e.itemId) ?? { itemId: e.itemId, name: e.name, aType: e.aType, qty: 0, provisionalQty: 0 };
      row.qty += e.qty;
      row.provisionalQty += share(e.qty);
      extras.set(e.itemId, row);
    }
  }
  const byName = <T extends { name: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { packages: byName(packages), dishes: byName(dishes), extras: byName(extras) };
}

export interface BillLike {
  id: string;
  number: string;
  propertyId: string;
  reservationId: string;
  reservationNumber: string;
  hostName: string;
  functionDate: string;
  status: string;
  totals: {
    amount: number;
    discount: number;
    taxable: number;
    taxTotal: number;
    roundOff: number;
    total: number;
    taxes: { id: string; name: string; amount: number }[];
    lines: { aType: string; source: string; taxable: number; taxes: { amount: number }[]; total: number }[];
  };
  advances: { amount: number }[];
  payments: { kind: 'payment' | 'refund'; amount: number }[];
}

/** Bills that count as revenue: final, whether or not they are paid. Drafts and void bills do not. */
export const REVENUE_BILL_STATUSES = ['finalised', 'partiallySettled', 'settled'] as const;

const money = (n: number) => Math.round(n * 100) / 100;
const A_TYPE_LABELS: Record<string, string> = { package: 'Packages', alacarte: 'Ala carte', services: 'Services' };
const SOURCE_LABELS: Record<string, string> = {
  package: 'Packages', extra: 'Booked extras', running: 'Ordered during the function', hallHire: 'Hall hire', liquorLicence: 'Liquor licence',
};

/**
 * Revenue from final bills whose function date falls in the range, split by A-Type (PAS) and by
 * line source, with taxes and money collected. Amounts are in each property's own currency, so
 * the grand total is only given when every property in the report uses the same currency.
 */
export function revenue(bills: BillLike[], currencies: Map<string, string>, from: string, to: string) {
  const counted = bills.filter((b) => (REVENUE_BILL_STATUSES as readonly string[]).includes(b.status) && b.functionDate >= from && b.functionDate <= to && b.totals);
  const collectedOf = (b: BillLike) =>
    b.advances.reduce((s, a) => s + a.amount, 0) + b.payments.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0);

  const empty = () => ({ bills: 0, amount: 0, discount: 0, taxable: 0, taxTotal: 0, roundOff: 0, total: 0, collected: 0, balance: 0 });
  type Sum = ReturnType<typeof empty>;
  const add = (s: Sum, b: BillLike) => {
    const collected = collectedOf(b);
    s.bills += 1;
    s.amount += b.totals.amount;
    s.discount += b.totals.discount;
    s.taxable += b.totals.taxable;
    s.taxTotal += b.totals.taxTotal;
    s.roundOff += b.totals.roundOff;
    s.total += b.totals.total;
    s.collected += collected;
    s.balance += b.totals.total - collected;
  };
  const rounded = (s: Sum) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'bills' ? v : money(v)])) as Sum;

  const byProperty = new Map<string, Sum>();
  const group = (key: (l: BillLike['totals']['lines'][number]) => string, labels: Record<string, string>) => {
    const rows = new Map<string, { key: string; label: string; taxable: number; tax: number; total: number }>();
    for (const b of counted) {
      for (const l of b.totals.lines) {
        const k = key(l);
        const row = rows.get(k) ?? { key: k, label: labels[k] ?? k, taxable: 0, tax: 0, total: 0 };
        row.taxable += l.taxable;
        row.tax += l.taxes.reduce((s, t) => s + t.amount, 0);
        row.total += l.total;
        rows.set(k, row);
      }
    }
    return [...rows.values()].map((r) => ({ ...r, taxable: money(r.taxable), tax: money(r.tax), total: money(r.total) }));
  };
  const taxes = new Map<string, { id: string; name: string; amount: number }>();
  for (const b of counted) {
    const s = byProperty.get(b.propertyId) ?? empty();
    add(s, b);
    byProperty.set(b.propertyId, s);
    for (const t of b.totals.taxes) {
      const row = taxes.get(t.id) ?? { id: t.id, name: t.name, amount: 0 };
      row.amount += t.amount;
      taxes.set(t.id, row);
    }
  }

  const used = new Set([...byProperty.keys()].map((p) => currencies.get(p) ?? ''));
  const oneCurrency = used.size <= 1;
  const total = empty();
  if (oneCurrency) for (const b of counted) add(total, b);

  return {
    currency: oneCurrency ? ([...used][0] ?? null) : null,
    mixedCurrencies: !oneCurrency,
    total: oneCurrency ? rounded(total) : null,
    byProperty: [...byProperty].map(([propertyId, s]) => ({ propertyId, currency: currencies.get(propertyId) ?? '', ...rounded(s) })),
    // Splits and taxes add amounts across bills, so they are only given in one currency.
    byAType: oneCurrency ? group((l) => l.aType, A_TYPE_LABELS) : [],
    bySource: oneCurrency ? group((l) => l.source, SOURCE_LABELS) : [],
    taxes: oneCurrency ? [...taxes.values()].map((t) => ({ ...t, amount: money(t.amount) })) : [],
    bills: counted
      .map((b) => {
        const collected = money(collectedOf(b));
        return {
          id: b.id, number: b.number, propertyId: b.propertyId, currency: currencies.get(b.propertyId) ?? '', reservationId: b.reservationId,
          reservationNumber: b.reservationNumber, hostName: b.hostName, functionDate: b.functionDate, status: b.status,
          total: b.totals.total, collected, balance: money(b.totals.total - collected),
        };
      })
      .sort((a, b) => a.functionDate.localeCompare(b.functionDate) || a.number.localeCompare(b.number)),
  };
}
