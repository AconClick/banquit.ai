import { ADMIN, startApp } from './helpers.js';
import { booking, completedBooking, venue, type Venue } from './stress/fixture.js';

const SECRET = 'SECRETB';

/**
 * Tenant A tries to reach tenant B's data through every route, with B's ids, B's host and the
 * X-Tenant header. No response may carry B's data, and nothing of B's may change.
 */
describe('Tenant isolation', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let a: Venue;
  let b: Venue;
  const bIds: Record<string, string> = {};
  const leaks: string[] = [];
  const accepted: string[] = [];

  beforeAll(async () => {
    t = await startApp();
    a = await venue(t, 'alpha', { hallsPer: 2 });
    b = await venue(t, 'bravo', { hallsPer: 2 });
    Object.assign(bIds, b.ids);
    const r = await b.post('reservations', {
      propertyId: b.ids.p1, status: 'enquiry', hostName: `${SECRET} Host`, phone: '+919811111111', email: 'secret@bravo.test',
      functionTypeId: b.ids.wedding, guaranteedPax: 50, expectedMaxPax: 60, slots: [{ hallId: b.ids.p1h1, start: '2031-03-01T12:00', end: '2031-03-01T15:00' }],
    });
    bIds.res = r.body.id;
    bIds.done = await completedBooking(b, { hall: 'p1h2', from: '10:00', to: '11:00', pax: 10, actual: 10, advance: 500 });
    bIds.bill = (await b.post(`billing/reservations/${bIds.done}/draft`, {})).body.id;
    bIds.block = (await b.post('hall-blocks', { hallId: b.ids.p1h1, start: '2031-04-01T00:00', end: '2031-04-02T00:00', reasonId: b.ids.blockReason })).body.id;
    const roles = await b.get('roles', b.master);
    bIds.role = roles.body.find((x: any) => x.name === 'Banquet Manager').id;
    const users = await b.get('users', b.master);
    bIds.user = users.body.find((u: any) => u.userId === 'ops1').id;
    await b.put('support-access', { supportAccess: 'ask' }, b.master);
  });
  afterAll(() => t.close());

  async function attempt(label: string, method: 'get' | 'post' | 'put' | 'patch', path: string, body: object | undefined, token: string, opts: { host?: string; header?: string } = {}) {
    let req = t.http()[method](`/api/${path}`).set('Host', opts.host ?? a.host).auth(token, { type: 'bearer' });
    if (opts.header) req = req.set('X-Tenant', opts.header);
    const res = await (body ? req.send(body) : req);
    const text = JSON.stringify(res.body);
    const bValues = [SECRET, 'secret@bravo.test', ...Object.values(bIds)];
    const found = bValues.filter((x) => text.includes(x));
    if (found.length) leaks.push(`${label}: ${res.status} carries ${found.join(', ')}`);
    if (res.status < 300) accepted.push(`${label}: ${res.status}`);
    return res;
  }

  it('reaches nothing of B with A sessions', async () => {
    const o = a.ops;
    const m = a.master;
    // Operations reads with B's ids.
    await attempt('diary B property', 'get', `diary?propertyId=${bIds.p1}&from=2031-03-01&days=7`, undefined, o);
    await attempt('reservation B', 'get', `reservations/${bIds.res}`, undefined, o);
    await attempt('details B', 'get', `reservations/${bIds.res}/details`, undefined, o);
    await attempt('menu options B', 'get', `reservations/${bIds.res}/menu-options`, undefined, o);
    await attempt('billing view B', 'get', `billing/reservations/${bIds.done}`, undefined, o);
    await attempt('bill B', 'get', `billing/bills/${bIds.bill}`, undefined, o);
    await attempt('bill list B property', 'get', `billing/bills?propertyId=${bIds.p1}`, undefined, o);
    for (const rep of ['bookings-by-status', 'hall-occupancy', 'enquiry-conversion', 'function-sheets', 'forecast', 'revenue']) {
      await attempt(`report ${rep} B property`, 'get', `reports/${rep}?propertyId=${bIds.p1}&from=2026-04-01&to=2026-05-31`, undefined, o);
    }
    // Operations writes on B's records.
    await attempt('edit B reservation', 'put', `reservations/${bIds.res}`, {
      propertyId: bIds.p1, status: 'enquiry', hostName: 'x', phone: '1', functionTypeId: bIds.wedding, guaranteedPax: 1, expectedMaxPax: 1,
      slots: [{ hallId: bIds.p1h1, start: '2031-03-01T12:00', end: '2031-03-01T13:00' }],
    }, o);
    await attempt('status B reservation', 'post', `reservations/${bIds.res}/status`, { status: 'lost', reasonId: bIds.cancel }, o);
    await attempt('menu B reservation', 'put', `reservations/${bIds.res}/menu`, { packages: [], extras: [] }, o);
    await attempt('receipt B reservation', 'post', `reservations/${bIds.res}/receipts`, { amount: 1, mode: 'cash' }, o);
    await attempt('draft B reservation', 'post', `billing/reservations/${bIds.done}/draft`, {}, o);
    await attempt('save B bill', 'put', `billing/bills/${bIds.bill}`, { lines: [] }, o);
    await attempt('refresh B bill', 'post', `billing/bills/${bIds.bill}/refresh`, {}, o);
    await attempt('finalise B bill', 'post', `billing/bills/${bIds.bill}/finalise`, {}, o);
    await attempt('pay B bill', 'post', `billing/bills/${bIds.bill}/payments`, { amount: 1, mode: 'cash' }, o);
    await attempt('void B bill', 'post', `billing/bills/${bIds.bill}/void`, { reason: 'x' }, o);
    await attempt('remove B block', 'post', `hall-blocks/${bIds.block}/remove`, {}, o);
    // A's own records pointing at B's masters.
    await attempt('A booking in B hall', 'post', 'reservations', {
      propertyId: bIds.p1, status: 'confirmed', hostName: 'x', phone: '1', functionTypeId: bIds.wedding, guaranteedPax: 1, expectedMaxPax: 1,
      slots: [{ hallId: bIds.p1h1, start: '2031-03-01T12:00', end: '2031-03-01T13:00' }],
    }, o);
    await attempt('A booking, A property, B hall', 'post', 'reservations', {
      propertyId: a.ids.p1, status: 'confirmed', hostName: 'x', phone: '1', functionTypeId: a.ids.wedding, guaranteedPax: 1, expectedMaxPax: 1,
      slots: [{ hallId: bIds.p1h1, start: '2031-03-01T12:00', end: '2031-03-01T13:00' }],
    }, o);
    await attempt('A block on B hall', 'post', 'hall-blocks', { hallId: bIds.p1h1, start: '2031-05-01T00:00', end: '2031-05-02T00:00', reasonId: a.ids.blockReason }, o);
    const mine = await booking(a, 'p1h1', '2031-06-01', '10:00', '12:00');
    await attempt('A menu with B package', 'put', `reservations/${mine.body.id}/menu`, { packages: [{ packageId: bIds.pkg, pax: 10, choices: [bIds.tikka] }], extras: [{ kind: 'menuItem', itemId: bIds.dj, qty: 1 }] }, o);
    const aDone = await completedBooking(a, { hall: 'p1h2', from: '10:00', to: '11:00', pax: 10, actual: 10 });
    const aBill = (await a.post(`billing/reservations/${aDone}/draft`, {})).body;
    await attempt('A bill with B taxes / items / hall', 'put', `billing/bills/${aBill.id}`, {
      lines: [
        { id: aBill.lines[0].id, source: 'package', actualPax: 10, taxIds: [bIds.gst18] },
        { source: 'running', kind: 'menuItem', itemId: bIds.mocktail, qty: 1 },
        { source: 'hallHire', hallId: bIds.p1h1, qty: 1, rate: 1 },
      ],
    }, o);

    // Master panel with B's ids.
    await attempt('B property settings', 'get', `properties/${bIds.p1}/settings`, undefined, m);
    await attempt('change B property settings', 'put', `properties/${bIds.p1}/settings`, { advancePercent: 99 }, m);
    await attempt('B rates', 'get', `properties/${bIds.p1}/rates`, undefined, m);
    await attempt('change B rate', 'put', `properties/${bIds.p1}/rates/package/${bIds.pkg}`, { offered: true, rate: 1, taxInclusive: null, taxIds: null }, m);
    await attempt('change A rate for B package', 'put', `properties/${a.ids.p1}/rates/package/${bIds.pkg}`, { offered: true, rate: 1, taxInclusive: null, taxIds: null }, m);
    await attempt('edit B hall', 'put', `masters/hall/${bIds.p1h1}`, { description: 'Mine', propertyId: a.ids.p1, capacity: 1, areaSqFt: 1 }, m);
    await attempt('deactivate B hall', 'post', `masters/hall/${bIds.p1h1}/active`, { active: false }, m);
    await attempt('A hall in B property', 'post', 'masters/hall', { description: 'Sneaky', propertyId: bIds.p1, capacity: 1, areaSqFt: 1 }, m);
    await attempt('A tax for B property', 'post', 'masters/tax', { description: 'T', taxType: 'percentage', rate: 1, validFrom: '2026-01-01', propertyIds: [bIds.p1] }, m);
    await attempt('edit B role', 'put', `roles/${bIds.role}`, { name: 'Hacked', permissions: [] }, m);
    await attempt('edit B user', 'patch', `users/${bIds.user}`, { firstName: 'Hacked' }, m);
    await attempt('disable B user', 'post', `users/${bIds.user}/active`, { active: false }, m);
    await attempt('unlock B user', 'post', `users/${bIds.user}/unlock`, {}, m);
    await attempt('A user with B role', 'post', 'users', { userId: 'mole', firstName: 'M', email: 'mole@alpha.test', roleId: bIds.role }, m);

    // A's token on B's address, and with the X-Tenant header.
    await attempt('A token on B host', 'get', `reservations/${bIds.res}`, undefined, o, { host: b.host });
    await attempt('A token, X-Tenant B, localhost', 'get', `reservations/${bIds.res}`, undefined, o, { host: 'localhost', header: 'bravo' });
    await attempt('A token, X-Tenant B, app host', 'get', `diary?propertyId=${bIds.p1}&from=2031-03-01&days=7`, undefined, o, { host: 'app.banquet.ai', header: 'bravo' });
    await attempt('A token, A host, X-Tenant B', 'get', `reservations/${bIds.res}`, undefined, o, { header: 'bravo' });
    // Tenant session on the support console and platform routes.
    await attempt('tenant token on support console', 'get', 'support/tenants', undefined, m);
    await attempt('tenant token on platform', 'get', 'platform/tenants/bravo', undefined, m);
    await attempt('tenant token approving B support access', 'post', `support-access/000000000000000000000000/approve`, {}, m);

    // The only success is A's own (empty) bill list filtered by B's property id.
    expect(accepted).toEqual(['bill list B property: 200']);
    // B is unchanged.
    const r = await b.get(`reservations/${bIds.res}`);
    expect(r.body).toMatchObject({ status: 'enquiry', hostName: `${SECRET} Host` });
    expect((await b.get(`billing/bills/${bIds.bill}`)).body.status).toBe('draft');
    expect((await b.get(`masters/hall/${bIds.p1h1}`, b.master)).status).toBe(404); // single records are not a route
    const halls = await b.get('masters/hall', b.master);
    expect(halls.body.find((h: any) => h.id === bIds.p1h1)).toMatchObject({ description: 'Hall 1-1', active: true });
    expect(leaks).toEqual([]);
  });

  it('platform routes need the platform token', async () => {
    const res = await t.http().get('/api/platform/tenants/bravo');
    expect(res.status).toBe(401);
    const ok = await t.http().get('/api/platform/tenants/bravo').set(ADMIN);
    expect(ok.status).toBe(200);
  });
});
