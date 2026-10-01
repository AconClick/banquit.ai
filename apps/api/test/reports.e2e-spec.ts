import { startApp } from './helpers.js';

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
    return (await t.http().post('/api/auth/activity').set('Host', h).auth(login.body.token, auth).send({ activity: 'operations' }).expect(200)).body.token as string;
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

    const revenue = await api.get(`reports/revenue?${range()}`).expect(200);
    expect(revenue.body.available).toBe(false);
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
