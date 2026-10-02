import { startApp, tokenOf } from './helpers.js';

describe('Reports and forecast', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  const auth = { type: 'bearer' as const };
  const ids: Record<string, string> = {};
  const day = '2030-07-01';
  let host: string;
  let token: string;

  const as = (h: string, tok: string) => ({
    get: (path: string) => t.http().get(`/api/${path}`).set('Host', h).auth(tok, auth),
    post: (path: string, body: object) => t.http().post(`/api/${path}`).set('Host', h).auth(tok, auth).send(body),
  });
  const operationsToken = async (h: string) => {
    const login = await t.http().post('/api/auth/login').set('Host', h).send({ userId: 'entp', password: 'Start2026x' }).expect(200);
    return tokenOf(await t.http().post('/api/auth/activity').set('Host', h).auth(tokenOf(login), auth).send({ activity: 'operations' }).expect(200)) as string;
  };
  /** A tenant with one property, two halls and a function type. */
  async function setUp(subdomain: string) {
    const m = await t.tenantWithEntp(subdomain);
    const api = as(m.host, m.token);
    const master = async (kind: string, body: object) => (await api.post(`masters/${kind}`, body).expect(201)).body.id as string;
    const company = await master('company', { name: 'Group', city: 'Kochi', state: 'Kerala', country: 'India' });
    const property = await master('property', { name: `${subdomain} Residency`, companyId: company, city: 'Kochi', state: 'Kerala', country: 'India' });
    const roof = await master('hall', { description: 'Roof Top Hall', propertyId: property, capacity: 150, areaSqFt: 3000 });
    const mezz = await master('hall', { description: 'Mezzanine', propertyId: property, capacity: 60, areaSqFt: 900 });
    const wedding = await master('functionType', { description: 'Wedding' });
    const amendReason = await master('amendmentReason', { description: 'Guest request' });
    const head = await master('incomeExpenseHead', { code: 'FB', description: 'Food & Beverage' });
    const unit = await master('unit', { description: 'Plate', shortDescription: 'PLT' });
    const food = await master('mainGroup', { code: 'FOOD', description: 'Food' });
    const starters = await master('subGroup', { code: 'ST', description: 'Starters', mainGroupId: food });
    const item = (code: string, description: string, over: object = {}) => master('menuItem', {
      code, description, subGroupId: starters, unitId: unit, defaultRate: 0, aType: 'package', incomeExpenseHeadId: head, ...over,
    });
    const tikka = await item('S1', 'Chicken Tikka');
    const fish = await item('S2', 'Fish Fingers');
    const dj = await item('DJ', 'DJ Console', { aType: 'services', defaultRate: 7500 });
    const pkg = await master('package', {
      code: 'BLNV', description: 'Buffet Lunch Non Veg', ratePerPax: 950, propertyIds: [property],
      incomeExpenseHeadId: head, groups: [{ subGroupId: starters, min: 1, max: 2, itemIds: [tikka, fish] }],
    });
    return { host: m.host, token: await operationsToken(m.host), property, roof, mezz, wedding, tikka, fish, dj, pkg, amendReason };
  }
  const book = (over: object = {}) => ({
    propertyId: ids.property, status: 'confirmed', hostName: 'POSist', phone: '+919800000111', functionTypeId: ids.wedding,
    guaranteedPax: 100, expectedMaxPax: 120, slots: [{ hallId: ids.roof, start: `${day}T12:00`, end: `${day}T16:00` }], ...over,
  });
  const range = (from = day, to = '2030-07-07', extra = '') => `from=${from}&to=${to}&propertyId=${ids.property}${extra}`;

  beforeAll(async () => {
    t = await startApp();
    const a = await setUp('reporthotel');
    ({ host, token } = a);
    Object.assign(ids, { property: a.property, roof: a.roof, mezz: a.mezz, wedding: a.wedding, tikka: a.tikka, fish: a.fish, dj: a.dj, pkg: a.pkg });
    const api = as(host, token);
    const first = await api.post('reservations', book()).expect(201);
    await t.http().put(`/api/reservations/${first.body.id}/menu`).set('Host', host).auth(token, auth).send({
      packages: [{ packageId: ids.pkg, pax: 100, choices: [ids.tikka, ids.fish] }], extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1 }],
      amendmentReasonId: a.amendReason,
    }).expect(200);
    await api.post('reservations', book({ status: 'provisional', guaranteedPax: 40, expectedMaxPax: 50, slots: [{ hallId: ids.mezz, start: '2030-07-02T10:00', end: '2030-07-02T13:00' }] })).expect(201);
    const lost = await api.post('reservations', book({ status: 'enquiry', guaranteedPax: 30, expectedMaxPax: 40, slots: [{ hallId: ids.mezz, start: '2030-07-03T10:00', end: '2030-07-03T13:00' }] })).expect(201);
    await api.post(`reservations/${lost.body.id}/status`, { status: 'lost' }).expect(200);
  });
  afterAll(() => t.close());

  it('needs a login in the Operations panel', async () => {
    await t.http().get(`/api/reports/forecast?${range()}`).set('Host', host).expect(401);
    const master = await t.tenantWithEntp('panelhotel');
    const res = await as(master.host, master.token).get(`reports/forecast?from=${day}&to=${day}`).expect(403);
    expect(res.body.message).toMatch(/operations panel/);
  });

  it('checks the dates and range', async () => {
    const api = as(host, token);
    await api.get('reports/forecast?from=2030-07-10&to=2030-07-01').expect(400);
    await api.get('reports/forecast?from=2030-07-01&to=2030-12-31').expect(400);
    await api.get('reports/bookings-by-status?from=bad&to=2030-07-01').expect(400);
  });

  it('forecasts hall availability per day', async () => {
    const res = await as(host, token).get(`reports/forecast?${range(day, '2030-07-03')}`).expect(200);
    const roof = res.body.halls.find((h: { hallName: string }) => h.hallName === 'Roof Top Hall');
    const mezz = res.body.halls.find((h: { hallName: string }) => h.hallName === 'Mezzanine');
    expect(roof.days.map((d: { state: string }) => d.state)).toEqual(['confirmed', 'free', 'free']);
    expect(mezz.days.map((d: { state: string }) => d.state)).toEqual(['free', 'provisional', 'free']);
    expect(res.body.days[0]).toMatchObject({ functions: 1, guaranteedPax: 100, hallsAvailable: 1, hallsTotal: 2 });
    expect(res.body.demand.packages).toEqual([{ packageId: ids.pkg, name: 'Buffet Lunch Non Veg', bookings: 1, pax: 100, provisionalPax: 0 }]);
    expect(res.body.demand.dishes.map((d: { name: string; pax: number }) => [d.name, d.pax])).toEqual([['Chicken Tikka', 100], ['Fish Fingers', 100]]);
    expect(res.body.demand.extras).toEqual([{ itemId: ids.dj, name: 'DJ Console', aType: 'services', qty: 1, provisionalQty: 0 }]);
  });

  it('reports bookings by status, occupancy, conversion and function sheets', async () => {
    const api = as(host, token);
    const status = await api.get(`reports/bookings-by-status?${range()}`).expect(200);
    expect(status.body.total.bookings).toBe(3);
    expect(status.body.rows).toContainEqual({ status: 'lost', bookings: 1, guaranteedPax: 30, expectedMaxPax: 40 });

    const occupancy = await api.get(`reports/hall-occupancy?${range()}`).expect(200);
    expect(occupancy.body.rows.find((r: { hallName: string }) => r.hallName === 'Roof Top Hall')).toMatchObject({ functions: 1, confirmedHours: 4, daysUsed: 1, daysInRange: 7 });

    const today = new Date().toISOString().slice(0, 10);
    const conversion = await api.get(`reports/enquiry-conversion?${range(today, today)}`).expect(200);
    expect(conversion.body.total).toMatchObject({ received: 3, converted: 1, open: 1, lost: 1 });

    const sheets = await api.get(`reports/function-sheets?${range()}`).expect(200);
    expect(sheets.body.rows).toHaveLength(1);
    expect(sheets.body.rows[0]).toMatchObject({ hall: 'Roof Top Hall', functionType: 'Wedding', hostName: 'POSist' });

  });

  it('reports revenue from final bills only', async () => {
    const api = as(host, token);
    const today = new Date().toISOString().slice(0, 10);
    const r = (await api.post('reservations', book({ status: 'enquiry', slots: [{ hallId: ids.roof, start: `${today}T00:00`, end: `${today}T04:00` }] })).expect(201)).body;
    const put = (path: string, body: object) => t.http().put(`/api/${path}`).set('Host', host).auth(token, auth).send(body);
    await put(`reservations/${r.id}/menu`, {
      packages: [{ packageId: ids.pkg, pax: 100, choices: [ids.tikka] }], extras: [{ kind: 'menuItem', itemId: ids.dj, qty: 1 }],
    }).expect(200);
    await api.post(`reservations/${r.id}/receipts`, { amount: 30000, mode: 'upi' }).expect(201);
    await api.post(`reservations/${r.id}/status`, { status: 'confirmed' }).expect(200);
    await api.post(`reservations/${r.id}/status`, { status: 'inFunction' }).expect(200);
    await api.post(`reservations/${r.id}/status`, { status: 'completed', actualPax: 110 }).expect(200);
    const bill = (await api.post(`billing/reservations/${r.id}/draft`, {}).expect(201)).body;

    // A draft bill is not revenue yet.
    const before = await api.get(`reports/revenue?${range(today, today)}`).expect(200);
    expect(before.body.bills).toHaveLength(0);

    await api.post(`billing/bills/${bill.id}/finalise`, {}).expect(200);
    await api.post(`billing/bills/${bill.id}/payments`, { amount: 50000, mode: 'card' }).expect(200);
    const res = (await api.get(`reports/revenue?${range(today, today)}`).expect(200)).body;
    // 110 pax billed (more than the 100 guaranteed) at 950, plus the DJ at 7,500; no taxes set up.
    expect(res.total).toMatchObject({ bills: 1, taxable: 112000, taxTotal: 0, total: 112000, collected: 80000, balance: 32000 });
    expect(res.currency).toBe('INR');
    expect(res.byAType).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'package', label: 'Packages', taxable: 104500 }),
      expect.objectContaining({ key: 'services', label: 'Services', taxable: 7500 }),
    ]));
    expect(res.bills[0]).toMatchObject({ reservationNumber: r.number, status: 'partiallySettled', total: 112000, balance: 32000 });

    // A credit note on the DJ comes off revenue and off what is still to collect. It is dated
    // the property's today, which can be tomorrow in UTC, so the range takes in tomorrow too.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const lines = (await api.get(`billing/bills/${bill.id}/credit-notes`).expect(200)).body.lines as { lineId: string; total: number }[];
    const dj = lines.find((l) => l.total === 7500)!;
    const note = (await api.post(`billing/bills/${bill.id}/credit-notes`, { reason: 'DJ left early', lines: [{ lineId: dj.lineId, amount: 2000 }] }).expect(201)).body.creditNote;
    const credited = (await api.get(`reports/revenue?${range(today, tomorrow)}`).expect(200)).body;
    expect(credited.total).toMatchObject({ total: 112000, credited: 2000, balance: 30000, creditNotes: { notes: 1, taxable: 2000, total: 2000 }, net: { taxable: 110000, total: 110000 } });
    expect(credited.byAType.find((x: { key: string }) => x.key === 'services')).toMatchObject({ total: 7500, credited: 2000, net: 5500 });
    expect(credited.bills[0]).toMatchObject({ credited: 2000, balance: 30000 });
    // Cancelled, it no longer counts.
    await api.post(`billing/credit-notes/${note.id}/cancel`, { reason: 'Issued in error' }).expect(200);
    const cancelled = (await api.get(`reports/revenue?${range(today, tomorrow)}`).expect(200)).body;
    expect(cancelled.total).toMatchObject({ credited: 0, balance: 32000, creditNotes: { notes: 0, total: 0 }, net: { total: 112000 } });

    // Another tenant never sees these bills.
    const other = await setUp('revenuehotel');
    const theirs = await as(other.host, other.token).get(`reports/revenue?from=${today}&to=${today}`).expect(200);
    expect(theirs.body.bills).toHaveLength(0);
  });

  it('shows changes to bookings at once, after the report was read', async () => {
    const s = await setUp('cachehotel');
    const api = as(s.host, s.token);
    const get = async (report: string, from: string, to: string) => (await api.get(`reports/${report}?from=${from}&to=${to}&propertyId=${s.property}`).expect(200)).body;
    const roof = (rows: { hallName: string }[]) => rows.find((r) => r.hallName === 'Roof Top Hall');
    // Read first, so September and October are summarised before anything is booked.
    expect((await get('bookings-by-status', '2030-09-01', '2030-10-31')).total.bookings).toBe(0);

    const body = {
      propertyId: s.property, status: 'provisional', hostName: 'Cache Test', phone: '+919800000222', functionTypeId: s.wedding,
      guaranteedPax: 50, expectedMaxPax: 60, slots: [{ hallId: s.roof, start: '2030-09-10T12:00', end: '2030-09-10T16:00' }],
    };
    const r = (await api.post('reservations', body).expect(201)).body;
    expect((await get('bookings-by-status', '2030-09-01', '2030-09-30')).rows).toEqual([{ status: 'provisional', bookings: 1, guaranteedPax: 50, expectedMaxPax: 60 }]);
    expect(roof((await get('hall-occupancy', '2030-09-01', '2030-09-30')).rows)).toMatchObject({ functions: 1, provisionalHours: 4, daysUsed: 1 });

    // Moved to October, over midnight: September no longer counts it.
    await t.http().put(`/api/reservations/${r.id}`).set('Host', s.host).auth(s.token, auth)
      .send({ ...body, amendmentReasonId: s.amendReason, slots: [{ hallId: s.roof, start: '2030-10-05T18:00', end: '2030-10-06T02:00' }] }).expect(200);
    expect((await get('bookings-by-status', '2030-09-01', '2030-09-30')).total.bookings).toBe(0);
    expect(roof((await get('hall-occupancy', '2030-09-01', '2030-09-30')).rows)).toMatchObject({ functions: 0, provisionalHours: 0 });
    expect(roof((await get('hall-occupancy', '2030-09-01', '2030-10-31')).rows)).toMatchObject({ functions: 1, provisionalHours: 8, daysUsed: 2 });

    // Lost: still counted by status, but it no longer holds the hall.
    await api.post(`reservations/${r.id}/status`, { status: 'lost' }).expect(200);
    expect((await get('bookings-by-status', '2030-10-01', '2030-10-31')).rows).toEqual([{ status: 'lost', bookings: 1, guaranteedPax: 50, expectedMaxPax: 60 }]);
    expect(roof((await get('hall-occupancy', '2030-10-01', '2030-10-31')).rows)).toMatchObject({ functions: 0, provisionalHours: 0 });
    const today = new Date().toISOString().slice(0, 10);
    expect((await get('enquiry-conversion', today, today)).total).toMatchObject({ received: 1, lost: 1 });
  });

  it('lists function sheets for up to 62 days', async () => {
    await as(host, token).get(`reports/function-sheets?${range(day, '2030-09-30')}`).expect(400);
  });

  it('covers every property when none is chosen', async () => {
    const res = await as(host, token).get(`reports/hall-occupancy?from=${day}&to=2030-07-07`).expect(200);
    expect(res.body.propertyId).toBeNull();
    expect(res.body.rows).toHaveLength(2);
  });

  it("never shows another tenant's bookings", async () => {
    const other = await setUp('otherhotel');
    const theirs = as(other.host, other.token);
    // Their own property shows none of our bookings.
    const own = await theirs.get(`reports/bookings-by-status?from=${day}&to=2030-07-07&propertyId=${other.property}`).expect(200);
    expect(own.body.total.bookings).toBe(0);
    // Our property id is not found for them, and the group view only covers their properties.
    await theirs.get(`reports/forecast?${range(day, '2030-07-03')}`).expect(404);
    const all = await theirs.get(`reports/function-sheets?from=${day}&to=2030-07-07`).expect(200);
    expect(all.body.rows).toHaveLength(0);
    expect(all.body.properties).toEqual([{ id: other.property, name: 'otherhotel Residency' }]);
  });
});
