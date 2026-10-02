import { RESERVATION_STATUSES } from '../reservations/reservation.schema.js';
import { addDays, addMinutes } from '../reservations/local-time.js';
import * as math from './report-math.js';
import type { BillLike, ReservationLike } from './report-math.js';
import * as summary from './report-summary.js';

/** A small seeded random generator, so a failure can be replayed. */
function rng(seed: number) {
  let s = seed;
  const next = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] };
}

const HALLS = ['roof', 'mezz', 'lawn'].map((id) => ({ id, name: id, propertyId: 'p1', capacity: 100 }));
const START = '2030-01-20';

function data(seed: number) {
  const r = rng(seed);
  const reservations: ReservationLike[] = Array.from({ length: 250 }, (_, i) => {
    const slots = Array.from({ length: 1 + r.int(2) }, () => {
      const start = `${addDays(START, r.int(120))}T${String(r.int(24)).padStart(2, '0')}:${r.pick(['00', '30'])}`;
      // Mostly a few hours; some run past midnight or over several days.
      return { hallId: r.pick(HALLS).id, start, end: addMinutes(start, r.pick([60, 240, 300, 600, 1500, 3000])) };
    });
    const status = r.pick(RESERVATION_STATUSES);
    const history = [
      { from: null, to: 'enquiry' as const, at: '' },
      ...(r.next() < 0.4 ? [{ from: 'enquiry' as const, to: 'confirmed' as const, at: '' }] : []),
      { from: 'enquiry' as const, to: status, at: '' },
    ];
    return {
      id: `r${i}`, number: `R-${i}`, status, propertyId: 'p1', hostName: `Host ${i}`, functionTypeId: r.pick(['wedding', 'meeting', 'party']),
      guaranteedPax: 10 + r.int(300), expectedMaxPax: 20 + r.int(400), slots, history,
      createdAt: new Date(Date.parse(`${addDays(START, r.int(120))}T00:00:00Z`) + r.int(86_400_000)),
    };
  });
  const bills: BillLike[] = Array.from({ length: 150 }, (_, i) => {
    const line = () => ({ aType: r.pick(['package', 'alacarte', 'services']), source: r.pick(['package', 'extra', 'running', 'hallHire']), taxable: r.int(100_000) / 100, taxes: [{ amount: r.int(5_000) / 100 }], total: r.int(110_000) / 100 });
    return {
      id: `b${i}`, number: `B/${String(i).padStart(4, '0')}`, propertyId: 'p1', reservationId: `r${i}`, reservationNumber: `R-${i}`, hostName: `Host ${i}`,
      functionDate: addDays(START, r.int(120)), status: r.pick(['draft', 'finalised', 'partiallySettled', 'settled', 'void']),
      totals: {
        amount: r.int(1_000_000) / 100, discount: r.int(10_000) / 100, taxable: r.int(900_000) / 100, taxTotal: r.int(90_000) / 100, roundOff: r.int(100) / 100 - 0.5,
        total: r.int(1_000_000) / 100, taxes: [{ id: r.pick(['cgst', 'sgst']), name: 'Tax', amount: r.int(50_000) / 100 }], lines: [line(), line()],
      },
      advances: [{ amount: r.int(100_000) / 100 }],
      payments: [{ kind: r.pick(['payment', 'refund'] as const), amount: r.int(100_000) / 100 }],
    };
  });
  // Each month is built from the records a month query would return, as the cache does.
  const touches = (x: ReservationLike, month: string) => {
    const { from, to } = summary.monthBounds(month);
    return x.slots.some((s) => s.end > `${from}T00:00` && s.start < `${addDays(to, 1)}T00:00`);
  };
  const months = summary.monthsBetween(START, addDays(START, 125));
  return {
    reservations, bills, r,
    functions: months.map((month) => ({ month, ...summary.functionMonth(reservations.filter((x) => touches(x, month)), month) })),
    conversion: months.map((month) => ({ month, ...summary.conversionMonth(reservations.filter((x) => String((x.createdAt as Date).toISOString()).startsWith(month)), month) })),
    revenue: months.map((month) => ({ month, ...summary.revenueMonth(bills.filter((b) => b.functionDate.startsWith(month)), month) })),
  };
}

const byKey = <T>(list: T[], key: (t: T) => string) => [...list].sort((a, b) => key(a).localeCompare(key(b)));

describe('monthly report summaries', () => {
  it('lists the months of a range', () => {
    expect(summary.monthsBetween('2030-11-15', '2031-02-01')).toEqual(['2030-11', '2030-12', '2031-01', '2031-02']);
    expect(summary.monthBounds('2032-02')).toEqual({ from: '2032-02-01', to: '2032-02-29' });
  });

  it('knows which months a changed booking or bill belongs to', () => {
    expect(summary.reservationKeys({ propertyId: 'p1', slots: [{ start: '2030-07-30T20:00', end: '2030-08-02T02:00' }], createdAt: new Date('2030-05-31T23:00:00Z') }))
      .toEqual([{ kind: 'functions', propertyId: 'p1', month: '2030-07' }, { kind: 'functions', propertyId: 'p1', month: '2030-08' }, { kind: 'conversion', propertyId: 'p1', month: '2030-05' }]);
    // A slot ending at midnight does not touch the next month.
    expect(summary.reservationKeys({ propertyId: 'p1', slots: [{ start: '2030-07-31T20:00', end: '2030-08-01T00:00' }] })).toEqual([{ kind: 'functions', propertyId: 'p1', month: '2030-07' }]);
    expect(summary.billKeys({ propertyId: 'p1', status: 'settled', functionDate: '2030-07-04' })).toEqual([{ kind: 'revenue', propertyId: 'p1', month: '2030-07' }]);
    // Draft bills are not revenue, so editing one changes no summary.
    expect(summary.billKeys({ propertyId: 'p1', status: 'draft', functionDate: '2030-07-04' })).toEqual([]);
  });

  // Any range, inside a month or across several, must give what the reports gave from the records.
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`gives the same figures as reading every record (data set ${seed})`, () => {
      const d = data(seed);
      const names = new Map([['wedding', 'Wedding'], ['meeting', 'Meeting']]);
      const currencies = new Map([['p1', 'INR']]);
      for (let i = 0; i < 30; i++) {
        const from = addDays(START, d.r.int(110) - 5);
        const to = addDays(from, d.r.int(120));
        // As the cache reads them: whole months as totals, the months the range starts or ends in by day.
        const functions = summary.forRange(d.functions, from, to);
        const conversion = summary.forRange(d.conversion, from, to);
        const revenueDays = summary.forRange(d.revenue, from, to).map((days) => ({ propertyId: 'p1', days }));

        const status = summary.readBookingsByStatus(functions, from, to);
        const statusRef = math.bookingsByStatus(d.reservations, from, to);
        expect(status.total).toEqual(statusRef.total);
        expect(status.rows).toEqual(byKey(statusRef.rows, (r) => r.status).sort((a, b) => RESERVATION_STATUSES.indexOf(a.status) - RESERVATION_STATUSES.indexOf(b.status)));

        const blocks = [{ hallId: 'roof', start: `${from}T10:00`, end: `${addDays(from, 2)}T10:00` }];
        expect(summary.readHallOccupancy(HALLS, functions, blocks, from, to)).toEqual(math.hallOccupancy(HALLS, d.reservations, blocks, from, to));

        const taken = d.reservations.filter((x) => {
          const day = (x.createdAt as Date).toISOString().slice(0, 10);
          return day >= from && day <= to;
        });
        expect(summary.readEnquiryConversion(conversion, names, from, to)).toEqual(math.enquiryConversion(taken, names));

        const { bills: _bills, ...revenueRef } = math.revenue(d.bills, currencies, from, to);
        const revenue = summary.readRevenue(revenueDays, currencies, ['p1'], from, to);
        expect(revenue.billCount).toBe(_bills.length);
        const { billCount: _count, ...totals } = revenue;
        const sorted = (r: typeof revenueRef) => ({ ...r, byAType: byKey(r.byAType, (x) => x.label), bySource: byKey(r.bySource, (x) => x.label), taxes: byKey(r.taxes, (x) => `${x.name}|${x.id}`) });
        expect(sorted(totals as typeof revenueRef)).toEqual(sorted(revenueRef));
      }
    });
  }

  it('gives no grand total when the properties bill in different currencies', () => {
    const day = { sum: { bills: 1, amount: 10, discount: 0, taxable: 10, taxTotal: 0, roundOff: 0, total: 10, collected: 0, balance: 10 }, aType: {}, source: {}, taxes: {} };
    const r = summary.readRevenue(
      [{ propertyId: 'p2', days: { '2030-07-01': day } }, { propertyId: 'p1', days: { '2030-07-02': day } }],
      new Map([['p1', 'INR'], ['p2', 'AED']]), ['p1', 'p2'], '2030-07-01', '2030-07-31',
    );
    expect(r).toMatchObject({ currency: null, mixedCurrencies: true, total: null, billCount: 2 });
    expect(r.byProperty.map((p) => [p.propertyId, p.currency])).toEqual([['p1', 'INR'], ['p2', 'AED']]);
  });
});
