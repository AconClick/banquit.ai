import { startApp } from './helpers.js';
import { booking, completedBooking, today, venue, type Venue } from './stress/fixture.js';

const all = <T>(n: number, f: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));
const ok = (rs: { status: number }[], status: number) => rs.filter((r) => r.status === status).length;

/** Several people acting on the same hall, booking or bill at the same moment. */
describe('Simultaneous changes', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let v: Venue;
  beforeAll(async () => {
    t = await startApp();
    v = await venue(t, 'racehotel', { hallsPer: 3 });
  });
  afterAll(() => t.close());

  it('gives a hall and time to one booking only', async () => {
    const created = await all(12, () => booking(v, 'p1h1', '2031-01-10', '12:00', '16:00', 'provisional'));
    expect(ok(created, 201)).toBe(1);
    expect(ok(created, 409)).toBe(11);

    const enquiries = await all(8, () => booking(v, 'p1h2', '2031-01-11', '12:00', '16:00', 'enquiry'));
    const promoted = await all(8, (i) => v.post(`reservations/${enquiries[i].body.id}/status`, { status: 'confirmed' }));
    expect(ok(promoted, 200)).toBe(1);

    const both = await Promise.all([
      booking(v, 'p1h3', '2031-01-12', '12:00', '16:00', 'confirmed'),
      v.post('hall-blocks', { hallId: v.ids.p1h3, start: '2031-01-12T10:00', end: '2031-01-12T18:00', reasonId: v.ids.blockReason }),
    ]);
    expect(ok(both, 201)).toBe(1);
    const diary = await v.get(`diary?propertyId=${v.ids.p1}&from=2031-01-10&days=3`);
    // One hold per hall: the provisional booking, the promoted enquiry, and the booking or the block.
    expect(diary.body.reservations.filter((r: { status: string }) => r.status !== 'enquiry').length + diary.body.blocks.length).toBe(3);
  });

  it('applies only one of two status changes made at once', async () => {
    const r = await booking(v, 'p1h3', today(), '05:00', '06:00', 'confirmed');
    const res = await Promise.all([
      v.post(`reservations/${r.body.id}/status`, { status: 'cancelled', reasonId: v.ids.cancel }),
      v.post(`reservations/${r.body.id}/status`, { status: 'inFunction' }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(res.find((x) => x.status === 409)!.body.message).toMatch(/changed by someone else/);
    const after = (await v.get(`reservations/${r.body.id}`)).body;
    expect(after.history).toHaveLength(2);
  });

  it('keeps one bill per booking, and bill numbers without gaps', async () => {
    const id = await completedBooking(v, { hall: 'p1h2', from: '07:00', to: '08:00', pax: 10, actual: 12 });
    const drafts = await all(10, () => v.post(`billing/reservations/${id}/draft`, {}));
    expect(ok(drafts, 201)).toBe(1);
    const bill = drafts.find((d) => d.status === 201)!.body;

    const finals = await all(10, () => v.post(`billing/bills/${bill.id}/finalise`, {}));
    expect(ok(finals, 200)).toBe(1);
    const first = Number(finals.find((f) => f.status === 200)!.body.number.split('/').pop());

    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await completedBooking(v, { hall: 'p1h3', from: `${10 + i}:00`, to: `${10 + i}:30`, pax: 10, actual: 10 }));
    const bills = await Promise.all(ids.map((b) => v.post(`billing/reservations/${b}/draft`, {})));
    const numbered = await Promise.all(bills.map((b) => v.post(`billing/bills/${b.body.id}/finalise`, {})));
    const numbers = numbered.map((f) => Number(f.body.number.split('/').pop())).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6].map((n) => first + n));
  });

  it('refuses a draft edit that lands after the bill was finalised', async () => {
    const id = await completedBooking(v, { hall: 'p1h1', from: '20:00', to: '21:00', pax: 10, actual: 10 });
    const bill = (await v.post(`billing/reservations/${id}/draft`, {})).body;
    const [saved, finalised] = await Promise.all([
      v.put(`billing/bills/${bill.id}`, { lines: [{ id: bill.lines[0].id, source: 'package', actualPax: 50 }] }),
      v.post(`billing/bills/${bill.id}/finalise`, {}),
    ]);
    const after = (await v.get(`billing/bills/${bill.id}`)).body;
    // Whichever came first, the final bill matches its own lines.
    expect([saved.status, finalised.status]).toContain(200);
    expect(after.lines[0].qty * after.lines[0].rate).toBe(after.lines[0].amount);
    if (after.status !== 'draft') expect(after.total).toBe(finalised.body.total);
  });

  it('takes one payment when two cashiers settle the same balance', async () => {
    const id = await completedBooking(v, { hall: 'p1h1', from: '22:00', to: '23:00', pax: 10, actual: 10 });
    const b = (await v.post(`billing/reservations/${id}/draft`, {})).body;
    const f = (await v.post(`billing/bills/${b.id}/finalise`, {})).body;
    // A payment that rounds to 0.00 is refused (it would also stop the bill being voided).
    const tiny = await v.post(`billing/bills/${b.id}/payments`, { amount: 0.004, mode: 'cash' });
    expect(tiny.status).toBe(400);
    const paid = await all(8, () => v.post(`billing/bills/${b.id}/payments`, { amount: f.balance, mode: 'cash' }));
    expect(ok(paid, 200)).toBe(1);
  });
});
