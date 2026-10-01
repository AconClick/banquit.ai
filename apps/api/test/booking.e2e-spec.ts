import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import { ReservationsService } from '../src/reservations/reservations.service.js';
import { startApp } from './helpers.js';

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

describe('Property prices, booking menus, advances and cancellation', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let host: string;
  let token: string;
  let panel: 'master' | 'operations' = 'master';
  const auth = { type: 'bearer' as const };
  const ids: Record<string, string> = {};
  /** One user has one session, so the tests switch panels the way the web app does. */
  async function use(activity: 'master' | 'operations') {
    if (panel === activity) return;
    const res = await t.http().post('/api/auth/activity').set('Host', host).auth(token, auth).send({ activity }).expect(200);
    if (activity === 'operations') token = res.body.token;
    else {
      const sms = [...t.outbox].reverse().find((msg) => /Master access/.test(msg.body))!;
      token = (await t.http().post('/api/auth/otp/verify').set('Host', host).auth(token, auth).send({ code: t.otpIn(sms.body) }).expect(200)).body.token;
    }
    panel = activity;
  }
  const call = (activity: 'master' | 'operations') => {
    const send = (method: 'get' | 'post' | 'put', path: string, body?: object) => ({
      expect: async (status: number) => {
        await use(activity);
        return t.http()[method](`/api/${path}`).set('Host', host).auth(token, auth).send(body).expect(status);
      },
    });
    return {
      get: (path: string) => send('get', path),
      post: (path: string, body: object) => send('post', path, body),
      put: (path: string, body: object) => send('put', path, body),
    };
  };
  const m = call('master');
  const ops = call('operations');
  const master = async (kind: string, body: object) => (await m.post(`masters/${kind}`, body).expect(201)).body.id as string;
  const book = (over: object = {}) => ({
    propertyId: ids.p1, status: 'enquiry', hostName: 'Menon Family', phone: '+919800000111', functionTypeId: ids.wedding,
    guaranteedPax: 100, expectedMaxPax: 120, slots: [{ hallId: ids.hall1, start: '2030-07-01T19:00', end: '2030-07-01T23:00' }], ...over,
  });

  beforeAll(async () => {
    t = await startApp();
    ({ host, token } = await t.tenantWithEntp('menuhotel'));
    const company = await master('company', { name: 'Prime Group', city: 'Kochi', state: 'Kerala', country: 'India' });
    ids.p1 = await master('property', { name: 'Prime Residency', companyId: company, city: 'Kochi', state: 'Kerala', country: 'India' });
    ids.p2 = await master('property', { name: 'Prime Beach Resort', companyId: company, city: 'Goa', state: 'Goa', country: 'India' });
    ids.hall1 = await master('hall', { description: 'Roof Top Hall', propertyId: ids.p1, capacity: 300, areaSqFt: 3000 });
    ids.hall2 = await master('hall', { description: 'Sea Lawn', propertyId: ids.p2, capacity: 300, areaSqFt: 5000 });
    ids.wedding = await master('functionType', { description: 'Wedding Reception' });
    ids.cancel = await master('cancellationReason', { description: 'Guest postponed' });
    ids.amend = await master('amendmentReason', { description: 'Guest request' });
    ids.cgst = await master('tax', { description: 'CGST 2.5%', taxType: 'percentage', rate: 2.5, validFrom: '2026-01-01', propertyIds: [ids.p1, ids.p2] });
    ids.sgst = await master('tax', { description: 'SGST 2.5%', taxType: 'percentage', rate: 2.5, validFrom: '2026-01-01', propertyIds: [ids.p1, ids.p2] });
    ids.head = await master('incomeExpenseHead', { code: 'FB', description: 'Food & Beverage' });
    ids.unit = await master('unit', { description: 'Plate', shortDescription: 'PLT' });
    const main = await master('mainGroup', { code: 'FOOD', description: 'Food' });
    ids.starters = await master('subGroup', { code: 'ST', description: 'Starters', mainGroupId: main });
    const item = (code: string, description: string, over: object = {}) => master('menuItem', {
      code, description, subGroupId: ids.starters, unitId: ids.unit, defaultRate: 0, aType: 'package', incomeExpenseHeadId: ids.head, ...over,
    });
    ids.tikka = await item('S1', 'Chicken Tikka');
    ids.fish = await item('S2', 'Fish Fingers');
    ids.paneer = await item('S3', 'Paneer Tikka');
    ids.dj = await item('DJ', 'DJ Console', { aType: 'services', defaultRate: 7500 });
    ids.surf = await item('SURF', 'Surf Lessons', { aType: 'services', defaultRate: 2000, propertyIds: [ids.p2] });
    ids.pkg = await master('package', {
      code: 'BLNV', description: 'Buffet Lunch Non Veg', ratePerPax: 950, taxInclusive: true, propertyIds: [ids.p1, ids.p2],
      incomeExpenseHeadId: ids.head, groups: [{ subGroupId: ids.starters, min: 2, max: 2, itemIds: [ids.tikka, ids.fish, ids.paneer] }],
    });
  });
  afterAll(() => t.close());

  it('gives every property the default settings and validates changes', async () => {
    const s = (await m.get(`properties/${ids.p1}/settings`).expect(200)).body;
    expect(s).toMatchObject({ advancePercent: 25, secondInstalmentPercent: 75, optionDays: 7, roundTotal: true });
    expect(s.cancellationSlabs).toHaveLength(4);
    const bad = await m.put(`properties/${ids.p1}/settings`, { cancellationSlabs: [{ fromDays: 10, percent: 50 }] }).expect(400);
    expect(bad.body.message).toContain('One cancellation slab must start at 0 days, for late cancellations.');
    await m.put(`properties/${ids.p1}/settings`, { advancePercent: 150 }).expect(400);
    const saved = await m.put(`properties/${ids.p1}/settings`, {
      optionDays: 2, defaultTaxIds: { package: [ids.cgst, ids.sgst], alacarte: [], services: [ids.cgst, ids.sgst] },
    }).expect(200);
    expect(saved.body).toMatchObject({ optionDays: 2, advancePercent: 25 });
    // Changing settings is Master setup only.
    await ops.put(`properties/${ids.p1}/settings`, { optionDays: 3 }).expect(403);
  });

  it('lists what each property sells and lets a property change price, tax and availability', async () => {
    const sheet1 = (await m.get(`properties/${ids.p1}/rates`).expect(200)).body as { id: string; rate: number }[];
    expect(sheet1.map((i) => i.id).sort()).toEqual([ids.pkg, ids.dj].sort());
    const sheet2 = (await m.get(`properties/${ids.p2}/rates`).expect(200)).body as { id: string }[];
    expect(sheet2.map((i) => i.id)).toContain(ids.surf);

    const pkg2 = await m.put(`properties/${ids.p2}/rates/package/${ids.pkg}`, { offered: true, rate: 1200, taxInclusive: false, taxIds: [ids.cgst] }).expect(200);
    expect(pkg2.body).toMatchObject({ rate: 1200, groupRate: 950, taxInclusive: false, taxIds: [ids.cgst], overridden: true });
    await m.put(`properties/${ids.p2}/rates/menuItem/${ids.dj}`, { offered: false, rate: null, taxInclusive: null, taxIds: null }).expect(200);
    // Surf lessons are only set up for the beach resort.
    await m.put(`properties/${ids.p1}/rates/menuItem/${ids.surf}`, { offered: true, rate: 1, taxInclusive: null, taxIds: null }).expect(400);
    // The first property still sells at the group price.
    const p1pkg = (await m.get(`properties/${ids.p1}/rates`).expect(200)).body.find((i: { id: string }) => i.id === ids.pkg);
    expect(p1pkg).toMatchObject({ rate: 950, taxInclusive: true, overridden: false });
  });

  it('takes package menu choices and extras, and prices the proforma with property taxes', async () => {
    const r = await ops.post('reservations', book()).expect(201);
    ids.r1 = r.body.id;
    const options = (await ops.get(`reservations/${ids.r1}/menu-options`).expect(200)).body;
    expect(options.packages[0].groups[0]).toMatchObject({ name: 'Starters', min: 2, max: 2 });
    expect(options.extras.map((e: { id: string }) => e.id)).toEqual([ids.dj]);

    const tooMany = await ops.put(`reservations/${ids.r1}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 100, choices: [ids.tikka, ids.fish, ids.paneer] }], extras: [],
    }).expect(400);
    expect(tooMany.body.message[0]).toMatch(/pick at most 2/);
    await ops.put(`reservations/${ids.r1}/menu`, { packages: [], extras: [{ kind: 'menuItem', itemId: ids.surf, qty: 1 }] }).expect(400);

    const one = await ops.put(`reservations/${ids.r1}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 100, choices: [ids.tikka] }], extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1 }],
    }).expect(200);
    expect(one.body.menuWarnings).toEqual(['Buffet Lunch Non Veg: choose 1 more from Starters.']);

    const d = (await ops.put(`reservations/${ids.r1}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 100, choices: [ids.tikka, ids.fish] }], extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1, note: 'Till 11 pm' }],
    }).expect(200)).body;
    expect(d.menuWarnings).toEqual([]);
    expect(d.packages[0].choices.map((c: { name: string }) => c.name)).toEqual(['Chicken Tikka', 'Fish Fingers']);
    // 100 × 950 including CGST + SGST (each rounded: 2,261.90), plus a DJ at 7,500 + 5%.
    expect(d.proforma.lines[0]).toMatchObject({ amount: 95000, taxable: 90476.2, total: 95000 });
    expect(d.proforma.lines[1]).toMatchObject({ taxable: 7500, total: 7875 });
    expect(d.proforma.total).toBe(102875);
    expect(d.advance).toMatchObject({ percent: 25, required: 25718.75, paid: 0, secondInstalment: { amount: 77156.25, dueDate: '2030-06-24' } });
  });

  it('keeps the agreed rate when the group price changes later', async () => {
    await m.put(`masters/package/${ids.pkg}`, {
      code: 'BLNV', description: 'Buffet Lunch Non Veg', ratePerPax: 999, taxInclusive: true, propertyIds: [ids.p1, ids.p2],
      incomeExpenseHeadId: ids.head, groups: [{ subGroupId: ids.starters, min: 2, max: 2, itemIds: [ids.tikka, ids.fish, ids.paneer] }],
    }).expect(200);
    const d = (await ops.put(`reservations/${ids.r1}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 110, choices: [ids.tikka, ids.fish] }], extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1 }],
    }).expect(200)).body;
    expect(d.packages[0]).toMatchObject({ rate: 950, pax: 110 });
    await ops.put(`reservations/${ids.r1}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 100, choices: [ids.tikka, ids.fish] }], extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1 }],
    }).expect(200);
  });

  it('needs the advance (or a note from a user allowed to skip it) to confirm', async () => {
    // entp may confirm without the advance, but only with a note.
    const noNote = await ops.post(`reservations/${ids.r1}/status`, { status: 'confirmed' }).expect(400);
    expect(noNote.body.message).toBe('Give a note to confirm without the full advance.');
    await ops.post(`reservations/${ids.r1}/receipts`, { amount: 0, mode: 'cash' }).expect(400);
    await ops.post(`reservations/${ids.r1}/receipts`, { amount: 100, mode: 'barter' }).expect(400);
    const paid = (await ops.post(`reservations/${ids.r1}/receipts`, { amount: 30000, mode: 'upi', reference: 'UTR 4411' }).expect(201)).body;
    expect(paid.receipts[0]).toMatchObject({ number: 'RC-000001', amount: 30000, mode: 'upi' });
    expect(paid.advance).toMatchObject({ paid: 30000, shortBy: 0 });
    await ops.post(`reservations/${ids.r1}/status`, { status: 'confirmed' }).expect(200);
    // Menu changes on a confirmed booking need an amendment reason.
    await ops.put(`reservations/${ids.r1}/menu`, { packages: [], extras: [] }).expect(400);
  });

  it('cancels far ahead with no charge and refunds the advance', async () => {
    const preview = (await ops.get(`reservations/${ids.r1}/details`).expect(200)).body.cancellationPreview;
    expect(preview).toMatchObject({ percent: 0, charge: 0, refundDue: 30000 });
    const res = (await ops.post(`reservations/${ids.r1}/status`, { status: 'cancelled', reasonId: ids.cancel }).expect(200)).body;
    expect(res.status).toBe('cancelled');
    const d = (await ops.get(`reservations/${ids.r1}/details`).expect(200)).body;
    expect(d.cancellation).toMatchObject({ percent: 0, charge: 0, retained: 0, refundDue: 30000, balanceDue: 0 });
    expect(d.cancellationPreview).toBeNull();
  });

  it('charges by slab close to the date, uses the property price and tax mapping, and allows a waiver with a note', async () => {
    const day = addDays(today(), 10);
    const r = await ops.post('reservations', book({
      propertyId: ids.p2, status: 'provisional', guaranteedPax: 10, expectedMaxPax: 10,
      slots: [{ hallId: ids.hall2, start: `${day}T19:00`, end: `${day}T22:00` }],
    })).expect(201);
    const d = (await ops.put(`reservations/${r.body.id}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 10, choices: [ids.tikka, ids.fish] }], extras: [], amendmentReasonId: ids.amend,
    }).expect(200)).body;
    // Beach resort: 1,200 + CGST only.
    expect(d.proforma).toMatchObject({ taxable: 12000, taxTotal: 300, total: 12300 });
    expect(d.cancellationPreview).toMatchObject({ daysBefore: 10, percent: 50, computed: 6150, balanceDue: 6150 });

    await ops.post(`reservations/${r.body.id}/receipts`, { amount: 2000, mode: 'cash' }).expect(201);
    const waiveNoNote = await ops.post(`reservations/${r.body.id}/status`, { status: 'cancelled', reasonId: ids.cancel, cancellationCharge: 1000 }).expect(400);
    expect(waiveNoNote.body.message).toBe('Give a note when reducing the cancellation charge.');
    await ops.post(`reservations/${r.body.id}/status`, { status: 'cancelled', reasonId: ids.cancel, cancellationCharge: 9000, note: 'x' }).expect(400);
    await ops.post(`reservations/${r.body.id}/status`, { status: 'cancelled', reasonId: ids.cancel, cancellationCharge: 3000, note: 'Regular client' }).expect(200);
    const after = (await ops.get(`reservations/${r.body.id}/details`).expect(200)).body;
    expect(after.cancellation).toMatchObject({ computed: 6150, charge: 3000, retained: 2000, refundDue: 0, balanceDue: 1000 });
  });

  it('runs a function on its day, needs actual pax to complete it, and lets billing mark it billed', async () => {
    const day = today();
    const r = (await ops.post('reservations', book({ status: 'confirmed', slots: [{ hallId: ids.hall1, start: `${day}T19:00`, end: `${day}T23:00` }] })).expect(201)).body;
    const early = (await ops.post('reservations', book({ status: 'confirmed', slots: [{ hallId: ids.hall1, start: '2030-09-01T19:00', end: '2030-09-01T23:00' }] })).expect(201)).body;
    await ops.post(`reservations/${early.id}/status`, { status: 'inFunction' }).expect(400);
    await ops.post(`reservations/${r.id}/status`, { status: 'completed', actualPax: 90 }).expect(400);
    await ops.post(`reservations/${r.id}/status`, { status: 'inFunction' }).expect(200);
    const noPax = await ops.post(`reservations/${r.id}/status`, { status: 'completed' }).expect(400);
    expect(noPax.body.message).toBe('Enter the actual pax (a whole number) to complete the function.');
    const done = (await ops.post(`reservations/${r.id}/status`, { status: 'completed', actualPax: 112 }).expect(200)).body;
    expect(done).toMatchObject({ status: 'completed', actualPax: 112 });
    // Billed is reached only through billing, never by a status change from the screen.
    await ops.post(`reservations/${r.id}/status`, { status: 'billed' }).expect(400);
    const doc = await t.app.get<Connection>(getConnectionToken()).collection('reservations').findOne({ _id: new Types.ObjectId(r.id as string) });
    const tenantId = doc!.tenantId as Types.ObjectId;
    const billed = await t.app.get(ReservationsService).markBilled(tenantId, 'billing-test', r.id, 'B-000001');
    expect(billed.status).toBe('billed');
    expect(billed.history.at(-1)).toMatchObject({ from: 'completed', to: 'billed', note: 'Bill B-000001 settled' });
    await expect(t.app.get(ReservationsService).markBilled(tenantId, 'billing-test', early.id, 'B-2')).rejects.toThrow(/cannot be marked billed/);
  });

  it('uses the property option period for provisional bookings', async () => {
    const r = await ops.post('reservations', book({ status: 'provisional', slots: [{ hallId: ids.hall1, start: '2030-08-01T19:00', end: '2030-08-01T23:00' }] })).expect(201);
    expect(r.body.optionDate).toBe(addDays(today(), 2));
  });
});
