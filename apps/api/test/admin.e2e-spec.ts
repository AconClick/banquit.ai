import { DnsLookup } from '../src/admin/dns.js';
import { consoleTokenOf } from './console-helpers.js';
import { ADMIN, startApp } from './helpers.js';

describe('Banquet.ai admin console', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let admin: string;
  let agent: string;
  let agentId: string;
  const auth = { type: 'bearer' as const };
  let dnsAnswer: () => Promise<string[]>;

  /** Adds a console user and logs them in through password, code and their own password. */
  async function staff(email: string, role: 'agent' | 'manager' | 'admin', create: (body: object) => Promise<{ body: { id: string } }>) {
    const created = (await create({ email, name: `${role} person`, role })).body;
    const password = t.passwordIn(t.lastMessage(email).body);
    const login = await t.http().post('/api/support/login').send({ email, password }).expect(200);
    const token = consoleTokenOf(await t.http().post('/api/support/otp/verify')
      .send({ otpToken: login.body.otpToken, code: t.otpIn(t.lastMessage(email).body) }).expect(200));
    await t.http().post('/api/support/change-password').auth(token, auth).send({ currentPassword: password, newPassword: 'Console2026x' }).expect(200);
    return { token, id: created.id };
  }
  const api = (token: string) => ({
    get: (path: string, status = 200) => t.http().get(`/api/admin/${path}`).auth(token, auth).expect(status),
    post: (path: string, body: object, status = 200) => t.http().post(`/api/admin/${path}`).auth(token, auth).send(body).expect(status),
    put: (path: string, body: object, status = 200) => t.http().put(`/api/admin/${path}`).auth(token, auth).send(body).expect(status),
    del: (path: string, status = 200) => t.http().delete(`/api/admin/${path}`).auth(token, auth).expect(status),
  });
  const signup = (subdomain: string) => t.http().post('/api/tenants/signup').send({
    subdomain, name: `${subdomain} Hotel`, contactName: 'Owner', contactEmail: `owner@${subdomain}.test`, contactMobile: '+919811100000',
  }).expect(201);

  beforeAll(async () => {
    t = await startApp();
    t.app.get(DnsLookup).txt = () => dnsAnswer();
    ({ token: admin } = await staff('boss@banquet.ai', 'admin', (b) => t.http().post('/api/platform/support-users').set(ADMIN).send(b).expect(201)));
    ({ token: agent, id: agentId } = await staff('helper@banquet.ai', 'agent', (b) => api(admin).post('staff', b, 201)));
  });
  afterAll(() => t.close());

  it('is for Banquet.ai admins only, and cookie logins need the security header to change things', async () => {
    await api(agent).get('dashboard', 403);
    await t.http().get('/api/admin/dashboard').expect(401);
    await t.http().get('/api/admin/dashboard').set('Cookie', `bq_console=${admin}`).expect(200);
    await t.http().post('/api/admin/plans').set('Cookie', `bq_console=${admin}`).send({ code: 'X1', name: 'X' }).expect(403);
    await t.http().post('/api/admin/plans').set('Cookie', `bq_console=${admin}`).set('X-Banquet-Csrf', '1').send({ code: 'X1', name: 'Test plan', active: false }).expect(201);
  });

  it('manages plans', async () => {
    const plan = (await api(admin).post('plans', { code: 'starter', name: 'Starter', currency: 'inr', monthlyPrice: 2999, yearlyPrice: 29990, maxProperties: 1, maxUsers: 5 }, 201)).body;
    expect(plan).toMatchObject({ code: 'STARTER', currency: 'INR', maxProperties: 1, active: true });
    await api(admin).post('plans', { code: 'STARTER', name: 'Again' }, 409);
    await api(admin).post('plans', { code: 'BAD', name: 'Bad', monthlyPrice: -1 }, 400);
    await api(admin).put('plans/STARTER', { monthlyPrice: 3499 });
    const list = (await api(admin).get('plans')).body as { code: string; monthlyPrice: number }[];
    expect(list.find((p) => p.code === 'STARTER')!.monthlyPrice).toBe(3499);
  });

  it('approves a sign-up with a plan and a trial, then records payments', async () => {
    await signup('newhotel');
    expect((await api(admin).get('dashboard')).body.waitingApproval.map((x: { subdomain: string }) => x.subdomain)).toContain('newhotel');
    await api(admin).post('tenants/newhotel/approve', { planCode: 'X1' }, 400); // not offered any more
    const approved = (await api(admin).post('tenants/newhotel/approve', { planCode: 'starter', trialDays: 14 })).body;
    expect(approved).toMatchObject({ status: 'active', planCode: 'STARTER', billing: 'trial', usage: { users: 1, properties: 0 } });
    expect(approved.statusHistory).toEqual([expect.objectContaining({ from: 'pending', to: 'active', by: 'admin person' })]);
    expect(t.lastMessage('owner@newhotel.test').body).toMatch(/password/);
    await api(admin).post('tenants/newhotel/approve', {}, 409);

    await api(admin).post('tenants/newhotel/payments', { amount: 0, method: 'upi', periodFrom: '2026-10-01', periodTo: '2026-10-31' }, 400);
    await api(admin).post('tenants/newhotel/payments', { amount: 3499, method: 'upi', periodFrom: '2026-11-01', periodTo: '2026-10-31' }, 400);
    const paid = (await api(admin).post('tenants/newhotel/payments', { amount: 41988, method: 'bank', reference: 'NEFT 8812', periodFrom: '2026-10-01', periodTo: '2099-09-30' }, 201)).body;
    expect(paid).toMatchObject({ paidUntil: '2099-09-30', billing: 'paid' });
    expect(paid.payments[0]).toMatchObject({ amount: 41988, currency: 'INR', method: 'bank', recordedBy: 'admin person' });
    // An older payment never moves "paid until" back.
    const older = (await api(admin).post('tenants/newhotel/payments', { amount: 100, method: 'cheque', periodFrom: '2026-01-01', periodTo: '2026-01-31' }, 201)).body;
    expect(older.paidUntil).toBe('2099-09-30');
    const list = (await api(admin).get('tenants?billing=paid')).body as { subdomain: string }[];
    expect(list.map((x) => x.subdomain)).toContain('newhotel');
    expect((await api(admin).get('log')).body.map((a: { action: string }) => a.action)).toContain('Payment recorded');
  });

  it('rejects a sign-up with a reason', async () => {
    await signup('spamhotel');
    await api(admin).post('tenants/spamhotel/reject', { reason: 'no' }, 400);
    const r = (await api(admin).post('tenants/spamhotel/reject', { reason: 'Could not verify the business' })).body;
    expect(r.status).toBe('rejected');
    expect(t.lastMessage('owner@spamhotel.test').body).toMatch(/Could not verify the business/);
    await api(admin).post('tenants/spamhotel/suspend', { reason: 'Not possible here' }, 409);
  });

  it('suspends a client: everyone is signed out and support leaves; reactivating lets them back in', async () => {
    const { host, token: entp } = await t.tenantWithEntp('stophotel', 'operations');
    await t.http().get('/api/auth/me').set('Host', host).auth(entp, auth).expect(200);
    // A support session in progress.
    const s = (await t.http().post('/api/support/sessions').auth(agent, auth).send({ subdomain: 'stophotel', reason: 'Checking the diary' }).expect(201)).body;
    const inside = (await t.http().post(`/api/support/sessions/${s.id}/enter`).auth(agent, auth).send({ activity: 'operations' }).expect(200)).body.token;

    const suspended = (await api(admin).post('tenants/stophotel/suspend', { reason: 'Payment overdue for 60 days' })).body;
    expect(suspended.status).toBe('suspended');
    expect(t.lastMessage('owner@stophotel.test').body).toMatch(/suspended.*Payment overdue/);
    await t.http().get('/api/auth/me').set('Host', host).auth(entp, auth).expect(401);
    await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(401);
    const login = await t.http().post('/api/auth/login').set('Host', host).send({ userId: 'entp', password: 'Start2026x' });
    expect(login.status).toBe(403);
    expect(login.body.message).toMatch(/suspended/);

    await api(admin).post('tenants/stophotel/reactivate', { reason: 'Paid in full' });
    await t.http().post('/api/auth/login').set('Host', host).send({ userId: 'entp', password: 'Start2026x' }).expect(200);
    const detail = (await api(admin).get('tenants/stophotel')).body;
    expect(detail.statusHistory.map((h: { to: string }) => h.to)).toEqual(['active', 'suspended', 'active']);
  });

  it('adds a custom domain, verifies it through a DNS TXT record, and then serves the client there', async () => {
    const added = (await api(admin).post('tenants/newhotel/domains', { domain: 'Bookings.NewHotel.com' }, 201)).body;
    const d = added.domains[0];
    expect(d).toMatchObject({ domain: 'bookings.newhotel.com', verified: false, txtName: '_banquet-verify.bookings.newhotel.com', cnameTarget: 'newhotel.banquet.ai' });
    expect(d.txtValue).toMatch(/^banquet-verify=[0-9a-f]{32}$/);
    await api(admin).post('tenants/stophotel/domains', { domain: 'bookings.newhotel.com' }, 409);
    await api(admin).post('tenants/newhotel/domains', { domain: 'x.banquet.ai' }, 400);
    // Not served until verified.
    await t.http().get('/api/tenants/current').set('Host', 'bookings.newhotel.com').expect(404);

    dnsAnswer = async () => { throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' }); };
    let checked = (await api(admin).post('tenants/newhotel/domains/bookings.newhotel.com/check', {})).body.domains[0];
    expect(checked).toMatchObject({ verified: false, lastCheckError: expect.stringMatching(/No TXT record/) });
    dnsAnswer = async () => ['something-else'];
    checked = (await api(admin).post('tenants/newhotel/domains/bookings.newhotel.com/check', {})).body.domains[0];
    expect(checked.lastCheckError).toMatch(/different value/);
    dnsAnswer = async () => ['v=spf1 -all', d.txtValue];
    checked = (await api(admin).post('tenants/newhotel/domains/bookings.newhotel.com/check', {})).body.domains[0];
    expect(checked).toMatchObject({ verified: true, lastCheckError: null });
    expect((await t.http().get('/api/tenants/current').set('Host', 'bookings.newhotel.com').expect(200)).body.subdomain).toBe('newhotel');

    await api(admin).del('tenants/newhotel/domains/bookings.newhotel.com');
    await t.http().get('/api/tenants/current').set('Host', 'bookings.newhotel.com').expect(404);
  });

  it('manages support staff: roles, disabling ends their logins and sessions, password resets', async () => {
    const list = (await api(admin).get('staff')).body as { email: string; role: string }[];
    expect(list.map((u) => u.email).sort()).toEqual(['boss@banquet.ai', 'helper@banquet.ai']);
    const me = list.find((u) => u.email === 'boss@banquet.ai') as unknown as { id: string };
    await api(admin).put(`staff/${me.id}`, { active: false }, 400);
    await api(admin).put(`staff/${me.id}`, { role: 'agent' }, 400);

    // The agent is inside a client's account when disabled.
    const s = (await t.http().post('/api/support/sessions').auth(agent, auth).send({ subdomain: 'newhotel', reason: 'Look at a report' }).expect(201)).body;
    const inside = (await t.http().post(`/api/support/sessions/${s.id}/enter`).auth(agent, auth).send({ activity: 'operations' }).expect(200)).body.token;
    await api(admin).put(`staff/${agentId}`, { active: false });
    await t.http().get('/api/support/me').auth(agent, auth).expect(401);
    await t.http().get('/api/auth/me').set('Host', 'newhotel.banquet.ai').auth(inside, auth).expect(401);

    await api(admin).put(`staff/${agentId}`, { active: true, role: 'manager' });
    const reset = (await api(admin).post(`staff/${agentId}/reset-password`, {})).body;
    expect(reset).toMatchObject({ role: 'manager', mustChangePassword: true });
    const temp = t.passwordIn(t.lastMessage('helper@banquet.ai').body);
    await t.http().post('/api/support/login').send({ email: 'helper@banquet.ai', password: temp }).expect(200);
  });

  it('logging out of the console ends support sessions in progress', async () => {
    const login = await t.http().post('/api/support/login').send({ email: 'boss@banquet.ai', password: 'Console2026x' }).expect(200);
    const res = await t.http().post('/api/support/otp/verify').send({ otpToken: login.body.otpToken, code: t.otpIn(t.lastMessage('boss@banquet.ai').body) }).expect(200);
    const boss = consoleTokenOf(res);
    const s = (await t.http().post('/api/support/sessions').auth(boss, auth).send({ subdomain: 'newhotel', reason: 'Check the plan limits' }).expect(201)).body;
    const inside = (await t.http().post(`/api/support/sessions/${s.id}/enter`).auth(boss, auth).send({ activity: 'master' }).expect(200)).body.token;
    await t.http().get('/api/auth/me').set('Host', 'newhotel.banquet.ai').auth(inside, auth).expect(200);
    const out = await t.http().post('/api/support/logout').auth(boss, auth).expect(204);
    expect(String(out.headers['set-cookie'])).toMatch(/bq_console=;/);
    await t.http().get('/api/auth/me').set('Host', 'newhotel.banquet.ai').auth(inside, auth).expect(401);
    const sessions = await t.http().get('/api/support/sessions').auth(boss, auth);
    expect(sessions.status).toBe(401);
  });
});
