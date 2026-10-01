import { startApp } from './helpers.js';

describe('Reservations and the diary', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let host: string;
  let token: string;
  const auth = { type: 'bearer' as const };
  const ids: Record<string, string> = {};
  const day = '2030-07-01';
  const post = (path: string, body: object) => t.http().post(`/api/${path}`).set('Host', host).auth(token, auth).send(body);
  const master = async (kind: string, body: object) => (await post(`masters/${kind}`, body).expect(201)).body.id as string;
  const booking = (over: object = {}) => ({
    propertyId: ids.property, status: 'confirmed', hostName: 'POSist Technologies', phone: '+919800000111',
    functionTypeId: ids.getTogether, guaranteedPax: 100, expectedMaxPax: 120,
    slots: [{ hallId: ids.roof, start: `${day}T12:30`, end: `${day}T16:25` }], ...over,
  });

  beforeAll(async () => {
    t = await startApp();
    ({ host, token } = await t.tenantWithEntp('diaryhotel'));
    ids.company = await master('company', { name: 'Prime Group', city: 'Kochi', state: 'Kerala', country: 'India' });
    ids.property = await master('property', { name: 'Prime Residency', companyId: ids.company, city: 'Kochi', state: 'Kerala', country: 'India' });
    ids.roof = await master('hall', { description: 'Roof Top Hall', propertyId: ids.property, capacity: 150, areaSqFt: 3000, bufferMinutes: 60 });
    ids.mezz = await master('hall', { description: 'Mezzanine', propertyId: ids.property, capacity: 60, areaSqFt: 900 });
    ids.getTogether = await master('functionType', { description: 'Get Together' });
    ids.cancelReason = await master('cancellationReason', { description: 'Guest postponed' });
    ids.amendReason = await master('amendmentReason', { description: 'Guest request' });
    ids.blockReason = await master('hallBlockReason', { description: 'Maintenance' });
    // The reservation screens live in the Operations panel.
    const login = await t.http().post('/api/auth/login').set('Host', host).send({ userId: 'entp', password: 'Start2026x' }).expect(200);
    token = (await t.http().post('/api/auth/activity').set('Host', host).auth(login.body.token, auth).send({ activity: 'operations' }).expect(200)).body.token;
  });
  afterAll(() => t.close());

  it('validates pax, times and capacity', async () => {
    const res = await post('reservations', booking({ guaranteedPax: 100, expectedMaxPax: 80 })).expect(400);
    expect(res.body.message).toContain('Expected max pax cannot be less than guaranteed pax.');
    await post('reservations', booking({ slots: [{ hallId: ids.roof, start: `${day}T16:00`, end: `${day}T12:00` }] })).expect(400);
    await post('reservations', booking({ slots: [{ hallId: ids.roof, start: `${day}T25:00`, end: `${day}T26:00` }] })).expect(400);
    const cap = await post('reservations', booking({ guaranteedPax: 70, expectedMaxPax: 70, slots: [{ hallId: ids.mezz, start: `${day}T09:00`, end: `${day}T10:00` }] })).expect(400);
    expect(cap.body.message).toMatch(/Mezzanine holds 60 guests/);
  });

  it('creates a confirmed booking with a number and warns when expected max is over capacity', async () => {
    const res = await post('reservations', booking({ expectedMaxPax: 160 })).expect(201);
    expect(res.body).toMatchObject({ number: 'R-000001', status: 'confirmed', guaranteedPax: 100 });
    expect(res.body.warnings[0]).toMatch(/more than the capacity of Roof Top Hall/);
    ids.first = res.body.id;
  });

  it('stops a second hold on the same hall, including the buffer, but allows enquiries and waitlists', async () => {
    const clash = await post('reservations', booking({ hostName: 'XYZ Pvt Ltd', slots: [{ hallId: ids.roof, start: `${day}T17:00`, end: `${day}T19:00` }] })).expect(409);
    expect(clash.body.message).toMatch(/already held .* by R-000001 \(POSist Technologies, Confirmed\).*60 minutes/);
    await post('reservations', booking({ hostName: 'XYZ Pvt Ltd', status: 'provisional', slots: [{ hallId: ids.roof, start: `${day}T17:30`, end: `${day}T19:00` }] })).expect(201);
    const enquiry = await post('reservations', booking({ hostName: 'Flipkart', status: 'enquiry' })).expect(201);
    const wait = await post('reservations', booking({ hostName: 'Snowmen', status: 'waitlisted' })).expect(201);
    ids.enquiry = enquiry.body.id;
    ids.wait = wait.body.id;
    // A waitlisted booking cannot be confirmed while the hall is held.
    await post(`reservations/${ids.wait}/status`, { status: 'confirmed' }).expect(409);
  });

  it('sets a default option date for provisional bookings', async () => {
    const res = await post(`reservations/${ids.enquiry}/status`, { status: 'provisional' });
    expect(res.status).toBe(409); // the hall is held by R-000001
    const other = await post('reservations', booking({ hostName: 'ABC Pvt Ltd', status: 'provisional', slots: [{ hallId: ids.mezz, start: `${day}T08:00`, end: `${day}T11:00` }], guaranteedPax: 20, expectedMaxPax: 30 })).expect(201);
    const today = new Date().toISOString().slice(0, 10);
    expect(other.body.optionDate > today).toBe(true);
    ids.provisional = other.body.id;
  });

  it('follows the status rules and needs reasons for cancellation and amendments', async () => {
    await post(`reservations/${ids.first}/status`, { status: 'provisional' }).expect(400);
    await post(`reservations/${ids.first}/status`, { status: 'cancelled' }).expect(400);
    const amend = { ...booking(), expectedMaxPax: 130 };
    await t.http().put(`/api/reservations/${ids.first}`).set('Host', host).auth(token, auth).send(amend).expect(400);
    const amended = await t.http().put(`/api/reservations/${ids.first}`).set('Host', host).auth(token, auth)
      .send({ ...amend, amendmentReasonId: ids.amendReason }).expect(200);
    expect(amended.body.expectedMaxPax).toBe(130);
    expect(amended.body.history.at(-1)).toMatchObject({ note: 'Amended', reasonId: ids.amendReason });

    const cancelled = await post(`reservations/${ids.first}/status`, { status: 'cancelled', reasonId: ids.cancelReason }).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    // The hall is free again, so the waitlisted booking can now be confirmed.
    await post(`reservations/${ids.wait}/status`, { status: 'confirmed' }).expect(200);
  });

  it('blocks a hall and refuses bookings over the block', async () => {
    await post('hall-blocks', { hallId: ids.mezz, start: `${day}T09:00`, end: `${day}T10:00`, reasonId: ids.blockReason }).expect(409);
    const block = await post('hall-blocks', { hallId: ids.mezz, start: '2030-07-05T00:00', end: '2030-07-05T11:00', reasonId: ids.blockReason, notes: 'Fumigation' }).expect(201);
    const res = await post('reservations', booking({ status: 'confirmed', guaranteedPax: 10, expectedMaxPax: 10, slots: [{ hallId: ids.mezz, start: '2030-07-05T10:00', end: '2030-07-05T12:00' }] })).expect(409);
    expect(res.body.message).toMatch(/Mezzanine is blocked/);
    await post(`hall-blocks/${block.body.id}/remove`, {}).expect(204);
    await post('reservations', booking({ status: 'confirmed', guaranteedPax: 10, expectedMaxPax: 10, slots: [{ hallId: ids.mezz, start: '2030-07-05T10:00', end: '2030-07-05T12:00' }] })).expect(201);
  });

  it('returns the week for the diary: halls, bookings (not lost) and blocks', async () => {
    await post('hall-blocks', { hallId: ids.roof, start: '2030-07-06T00:00', end: '2030-07-06T06:00', reasonId: ids.blockReason }).expect(201);
    const lost = await post('reservations', booking({ hostName: 'Gone Ltd', status: 'enquiry', slots: [{ hallId: ids.roof, start: '2030-07-03T10:00', end: '2030-07-03T11:00' }] })).expect(201);
    await post(`reservations/${lost.body.id}/status`, { status: 'lost' }).expect(200);

    const res = await t.http().get(`/api/diary?propertyId=${ids.property}&from=${day}&days=7`).set('Host', host).auth(token, auth).expect(200);
    expect(res.body.halls.map((h: { name: string }) => h.name).sort()).toEqual(['Mezzanine', 'Roof Top Hall']);
    const hosts = res.body.reservations.map((r: { hostName: string }) => r.hostName);
    expect(hosts).toContain('POSist Technologies');
    expect(hosts).not.toContain('Gone Ltd');
    expect(res.body.blocks).toHaveLength(1);

    const nextWeek = await t.http().get(`/api/diary?propertyId=${ids.property}&from=2030-07-08&days=7`).set('Host', host).auth(token, auth).expect(200);
    expect(nextWeek.body.reservations).toEqual([]);
  });

  it('needs the reservation permission to book', async () => {
    const masterToken = (await t.tenantWithEntp('diaryother')).token;
    await t.http().get(`/api/diary?propertyId=${ids.property}&from=${day}`).set('Host', 'diaryother.banquet.ai').auth(masterToken, auth).expect(403);
  });
});
