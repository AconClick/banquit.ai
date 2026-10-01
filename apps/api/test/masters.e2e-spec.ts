import { startApp, tokenOf } from './helpers.js';

describe('Master data', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let host: string;
  let token: string;
  const auth = { type: 'bearer' as const };
  const post = (kind: string, body: object) => t.http().post(`/api/masters/${kind}`).set('Host', host).auth(token, auth).send(body);
  const list = (kind: string) => t.http().get(`/api/masters/${kind}`).set('Host', host).auth(token, auth);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await startApp();
    ({ host, token } = await t.tenantWithEntp('masterhotel'));
  });
  afterAll(() => t.close());

  it('lists the master definitions', async () => {
    const res = await t.http().get('/api/masters').set('Host', host).auth(token, auth).expect(200);
    expect(res.body.map((m: { kind: string }) => m.kind)).toEqual(expect.arrayContaining(['company', 'property', 'hall', 'tax', 'menuItem', 'package']));
  });

  it('builds company → property → hall, checking required fields and references', async () => {
    const bad = await post('company', { name: '' }).expect(400);
    expect(bad.body.message).toEqual(expect.arrayContaining(['Company name is required.', 'City is required.']));

    ids.company = (await post('company', { name: 'Prime Group', city: 'Kochi', state: 'Kerala', country: 'India' }).expect(201)).body.id;
    await post('company', { name: 'prime group', city: 'X', state: 'X', country: 'X' }).expect(409);

    await post('property', { name: 'Prime Residency', companyId: '0123456789abcdef01234567', city: 'Kochi', state: 'Kerala', country: 'India' }).expect(400);
    await post('property', { name: 'Prime Residency', companyId: ids.company, city: 'Kochi', state: 'Kerala', country: 'India', currency: 'rupees' }).expect(400);
    const property = await post('property', { name: 'Prime Residency', companyId: ids.company, city: 'Kochi', state: 'Kerala', country: 'India', currency: 'inr' }).expect(201);
    expect(property.body.currency).toBe('INR');
    ids.property = property.body.id;

    await post('hall', { description: 'Roof Top Hall', propertyId: ids.property, capacity: 150.5, areaSqFt: 3000 }).expect(400);
    const hall = await post('hall', { description: 'Roof Top Hall', propertyId: ids.property, capacity: '150', areaSqFt: 3000 }).expect(201);
    expect(hall.body).toMatchObject({ capacity: 150, bufferMinutes: 0, active: true });
    ids.hall = hall.body.id;
  });

  it('validates taxes', async () => {
    const base = { description: 'CGST', taxType: 'percentage', rate: 2.5, validFrom: '2026-04-01', propertyIds: [ids.property] };
    await post('tax', { ...base, rate: 120 }).expect(400);
    await post('tax', { ...base, validTill: '2026-01-01' }).expect(400);
    await post('tax', { ...base, propertyIds: [] }).expect(400);
    const tax = await post('tax', base).expect(201);
    expect(tax.body).toMatchObject({ rate: 2.5, validTill: null });
  });

  it('builds a package with min / max selection rules', async () => {
    ids.head = (await post('incomeExpenseHead', { code: 'FB', description: 'Food & Beverage' }).expect(201)).body.id;
    ids.unit = (await post('unit', { description: 'Plate', shortDescription: 'PLT' }).expect(201)).body.id;
    ids.main = (await post('mainGroup', { code: 'FOOD', description: 'Food' }).expect(201)).body.id;
    ids.starters = (await post('subGroup', { code: 'NVST', description: 'Non Veg Starters', mainGroupId: ids.main }).expect(201)).body.id;
    ids.soups = (await post('subGroup', { code: 'SOUP', description: 'Soups', mainGroupId: ids.main }).expect(201)).body.id;
    const item = (code: string, subGroupId: string, aType = 'package') =>
      post('menuItem', { code, description: `Item ${code}`, subGroupId, unitId: ids.unit, defaultRate: 0, aType, incomeExpenseHeadId: ids.head }).expect(201);
    const starters = await Promise.all(['S1', 'S2', 'S3', 'S4'].map((c) => item(c, ids.starters)));
    const soup = await item('P1', ids.soups);
    const alacarte = await item('A1', ids.starters, 'alacarte');
    const starterIds = starters.map((r) => r.body.id);

    const pkg = {
      code: 'BLNV', description: 'Buffet Lunch Non Veg', ratePerPax: 950, propertyIds: [ids.property], incomeExpenseHeadId: ids.head,
      groups: [{ subGroupId: ids.starters, min: 3, max: 3, itemIds: starterIds }],
    };
    const tooMany = await post('package', { ...pkg, groups: [{ ...pkg.groups[0], max: 5, min: 3 }] }).expect(400);
    expect(tooMany.body.message[0]).toMatch(/maximum cannot be more than the number of items \(4\)/);
    await post('package', { ...pkg, groups: [{ ...pkg.groups[0], itemIds: [...starterIds, soup.body.id] }] }).expect(400);
    await post('package', { ...pkg, groups: [{ ...pkg.groups[0], itemIds: [alacarte.body.id] , min: 1, max: 1 }] }).expect(400);
    await post('package', { ...pkg, groups: [] }).expect(400);
    const created = await post('package', {
      ...pkg, groups: [...pkg.groups, { subGroupId: ids.soups, min: 0, max: 1, itemIds: [soup.body.id] }],
    }).expect(201);
    expect(created.body).toMatchObject({ ratePerPax: 950, taxInclusive: false });
    expect(created.body.groups).toHaveLength(2);
    ids.package = created.body.id;
    ids.starterItem = starterIds[0];
  });

  it('keeps records that are still in use active', async () => {
    const res = await t.http().post(`/api/masters/property/${ids.property}/active`).set('Host', host).auth(token, auth).send({ active: false }).expect(409);
    expect(res.body.message).toMatch(/1 hall/);
    await t.http().post(`/api/masters/menuItem/${ids.starterItem}/active`).set('Host', host).auth(token, auth).send({ active: false }).expect(409);

    await t.http().post(`/api/masters/hall/${ids.hall}/active`).set('Host', host).auth(token, auth).send({ active: false }).expect(200);
    expect((await list('hall').expect(200)).body).toHaveLength(0);
    const all = await t.http().get('/api/masters/hall?includeInactive=true').set('Host', host).auth(token, auth).expect(200);
    expect(all.body[0]).toMatchObject({ description: 'Roof Top Hall', active: false });
  });

  it('updates records and keeps the unique field unique', async () => {
    const second = await post('seatingStyle', { description: 'Theatre' }).expect(201);
    await post('seatingStyle', { description: 'Cluster' }).expect(201);
    await t.http().put(`/api/masters/seatingStyle/${second.body.id}`).set('Host', host).auth(token, auth).send({ description: 'CLUSTER' }).expect(409);
    const ok = await t.http().put(`/api/masters/seatingStyle/${second.body.id}`).set('Host', host).auth(token, auth).send({ description: 'Classroom' }).expect(200);
    expect(ok.body.description).toBe('Classroom');
    await post('nonsense', { description: 'x' }).expect(404);
  });

  it('lets Operations read masters but not change them, and keeps tenants apart', async () => {
    const ops = await t.http().post('/api/auth/login').set('Host', host).send({ userId: 'entp', password: 'Start2026x' }).expect(200);
    const opsToken = tokenOf(await t.http().post('/api/auth/activity').set('Host', host).auth(tokenOf(ops), auth).send({ activity: 'operations' }).expect(200));
    await t.http().get('/api/masters/seatingStyle').set('Host', host).auth(opsToken, auth).expect(200);
    await t.http().post('/api/masters/seatingStyle').set('Host', host).auth(opsToken, auth).send({ description: 'U-Shape' }).expect(403);

    const other = await t.tenantWithEntp('otherhotel');
    const res = await t.http().get('/api/masters/seatingStyle').set('Host', other.host).auth(other.token, auth).expect(200);
    expect(res.body).toEqual([]);
    await t.http().post('/api/masters/hall').set('Host', other.host).auth(other.token, auth)
      .send({ description: 'Hall', propertyId: ids.property, capacity: 10, areaSqFt: 10 }).expect(400);
  });
});
