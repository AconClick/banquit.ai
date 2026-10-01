import { financialYear } from '../src/billing/billing.service.js';
import { startApp, tokenOf } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

describe('Banquet billing: draft, final bill and settlement', () => {
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
    if (activity === 'operations') token = tokenOf(res);
    else {
      const sms = [...t.outbox].reverse().find((msg) => /Master access/.test(msg.body))!;
      token = tokenOf(await t.http().post('/api/auth/otp/verify').set('Host', host).auth(token, auth).send({ code: t.otpIn(sms.body) }).expect(200));
    }
    panel = activity;
  }
  const call = (activity: 'master' | 'operations') => {
    const send = (method: 'get' | 'post' | 'put', path: string, body?: object) => ({
      expect: async (status: number) => {
        await use(activity);
        const res = await t.http()[method](`/api/${path}`).set('Host', host).auth(token, auth).send(body);
        if (res.status !== status) console.error('DEBUG', method, path, res.status, JSON.stringify(res.body));
        expect(res.status).toBe(status);
        return res;
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

  /** A confirmed booking with a package, optional extras, and an advance. */
  async function confirmedBooking(opts: { from: string; to: string; pax: number; advance: number; extras?: object[] }) {
    const r = await ops.post('reservations', {
      propertyId: ids.p1, status: 'enquiry', hostName: 'Menon Family', phone: '+919800000111', functionTypeId: ids.wedding,
      guaranteedPax: opts.pax, expectedMaxPax: opts.pax + 20, slots: [{ hallId: ids.hall, start: `${today()}T${opts.from}`, end: `${today()}T${opts.to}` }],
    }).expect(201);
    const id = r.body.id as string;
    await ops.put(`reservations/${id}/menu`, { packages: [{ packageId: ids.pkg, pax: opts.pax, choices: [ids.tikka] }], extras: opts.extras ?? [] }).expect(200);
    await ops.post(`reservations/${id}/receipts`, { amount: opts.advance, mode: 'upi' }).expect(201);
    await ops.post(`reservations/${id}/status`, { status: 'confirmed' }).expect(200);
    return id;
  }
  /** The banquet captain starts the function and closes it with the head count. */
  async function complete(id: string, actualPax: number) {
    await ops.post(`reservations/${id}/status`, { status: 'inFunction' }).expect(200);
    await ops.post(`reservations/${id}/status`, { status: 'completed', actualPax }).expect(200);
  }

  beforeAll(async () => {
    t = await startApp();
    ({ host, token } = await t.tenantWithEntp('billhotel'));
    const company = await master('company', { name: 'Prime Group', city: 'Kochi', state: 'Kerala', country: 'India' });
    ids.p1 = await master('property', { name: 'Prime Residency', companyId: company, city: 'Kochi', state: 'Kerala', country: 'India' });
    ids.hall = await master('hall', { description: 'Roof Top Hall', propertyId: ids.p1, capacity: 300, areaSqFt: 3000 });
    ids.wedding = await master('functionType', { description: 'Wedding Reception' });
    ids.cgst = await master('tax', { description: 'CGST 2.5%', taxType: 'percentage', rate: 2.5, validFrom: '2026-01-01', propertyIds: [ids.p1] });
    ids.sgst = await master('tax', { description: 'SGST 2.5%', taxType: 'percentage', rate: 2.5, validFrom: '2026-01-01', propertyIds: [ids.p1] });
    ids.gst18 = await master('tax', { description: 'GST 18%', taxType: 'percentage', rate: 18, validFrom: '2026-01-01', propertyIds: [ids.p1] });
    const head = await master('incomeExpenseHead', { code: 'FB', description: 'Food & Beverage' });
    const unit = await master('unit', { description: 'Plate', shortDescription: 'PLT' });
    const main = await master('mainGroup', { code: 'FOOD', description: 'Food' });
    const starters = await master('subGroup', { code: 'ST', description: 'Starters', mainGroupId: main });
    const item = (code: string, description: string, over: object = {}) => master('menuItem', {
      code, description, subGroupId: starters, unitId: unit, defaultRate: 0, aType: 'package', incomeExpenseHeadId: head, ...over,
    });
    ids.tikka = await item('S1', 'Chicken Tikka');
    ids.dj = await item('DJ', 'DJ Console', { aType: 'services', defaultRate: 7500 });
    ids.mocktail = await item('MK', 'Mocktail', { aType: 'alacarte', defaultRate: 150 });
    ids.pkg = await master('package', {
      code: 'BLNV', description: 'Buffet Lunch Non Veg', ratePerPax: 950, taxInclusive: true, propertyIds: [ids.p1],
      incomeExpenseHeadId: head, groups: [{ subGroupId: starters, min: 1, max: 1, itemIds: [ids.tikka] }],
    });
    await m.put(`properties/${ids.p1}/settings`, {
      defaultTaxIds: { package: [ids.cgst, ids.sgst], alacarte: [ids.gst18], services: [ids.cgst, ids.sgst] },
    }).expect(200);
  });
  afterAll(() => t.close());

  it('shows the proforma and refuses to bill a booking that is not confirmed', async () => {
    const enquiry = await ops.post('reservations', {
      propertyId: ids.p1, status: 'enquiry', hostName: 'Walk-in', phone: '+919800000222', functionTypeId: ids.wedding,
      guaranteedPax: 10, expectedMaxPax: 10, slots: [{ hallId: ids.hall, start: '2030-06-01T12:00', end: '2030-06-01T15:00' }],
    }).expect(201);
    const res = await ops.post(`billing/reservations/${enquiry.body.id}/draft`, {}).expect(400);
    expect(res.body.message).toBe('Only a confirmed booking can be billed.');

    ids.r1 = await confirmedBooking({ from: '12:00', to: '16:00', pax: 100, advance: 30000, extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1 }] });
    const view = (await ops.get(`billing/reservations/${ids.r1}`).expect(200)).body;
    expect(view.bill).toBeNull();
    // Same numbers as the booking screen: 100 × 950 inclusive, plus DJ 7,500 + 5%.
    expect(view.proforma).toMatchObject({ total: 102875, advances: 30000 });
    expect(view.booking).toMatchObject({ number: expect.stringMatching(/^R-/), functionDate: today(), halls: [{ hours: 4 }] });
  });

  it('drafts the bill from the booking, once', async () => {
    const bill = (await ops.post(`billing/reservations/${ids.r1}/draft`, {}).expect(201)).body;
    ids.bill1 = bill.id;
    expect(bill).toMatchObject({ status: 'draft', number: null, total: 102875, advances: 30000, balance: 72875 });
    expect(bill.lines.map((l: { source: string; qty: number }) => [l.source, l.qty])).toEqual([['package', 100], ['extra', 1]]);
    expect(bill.warnings[0]).toMatch(/Buffet Lunch Non Veg: enter the actual pax/);
    const refreshed = (await ops.post(`billing/bills/${ids.bill1}/refresh`, {}).expect(200)).body;
    expect(refreshed.lines.map((l: { id: string }) => l.id)).toEqual(bill.lines.map((l: { id: string }) => l.id));
    const again = await ops.post(`billing/reservations/${ids.r1}/draft`, {}).expect(409);
    expect(again.body.message).toMatch(/already has a bill/);
    const early = await ops.post(`billing/bills/${ids.bill1}/finalise`, {}).expect(400);
    expect(early.body.message).toEqual([
      'Complete the function (with its actual pax) on the booking before finalising the bill.',
      'Buffet Lunch Non Veg: enter the actual pax.',
    ]);
  });

  it('bills the higher of guaranteed and actual, with running charges, hall hire, licence and discounts', async () => {
    const bill = (await ops.get(`billing/bills/${ids.bill1}`).expect(200)).body;
    const [pkgLine, djLine] = bill.lines;
    const bad = await ops.put(`billing/bills/${ids.bill1}`, {
      lines: [{ id: djLine.id, source: 'extra', discount: { type: 'percent', value: 10, reason: '' } }],
    }).expect(400);
    expect(bad.body.message).toEqual(expect.arrayContaining([
      'DJ Console: discount: give a reason.',
      'Buffet Lunch Non Veg is a booked package and cannot be removed from the bill.',
    ]));
    await ops.put(`billing/bills/${ids.bill1}`, { lines: [{ source: 'package', label: 'Free package', qty: 1, rate: 1 }] }).expect(400);

    const saved = (await ops.put(`billing/bills/${ids.bill1}`, {
      lines: [
        { id: pkgLine.id, source: 'package', actualPax: 120 },
        { id: djLine.id, source: 'extra', discount: { type: 'percent', value: 10, reason: 'Regular guest' } },
        { source: 'running', kind: 'menuItem', itemId: ids.mocktail, qty: 20 },
        { source: 'hallHire', hallId: ids.hall, qty: 4, rate: 2500 },
        { source: 'liquorLicence', qty: 1, rate: 10000 },
      ],
    }).expect(200)).body;
    const byLabel = Object.fromEntries(saved.lines.map((l: { label: string }) => [l.label, l]));
    // 120 came against a guarantee of 100: bill 120 × 950 including tax.
    expect(byLabel['Buffet Lunch Non Veg']).toMatchObject({ guaranteedPax: 100, actualPax: 120, qty: 120, amount: 114000, total: 114000 });
    expect(byLabel['DJ Console']).toMatchObject({ amount: 7500, discount: 750, taxable: 6750, total: 7087.5 });
    // Running charges take the item's rate and the A-Type's default taxes.
    expect(byLabel['Mocktail']).toMatchObject({ rate: 150, amount: 3000, taxIds: [ids.gst18], total: 3540 });
    expect(byLabel['Hall hire: Roof Top Hall']).toMatchObject({ aType: 'services', amount: 10000, total: 10500 });
    expect(byLabel['Liquor licence']).toMatchObject({ total: 10500 });
    // 145,627.50 rounded to 145,628.
    expect(saved).toMatchObject({ total: 145628, roundOff: 0.5, advances: 30000, balance: 115628, warnings: [] });
  });

  it('finalises with a bill number, applies the advance and locks the bill', async () => {
    await complete(ids.r1, 120);
    const fin = (await ops.post(`billing/bills/${ids.bill1}/finalise`, {}).expect(200)).body;
    expect(fin).toMatchObject({ status: 'partiallySettled', number: `B/${financialYear(today())}/000001`, total: 145628, advances: 30000, balance: 115628 });
    expect(fin.advanceReceipts).toEqual([expect.objectContaining({ number: 'RC-000001', amount: 30000 })]);
    const locked = await ops.put(`billing/bills/${ids.bill1}`, { lines: [] }).expect(400);
    expect(locked.body.message).toMatch(/Only a draft bill can be changed/);

    // A later tax rate change does not alter a final bill.
    await m.put(`masters/tax/${ids.gst18}`, { description: 'GST 18%', taxType: 'percentage', rate: 28, validFrom: '2026-01-01', propertyIds: [ids.p1] }).expect(200);
    expect((await ops.get(`billing/bills/${ids.bill1}`).expect(200)).body.total).toBe(145628);
    await m.put(`masters/tax/${ids.gst18}`, { description: 'GST 18%', taxType: 'percentage', rate: 18, validFrom: '2026-01-01', propertyIds: [ids.p1] }).expect(200);
  });

  it('settles in parts and moves the booking to Billed', async () => {
    const over = await ops.post(`billing/bills/${ids.bill1}/payments`, { amount: 200000, mode: 'card' }).expect(400);
    expect(over.body.message).toEqual(['The balance is 115628.00; take no more than that.']);
    await ops.post(`billing/bills/${ids.bill1}/payments`, { amount: 100, mode: 'barter' }).expect(400);
    const part = (await ops.post(`billing/bills/${ids.bill1}/payments`, { amount: 100000, mode: 'card', reference: 'Visa 4411' }).expect(200)).body;
    expect(part).toMatchObject({ status: 'partiallySettled', balance: 15628 });
    const done = (await ops.post(`billing/bills/${ids.bill1}/payments`, { amount: 15628, mode: 'cash' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'settled', balance: 0 });
    expect(done.payments.map((p: { number: string }) => p.number)).toEqual(['PY-000001', 'PY-000002']);
    expect((await ops.get(`reservations/${ids.r1}`).expect(200)).body.status).toBe('billed');
    const v = await ops.post(`billing/bills/${ids.bill1}/void`, { reason: 'Wrong guest' }).expect(400);
    expect(v.body.message).toMatch(/cannot be voided/);
  });

  it('voids an unpaid final bill so the booking can be billed again, and refunds excess advances', async () => {
    const r2 = await confirmedBooking({ from: '19:00', to: '22:00', pax: 10, advance: 12000 });
    await complete(r2, 8);
    const draft = (await ops.post(`billing/reservations/${r2}/draft`, {}).expect(201)).body;
    // The booking's actual pax fills its only package line.
    expect(draft.lines[0]).toMatchObject({ guaranteedPax: 10, actualPax: 8, qty: 10 });
    // A cashier can take payments but not finalise or void: that needs "approve bill".
    const role = (await m.post('roles', { name: 'Cashier', permissions: ['billing.manage'] }).expect(201)).body;
    await m.post('users', { userId: 'cashier1', firstName: 'Ravi', email: 'ravi@billhotel.test', roleId: role.id }).expect(201);
    const first = await t.http().post('/api/auth/login').set('Host', host)
      .send({ userId: 'cashier1', password: t.passwordIn(t.lastMessage('ravi@billhotel.test').body) }).expect(200);
    const changed = await t.http().post('/api/auth/change-password').set('Host', host).auth(tokenOf(first), auth)
      .send({ currentPassword: t.passwordIn(t.lastMessage('ravi@billhotel.test').body), newPassword: 'Ravi2026xx' }).expect(200);
    const cashier = tokenOf(await t.http().post('/api/auth/activity').set('Host', host).auth(tokenOf(changed), auth).send({ activity: 'operations' }).expect(200));
    await t.http().post(`/api/billing/bills/${draft.id}/finalise`).set('Host', host).auth(cashier, auth).send({}).expect(403);
    await t.http().get(`/api/billing/bills/${draft.id}`).set('Host', host).auth(cashier, auth).expect(200);

    const fin = (await ops.post(`billing/bills/${draft.id}/finalise`, {}).expect(200)).body;
    // 8 came against a guarantee of 10: bill 10 × 950. The guest paid 12,000.
    expect(fin).toMatchObject({ total: 9500, balance: -2500, status: 'partiallySettled' });
    await ops.post(`billing/bills/${draft.id}/void`, { reason: ' ' }).expect(400);
    const voided = (await ops.post(`billing/bills/${draft.id}/void`, { reason: 'Wrong billing instructions' }).expect(200)).body;
    expect(voided.status).toBe('void');

    const redo = (await ops.post(`billing/reservations/${r2}/draft`, {}).expect(201)).body;
    const fin2 = (await ops.post(`billing/bills/${redo.id}/finalise`, {}).expect(200)).body;
    expect(fin2.number).toBe(`B/${financialYear(today())}/000003`);
    await ops.post(`billing/bills/${redo.id}/payments`, { amount: 10, mode: 'cash' }).expect(400);
    await ops.post(`billing/bills/${redo.id}/payments`, { kind: 'refund', amount: 3000, mode: 'bankTransfer' }).expect(400);
    const refunded = (await ops.post(`billing/bills/${redo.id}/payments`, { kind: 'refund', amount: 2500, mode: 'bankTransfer' }).expect(200)).body;
    expect(refunded).toMatchObject({ status: 'settled', balance: 0, paid: -2500 });
    expect(refunded.payments[0].number).toBe('RF-000001');

    const view = (await ops.get(`billing/reservations/${r2}`).expect(200)).body;
    expect(view.bill.id).toBe(redo.id);
    expect(view.voided).toEqual([{ id: draft.id, number: fin.number, voidReason: 'Wrong billing instructions' }]);
    const list = (await ops.get(`billing/bills?propertyId=${ids.p1}&status=settled`).expect(200)).body;
    expect(list.map((b: { number: string }) => b.number).sort()).toEqual([fin2.number, `B/${financialYear(today())}/000001`].sort());
  });

  it('works out the financial year from the date', () => {
    expect(financialYear('2026-10-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYear('2026-10-01', 1)).toBe('2026');
  });
});
