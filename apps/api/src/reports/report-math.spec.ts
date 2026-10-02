import * as math from './report-math.js';
import type { ReservationLike } from './report-math.js';

const hall = (id: string, name = id) => ({ id, name, propertyId: 'p1', capacity: 100 });
let seq = 0;
const booking = (over: Partial<ReservationLike>): ReservationLike => {
  seq += 1;
  return {
    id: `r${seq}`, number: `R-${seq}`, status: 'confirmed', propertyId: 'p1', hostName: `Host ${seq}`, functionTypeId: 'wedding',
    guaranteedPax: 100, expectedMaxPax: 120, slots: [{ hallId: 'roof', start: '2030-07-01T12:00', end: '2030-07-01T16:00' }],
    history: [{ from: null, to: 'confirmed', at: '2030-06-01T00:00:00Z' }], ...over,
  };
};

describe('report calculations', () => {
  it('counts overlapping minutes inside a range', () => {
    expect(math.overlapMinutes({ start: '2030-07-01T22:00', end: '2030-07-02T02:00' }, '2030-07-02T00:00', '2030-07-03T00:00')).toBe(120);
    expect(math.overlapMinutes({ start: '2030-07-01T10:00', end: '2030-07-01T12:00' }, '2030-07-02T00:00', '2030-07-03T00:00')).toBe(0);
    expect(math.datesBetween('2030-06-29', '2030-07-02')).toEqual(['2030-06-29', '2030-06-30', '2030-07-01', '2030-07-02']);
  });

  it('groups bookings by status on their function date', () => {
    const report = math.bookingsByStatus([
      booking({}),
      booking({ status: 'enquiry', guaranteedPax: 50, expectedMaxPax: 60 }),
      booking({ status: 'confirmed', guaranteedPax: 10, expectedMaxPax: 10 }),
      booking({ slots: [{ hallId: 'roof', start: '2030-08-01T12:00', end: '2030-08-01T13:00' }] }),
    ], '2030-07-01', '2030-07-31');
    expect(report.rows).toContainEqual({ status: 'confirmed', bookings: 2, guaranteedPax: 110, expectedMaxPax: 130 });
    expect(report.rows).toContainEqual({ status: 'enquiry', bookings: 1, guaranteedPax: 50, expectedMaxPax: 60 });
    expect(report.total.bookings).toBe(3);
  });

  it('measures hall occupancy by days used, keeping provisional and blocked hours apart', () => {
    const rows = math.hallOccupancy(
      [hall('roof'), hall('mezz')],
      [
        booking({}),
        booking({ status: 'provisional', slots: [{ hallId: 'roof', start: '2030-07-02T18:00', end: '2030-07-03T01:00' }] }),
        booking({ status: 'enquiry', slots: [{ hallId: 'mezz', start: '2030-07-02T18:00', end: '2030-07-02T20:00' }] }),
        booking({ status: 'cancelled', slots: [{ hallId: 'mezz', start: '2030-07-03T18:00', end: '2030-07-03T20:00' }] }),
      ],
      [{ hallId: 'mezz', start: '2030-07-01T00:00', end: '2030-07-02T00:00' }],
      '2030-07-01', '2030-07-10',
    );
    expect(rows[0]).toMatchObject({ hallName: 'roof', functions: 2, confirmedHours: 4, provisionalHours: 7, daysUsed: 3, daysInRange: 10, occupancyPercent: 30 });
    expect(rows[1]).toMatchObject({ hallName: 'mezz', functions: 0, blockedHours: 24, daysUsed: 0, occupancyPercent: 0 });
  });

  it('works out conversion, telling lost apart from cancelled after confirming', () => {
    const history = (...to: ReservationLike['status'][]) => to.map((t, i) => ({ from: i ? to[i - 1] : null, to: t, at: '2030-06-01T00:00:00Z' }));
    const report = math.enquiryConversion([
      booking({ status: 'confirmed', history: history('enquiry', 'confirmed') }),
      booking({ status: 'cancelled', history: history('enquiry', 'confirmed', 'cancelled') }),
      booking({ status: 'cancelled', history: history('enquiry', 'cancelled') }),
      booking({ status: 'lost', history: history('enquiry', 'lost') }),
      booking({ status: 'enquiry', functionTypeId: 'meeting', history: history('enquiry') }),
    ], new Map([['wedding', 'Wedding'], ['meeting', 'Meeting']]));
    expect(report.total).toMatchObject({
      received: 5, converted: 1, cancelledAfterConfirm: 1, cancelledBeforeConfirm: 1, lost: 1, open: 1,
      conversionPercent: 40, decidedConversionPercent: 50,
    });
    expect(report.byFunctionType.find((r) => r.functionType === 'Meeting')).toMatchObject({ received: 1, open: 1, conversionPercent: 0 });
  });

  it('lists function sheets for confirmed functions only, in time order', () => {
    const rows = math.functionSheets([
      booking({ slots: [{ hallId: 'roof', start: '2030-07-02T19:00', end: '2030-07-02T23:00' }] }),
      booking({ number: 'R-early', status: 'completed', actualPax: 90 }),
      booking({ status: 'provisional' }),
    ], new Map([['roof', 'Roof Top']]), new Map([['wedding', 'Wedding']]), '2030-07-01', '2030-07-07');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ number: 'R-early', date: '2030-07-01', hall: 'Roof Top', functionType: 'Wedding', actualPax: 90 });
  });

  it('forecasts each hall per day with the strongest claim and the pax expected', () => {
    const f = math.availabilityForecast(
      [hall('roof'), hall('mezz')],
      [
        booking({}),
        booking({ status: 'enquiry', expectedMaxPax: 40, slots: [{ hallId: 'roof', start: '2030-07-01T18:00', end: '2030-07-01T20:00' }] }),
        booking({ status: 'provisional', guaranteedPax: 30, expectedMaxPax: 35, slots: [{ hallId: 'mezz', start: '2030-07-02T10:00', end: '2030-07-02T12:00' }] }),
        booking({ status: 'lost', slots: [{ hallId: 'mezz', start: '2030-07-01T10:00', end: '2030-07-01T12:00' }] }),
      ],
      [{ hallId: 'mezz', start: '2030-07-03T00:00', end: '2030-07-04T00:00' }],
      '2030-07-01', '2030-07-03',
    );
    const roof = f.halls[0].days;
    expect(roof[0]).toMatchObject({ state: 'confirmed', heldHours: 4 });
    expect(roof[0].bookings).toHaveLength(2);
    expect(f.halls[1].days.map((d) => d.state)).toEqual(['free', 'provisional', 'blocked']);
    expect(f.days[0]).toMatchObject({ functions: 1, guaranteedPax: 100, tentativePax: 40, hallsAvailable: 1, hallsTotal: 2 });
    expect(f.days[1]).toMatchObject({ functions: 1, guaranteedPax: 30, expectedMaxPax: 35, hallsAvailable: 1 });
    expect(f.days[2]).toMatchObject({ functions: 0, hallsAvailable: 1 });
  });

  it('adds up menu and resource demand from confirmed and provisional functions', () => {
    const pkg = (pax: number, choices: string[]) => [{ packageId: 'blnv', name: 'Buffet Lunch', pax, choices }];
    const demand = math.menuDemand([
      booking({ packages: pkg(100, ['tikka', 'fish']), extras: [{ itemId: 'dj', name: 'DJ Console', aType: 'services', qty: 1 }] }),
      booking({ status: 'provisional', packages: pkg(50, ['tikka']), extras: [{ itemId: 'dj', name: 'DJ Console', aType: 'services', qty: 2 }] }),
      booking({ status: 'enquiry', packages: pkg(500, ['tikka']) }),
      booking({ packages: pkg(80, ['fish']), slots: [{ hallId: 'roof', start: '2030-08-01T12:00', end: '2030-08-01T13:00' }] }),
    ], new Map([['tikka', 'Chicken Tikka'], ['fish', 'Fish Fingers']]), '2030-07-01', '2030-07-31');
    expect(demand.packages).toEqual([{ packageId: 'blnv', name: 'Buffet Lunch', bookings: 2, pax: 150, provisionalPax: 50 }]);
    expect(demand.dishes).toEqual([
      { itemId: 'tikka', name: 'Chicken Tikka', pax: 150, provisionalPax: 50 },
      { itemId: 'fish', name: 'Fish Fingers', pax: 100, provisionalPax: 0 },
    ]);
    expect(demand.extras).toEqual([{ itemId: 'dj', name: 'DJ Console', aType: 'services', qty: 3, provisionalQty: 2 }]);
  });

  it('adds up revenue from final bills, by A-Type, source and tax, in one currency', () => {
    const bill = (over: Partial<math.BillLike>): math.BillLike => ({
      id: 'b', number: 'B/1', propertyId: 'p1', reservationId: 'r', reservationNumber: 'R-1', hostName: 'Host', functionDate: '2030-07-01',
      status: 'settled',
      totals: {
        amount: 1100, discount: 100, taxable: 1000, taxTotal: 50, roundOff: 0, total: 1050,
        taxes: [{ id: 'gst', name: 'GST 5%', amount: 50 }],
        lines: [
          { aType: 'package', source: 'package', taxable: 800, taxes: [{ amount: 40 }], total: 840 },
          { aType: 'services', source: 'hallHire', taxable: 200, taxes: [{ amount: 10 }], total: 210 },
        ],
      },
      advances: [{ amount: 300 }], payments: [{ kind: 'payment', amount: 800 }, { kind: 'refund', amount: 50 }],
      ...over,
    });
    const report = math.revenue([
      bill({}),
      bill({ id: 'b2', number: 'B/2', status: 'finalised', advances: [], payments: [] }),
      bill({ id: 'b3', status: 'draft' }),
      bill({ id: 'b4', status: 'void' }),
      bill({ id: 'b5', functionDate: '2030-08-01' }),
    ], new Map([['p1', 'INR']]), '2030-07-01', '2030-07-31');
    expect(report.total).toMatchObject({ bills: 2, discount: 200, taxable: 2000, taxTotal: 100, total: 2100, collected: 1050, balance: 1050 });
    expect(report.byAType).toEqual([
      { key: 'package', label: 'Packages', taxable: 1600, tax: 80, total: 1680 },
      { key: 'services', label: 'Services', taxable: 400, tax: 20, total: 420 },
    ]);
    expect(report.bySource.map((r) => r.label)).toEqual(['Packages', 'Hall hire']);
    expect(report.taxes).toEqual([{ id: 'gst', name: 'GST 5%', amount: 100 }]);
    expect(report.bills.map((b) => [b.number, b.balance])).toEqual([['B/1', 0], ['B/2', 1050]]);

    const mixed = math.revenue([bill({}), bill({ id: 'b2', propertyId: 'p2' })], new Map([['p1', 'INR'], ['p2', 'AED']]), '2030-07-01', '2030-07-31');
    expect(mixed).toMatchObject({ mixedCurrencies: true, total: null, currency: null, byAType: [] });
    expect(mixed.byProperty.map((p) => [p.currency, p.total])).toEqual([['INR', 1050], ['AED', 1050]]);
  });

  it('takes credit notes issued in the range off revenue, whatever the bill they credit', () => {
    const totals = {
      amount: 1000, discount: 0, taxable: 1000, taxTotal: 50, roundOff: 0, total: 1050,
      taxes: [{ id: 'gst', name: 'GST 5%', amount: 50 }],
      lines: [{ aType: 'package', source: 'package', taxable: 1000, taxes: [{ amount: 50 }], total: 1050 }],
    };
    const report = math.revenue(
      [{
        id: 'b1', number: 'B/1', propertyId: 'p1', reservationId: 'r', reservationNumber: 'R-1', hostName: 'Host', functionDate: '2030-07-01', status: 'partiallySettled',
        totals, advances: [], payments: [{ kind: 'payment', amount: 500 }],
        // Credits on the bill lower what is still to collect, whenever they were issued.
        credits: [{ total: 105, status: 'issued' }, { total: 999, status: 'cancelled' }],
      }],
      new Map([['p1', 'INR']]), '2030-07-01', '2030-07-31',
    );
    expect(report.total).toMatchObject({ total: 1050, collected: 500, credited: 105, balance: 445 });
    expect(report.bills[0]).toMatchObject({ credited: 105, balance: 445 });

    const note = (over: Partial<math.CreditNoteLike>): math.CreditNoteLike => ({
      propertyId: 'p1', billId: 'b0', date: '2030-07-10', status: 'issued',
      totals: { taxable: 100, taxTotal: 5, total: 105, taxes: [{ id: 'gst', name: 'GST 5%', amount: 5 }], lines: [{ billLineId: 'l1', aType: 'services', taxable: 100, taxes: [{ amount: 5 }], total: 105 }] },
      ...over,
    });
    const notes = [
      note({}), // against a June bill: it still counts in July, when it was issued
      note({ status: 'cancelled' }),
      note({ date: '2030-08-01' }),
      note({ propertyId: 'p2' }), // a property with no bills in the range
    ];
    const sources = new Map([['b0|l1', 'hallHire']]);
    const empty = () => ({ bills: 0, amount: 0, discount: 0, taxable: 0, taxTotal: 0, roundOff: 0, total: 0, collected: 0, credited: 0, balance: 0 });
    const net = math.withCreditNotes(report, notes, sources, new Map([['p1', 'INR'], ['p2', 'INR']]), ['p1', 'p2'], '2030-07-01', '2030-07-31', empty);
    expect(net.total).toMatchObject({ total: 1050, creditNotes: { notes: 2, taxable: 200, taxTotal: 10, total: 210 }, net: { taxable: 800, taxTotal: 40, total: 840 } });
    expect(net.byProperty.map((p) => [p.propertyId, p.creditNotes.total, p.net.total])).toEqual([['p1', 105, 945], ['p2', 105, -105]]);
    expect(net.byAType).toEqual([
      { key: 'package', label: 'Packages', taxable: 1000, tax: 50, total: 1050, creditedTaxable: 0, creditedTax: 0, credited: 0, netTaxable: 1000, netTax: 50, net: 1050 },
      { key: 'services', label: 'Services', taxable: 0, tax: 0, total: 0, creditedTaxable: 200, creditedTax: 10, credited: 210, netTaxable: -200, netTax: -10, net: -210 },
    ]);
    expect(net.bySource.map((r) => [r.label, r.credited])).toEqual([['Hall hire', 210], ['Packages', 0]]);
    expect(net.taxes).toEqual([{ id: 'gst', name: 'GST 5%', amount: 50, credited: 10, net: 40 }]);

    // A property billing in another currency makes the totals per property only.
    const mixed = math.withCreditNotes(report, notes, sources, new Map([['p1', 'INR'], ['p2', 'AED']]), ['p1', 'p2'], '2030-07-01', '2030-07-31', empty);
    expect(mixed).toMatchObject({ mixedCurrencies: true, total: null, byAType: [], taxes: [] });
  });
});
