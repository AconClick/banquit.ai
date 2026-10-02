import { financialYear } from '../src/billing/billing.service.js';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Bill } from '../src/billing/bill.schema.js';
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
    const head = ids.head = await master('incomeExpenseHead', { code: 'FB', description: 'Food & Beverage' });
    const unit = await master('unit', { description: 'Plate', shortDescription: 'PLT' });
    const main = await master('mainGroup', { code: 'FOOD', description: 'Food' });
    const starters = ids.starters = await master('subGroup', { code: 'ST', description: 'Starters', mainGroupId: main });
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

  it('numbers bills from the property’s Series Setup', async () => {
    const fy = financialYear(today());
    const setup = (await m.get(`billing/setup/${ids.p1}`).expect(200)).body;
    expect(setup).toMatchObject({
      fyStartMonth: 4, financialYear: fy, currency: 'INR', decimals: 2,
      series: { bill: { prefix: 'B/{FY}/', digits: 6, resetYearly: true }, creditNote: { prefix: 'CN/{FY}/', digits: 6, resetYearly: true } },
      next: { bill: { seq: 4, number: `B/${fy}/000004` }, creditNote: { seq: 1 } },
    });
    // Operations users bill, but only the Master panel changes the series.
    await ops.get(`billing/setup/${ids.p1}`).expect(403);

    const bad = await m.put(`billing/setup/${ids.p1}`, {
      fyStartMonth: 13, series: { bill: { prefix: 'INV/', digits: 6, resetYearly: true }, creditNote: { prefix: 'INV/', digits: 6, resetYearly: false } },
    }).expect(400);
    expect(bad.body.message).toEqual([
      'Choose the month the financial year starts.',
      "Bills: put {FY} or {FYSHORT} in the prefix, or the restarted numbers repeat last year's.",
      'Bills and credit notes need different prefixes.',
    ]);
    const low = await m.put(`billing/setup/${ids.p1}`, { nextNumbers: { bill: 2 } }).expect(400);
    expect(low.body.message).toEqual(['Bills: numbers up to 3 are already used this year, so the next is at least 4.']);

    // Moving from another system mid-year: a new prefix, and carry on from number 101.
    const saved = (await m.put(`billing/setup/${ids.p1}`, {
      series: { bill: { prefix: 'KOC/{FYSHORT}/', digits: 4, resetYearly: true } }, nextNumbers: { bill: 101 },
    }).expect(200)).body;
    const short = `${fy.slice(2, 4)}-${fy.slice(5)}`;
    expect(saved.next.bill).toEqual({ seq: 101, number: `KOC/${short}/0101` });

    const r3 = await confirmedBooking({ from: '07:00', to: '09:00', pax: 5, advance: 5000 });
    await complete(r3, 5);
    const draft = (await ops.post(`billing/reservations/${r3}/draft`, {}).expect(201)).body;
    const fin = (await ops.post(`billing/bills/${draft.id}/finalise`, {}).expect(200)).body;
    expect(fin.number).toBe(`KOC/${short}/0101`);
    expect((await m.get(`billing/setup/${ids.p1}`).expect(200)).body.next.bill.number).toBe(`KOC/${short}/0102`);
  });

  it('bills a dinar property to three decimals, from the proforma to the last fils', async () => {
    const company = await master('company', { name: 'Gulf Group', city: 'Kuwait City', state: 'Al Asimah', country: 'Kuwait' });
    const p2 = await master('property', { name: 'Gulf Pearl', companyId: company, city: 'Kuwait City', state: 'Al Asimah', country: 'Kuwait', currency: 'KWD', timeZone: 'Asia/Kuwait' });
    const hall = await master('hall', { description: 'Pearl Ballroom', propertyId: p2, capacity: 200, areaSqFt: 2000 });
    const levy = await master('tax', { description: 'Service levy 5%', taxType: 'percentage', rate: 5, validFrom: '2026-01-01', propertyIds: [p2] });
    const pkg = await master('package', {
      code: 'KWSET', description: 'Kuwaiti Set Menu', ratePerPax: 12.345, taxInclusive: false, propertyIds: [p2],
      incomeExpenseHeadId: ids.head, groups: [{ subGroupId: ids.starters, min: 1, max: 1, itemIds: [ids.tikka] }],
    });
    await m.put(`properties/${p2}/settings`, { roundTotal: false, advancePercent: 10, defaultTaxIds: { package: [levy], alacarte: [levy], services: [levy] } }).expect(200);
    expect((await m.get(`billing/setup/${p2}`).expect(200)).body).toMatchObject({ currency: 'KWD', decimals: 3 });

    const r = await ops.post('reservations', {
      propertyId: p2, status: 'enquiry', hostName: 'Al-Sabah Family', phone: '+96590000111', functionTypeId: ids.wedding,
      guaranteedPax: 7, expectedMaxPax: 10, slots: [{ hallId: hall, start: `${today()}T12:00`, end: `${today()}T15:00` }],
    }).expect(201);
    await ops.put(`reservations/${r.body.id}/menu`, { packages: [{ packageId: pkg, pax: 7, choices: [ids.tikka] }], extras: [] }).expect(200);
    // 7 × 12.345 = 86.415, levy 4.321 (4.32075 rounded to the fils): 90.736.
    const details = (await ops.get(`reservations/${r.body.id}/details`).expect(200)).body;
    expect(details.proforma).toMatchObject({ taxable: 86.415, taxTotal: 4.321, total: 90.736 });
    expect(details.advance).toMatchObject({ required: 9.074 });
    await ops.post(`reservations/${r.body.id}/receipts`, { amount: 10.0006, mode: 'cash' }).expect(201);
    await ops.post(`reservations/${r.body.id}/status`, { status: 'confirmed' }).expect(200);
    await complete(r.body.id, 8);

    const draft = (await ops.post(`billing/reservations/${r.body.id}/draft`, {}).expect(201)).body;
    expect(draft).toMatchObject({ currency: 'KWD', decimals: 3, advances: 10.001 });
    const saved = (await ops.put(`billing/bills/${draft.id}`, {
      lines: [{ id: draft.lines[0].id, source: 'package', actualPax: 8 }, { source: 'running', aType: 'services', label: 'Valet', qty: 1, rate: 1.2346 }],
    }).expect(200)).body;
    // 8 × 12.345 = 98.76 + levy 4.938; valet 1.235 (rate kept to the fils) + 0.062.
    expect(saved.lines.map((l: { total: number }) => l.total)).toEqual([103.698, 1.297]);
    const fin = (await ops.post(`billing/bills/${draft.id}/finalise`, {}).expect(200)).body;
    expect(fin).toMatchObject({ number: `B/${financialYear(today())}/000001`, total: 104.995, balance: 94.994 });
    const over = await ops.post(`billing/bills/${draft.id}/payments`, { amount: 95, mode: 'card' }).expect(400);
    expect(over.body.message).toEqual(['The balance is 94.994; take no more than that.']);
    const paid = (await ops.post(`billing/bills/${draft.id}/payments`, { amount: 94.994, mode: 'card' }).expect(200)).body;
    expect(paid).toMatchObject({ status: 'settled', balance: 0 });
    const list = (await ops.get(`billing/bills?propertyId=${p2}`).expect(200)).body;
    expect(list[0]).toMatchObject({ currency: 'KWD', total: 104.995, balance: 0 });
  });

  it('touches updatedAt on every bill change, so cached reports know to refresh', async () => {
    const r4 = await confirmedBooking({ from: '22:00', to: '23:00', pax: 3, advance: 3000 });
    await complete(r4, 3);
    const stamps: number[] = [];
    const stamp = async (id: string) => {
      const doc = (await t.app.get<Model<Bill>>(getModelToken(Bill.name)).findById(id).lean()) as unknown as { updatedAt: Date };
      stamps.push(new Date(doc.updatedAt).getTime());
    };
    const draft = (await ops.post(`billing/reservations/${r4}/draft`, {}).expect(201)).body;
    await stamp(draft.id);
    for (const step of [
      () => ops.put(`billing/bills/${draft.id}`, { lines: [{ id: draft.lines[0].id, source: 'package', actualPax: 3 }] }).expect(200),
      () => ops.post(`billing/bills/${draft.id}/refresh`, {}).expect(200),
      () => ops.post(`billing/bills/${draft.id}/finalise`, {}).expect(200),
      () => ops.post(`billing/bills/${draft.id}/payments`, { kind: 'refund', amount: 150, mode: 'cash' }).expect(200),
    ]) {
      await new Promise((r) => setTimeout(r, 5));
      await step();
      await stamp(draft.id);
    }
    const other = await confirmedBooking({ from: '23:00', to: '23:30', pax: 1, advance: 1000 });
    const v = (await ops.post(`billing/reservations/${other}/draft`, {}).expect(201)).body;
    await stamp(v.id);
    await new Promise((r) => setTimeout(r, 5));
    await ops.post(`billing/bills/${v.id}/void`, { reason: 'Test' }).expect(200);
    await stamp(v.id);
    for (let i = 1; i < 5; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    expect(stamps[6]).toBeGreaterThan(stamps[5]);
  });

  it('issues credit notes against a final bill, and refunds what they free up', async () => {
    const fy = financialYear(today());
    const bill = (await ops.get(`billing/bills/${ids.bill1}`).expect(200)).body;
    const mocktail = bill.lines.find((l: { label: string }) => l.label === 'Mocktail');
    const open = (await ops.get(`billing/bills/${ids.bill1}/credit-notes`).expect(200)).body;
    expect(open.lines.find((l: { lineId: string }) => l.lineId === mocktail.id)).toMatchObject({ total: 3540, credited: 0, open: 3540 });

    await ops.post(`billing/bills/${ids.bill1}/credit-notes`, { reason: ' ', lines: [{ lineId: mocktail.id, amount: 5000 }] }).expect(400)
      .then((r) => expect(r.body.message).toEqual(['Give the reason for the credit note.', 'Mocktail: only 3540.00 is left to credit.']));
    // Ten mocktails were not served: credit 1,180 (1,000 plus 18% GST) on a settled bill.
    const res = (await ops.post(`billing/bills/${ids.bill1}/credit-notes`, {
      reason: '10 mocktails not served', lines: [{ lineId: mocktail.id, amount: 1180 }],
    }).expect(201)).body;
    expect(res.creditNote).toMatchObject({
      number: `CN/${fy}/000001`, billNumber: bill.number, billDate: bill.date, status: 'issued', currency: 'INR',
      taxable: 1000, taxes: [{ id: ids.gst18, amount: 180 }], total: 1180, roundOff: 0,
    });
    expect(res.bill).toMatchObject({ status: 'partiallySettled', credited: 1180, balance: -1180, creditNotes: [{ number: `CN/${fy}/000001`, total: 1180 }] });
    const refund = (await ops.post(`billing/bills/${ids.bill1}/payments`, { kind: 'refund', amount: 1180, mode: 'upi' }).expect(200)).body;
    expect(refund).toMatchObject({ status: 'settled', balance: 0 });
    const after = (await ops.get(`billing/bills/${ids.bill1}/credit-notes`).expect(200)).body;
    expect(after.lines.find((l: { lineId: string }) => l.lineId === mocktail.id)).toMatchObject({ credited: 1180, open: 2360 });

    // Issued in error: cancelling it puts the 1,180 back on the bill.
    const cancelled = (await ops.post(`billing/credit-notes/${res.creditNote.id}/cancel`, { reason: 'Mocktails were served after all' }).expect(200)).body;
    expect(cancelled.creditNote.status).toBe('cancelled');
    expect(cancelled.bill).toMatchObject({ status: 'partiallySettled', credited: 0, balance: 1180 });
    await ops.post(`billing/credit-notes/${res.creditNote.id}/cancel`, { reason: 'again' }).expect(400);

    // A full credit note brings the whole bill to zero, round-off included; the guest is owed what was paid.
    const full = (await ops.post(`billing/bills/${ids.bill1}/credit-notes`, { reason: 'Function billed to the wrong guest', full: true }).expect(201)).body;
    expect(full.creditNote).toMatchObject({ number: `CN/${fy}/000002`, total: 145628, roundOff: 0.5 });
    expect(full.bill).toMatchObject({ credited: 145628, balance: -(145628 - 1180) });
    await ops.post(`billing/bills/${ids.bill1}/credit-notes`, { reason: 'More', full: true }).expect(400)
      .then((r) => expect(r.body.message).toEqual(['Everything on this bill has been credited already.']));
    const list = (await ops.get(`billing/credit-notes?propertyId=${ids.p1}`).expect(200)).body;
    expect(list.map((n: { number: string; status: string }) => [n.number, n.status])).toEqual([[`CN/${fy}/000002`, 'issued'], [`CN/${fy}/000001`, 'cancelled']]);
    expect((await ops.get(`billing/credit-notes/${full.creditNote.id}`).expect(200)).body.lines).toHaveLength(5);
  });

  it('will not void a bill with credit notes, nor credit a draft', async () => {
    const r5 = await confirmedBooking({ from: '05:00', to: '06:00', pax: 2, advance: 1000 });
    await complete(r5, 2);
    const draft = (await ops.post(`billing/reservations/${r5}/draft`, {}).expect(201)).body;
    await ops.post(`billing/bills/${draft.id}/credit-notes`, { reason: 'x', full: true }).expect(400);
    await ops.post(`billing/bills/${draft.id}/finalise`, {}).expect(200);
    await ops.post(`billing/bills/${draft.id}/credit-notes`, { reason: 'Discount agreed later', lines: [{ lineId: draft.lines[0].id, amount: 100 }] }).expect(201);
    const v = await ops.post(`billing/bills/${draft.id}/void`, { reason: 'Wrong' }).expect(400);
    expect(v.body.message).toMatch(/Credit notes have been issued/);
  });

  it('prints with the property’s Print Setup', async () => {
    const before = (await m.get(`billing/setup/${ids.p1}`).expect(200)).body;
    expect(before.print).toMatchObject({ logo: '', billTitle: 'Tax invoice', proformaTitle: 'Proforma invoice', showDiscountColumn: true, paperSize: 'A4' });
    const svg = await m.put(`billing/setup/${ids.p1}`, { print: { logo: 'data:image/svg+xml;base64,PHN2Zz4=', paperSize: 'A3' } }).expect(400);
    expect(svg.body.message).toEqual([expect.stringMatching(/paperSize must be one of the following values: A4, Letter/)]);
    const bad = await m.put(`billing/setup/${ids.p1}`, { print: { logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }).expect(400);
    expect(bad.body.message).toEqual(['The logo must be a PNG, JPEG or WebP image.']);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const saved = (await m.put(`billing/setup/${ids.p1}`, {
      print: { logo: png, legalName: 'Prime Hotels Pvt Ltd', headerLines: 'MG Road, Kochi 682016\n+91 484 400 0000', registration: 'GSTIN 32ABCDE1234F1Z5',
        billTitle: '', footer: 'Thank you for celebrating with us.', showDiscountColumn: false },
    }).expect(200)).body;
    // An empty title falls back to the default; the series are untouched.
    expect(saved.print).toMatchObject({ logo: png, billTitle: 'Tax invoice', showDiscountColumn: false, footer: 'Thank you for celebrating with us.' });
    expect(saved.series.bill.prefix).toBe('KOC/{FYSHORT}/');
    const view = (await ops.get(`billing/reservations/${ids.r1}`).expect(200)).body;
    expect(view.print).toMatchObject({ legalName: 'Prime Hotels Pvt Ltd', registration: 'GSTIN 32ABCDE1234F1Z5' });
  });

  it('works out the financial year from the date', () => {
    expect(financialYear('2026-10-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYear('2026-10-01', 1)).toBe('2026');
  });
});
