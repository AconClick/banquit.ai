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
});
