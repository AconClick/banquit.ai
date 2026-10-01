import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ADMIN, startApp } from './helpers.js';

describe('Banquet.ai support login', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let host: string;
  let entp: string;
  const auth = { type: 'bearer' as const };

  /** Creates a support user and logs in through password, OTP and the first password change. */
  async function staff(email: string, role: 'agent' | 'manager') {
    await t.http().post('/api/platform/support-users').set(ADMIN).send({ email, name: `${role} one`, role }).expect(201);
    const password = t.passwordIn(t.lastMessage(email).body);
    const login = await t.http().post('/api/support/login').send({ email, password }).expect(200);
    expect(login.body.sentTo).toBe('email');
    const code = t.otpIn(t.lastMessage(email).body);
    const verified = await t.http().post('/api/support/otp/verify').send({ otpToken: login.body.otpToken, code }).expect(200);
    const token = verified.body.token as string;
    await t.http().post('/api/support/sessions').auth(token, auth).send({ subdomain: 'helpme', reason: 'Checking a report' }).expect(403);
    await t.http().post('/api/support/change-password').auth(token, auth).send({ currentPassword: password, newPassword: 'Support2026x' }).expect(200);
    return token;
  }

  beforeAll(async () => {
    t = await startApp();
    ({ host, token: entp } = await t.tenantWithEntp('helpme'));
  });
  afterAll(() => t.close());

  it('needs a password and an OTP, and console tokens never work inside a tenant', async () => {
    await t.http().post('/api/support/login').send({ email: 'nobody@banquet.ai', password: 'x' }).expect(401);
    const token = await staff('agent@banquet.ai', 'agent');
    const me = await t.http().get('/api/support/me').auth(token, auth).expect(200);
    expect(me.body).toMatchObject({ email: 'agent@banquet.ai', role: 'agent', mustChangePassword: false });
    await t.http().get('/api/auth/me').set('Host', host).auth(token, auth).expect(401);
    await t.http().get('/api/support/me').auth(entp, auth).expect(401);
  });

  it('enters read-only with a reason, records edits, and tells the client', async () => {
    const token = (await t.http().post('/api/support/login').send({ email: 'agent@banquet.ai', password: 'Support2026x' }).expect(200)).body;
    const console = (await t.http().post('/api/support/otp/verify')
      .send({ otpToken: token.otpToken, code: t.otpIn(t.lastMessage('agent@banquet.ai').body) }).expect(200)).body.token as string;

    await t.http().post('/api/support/sessions').auth(console, auth).send({ subdomain: 'helpme', reason: 'short' }).expect(400);
    const s = (await t.http().post('/api/support/sessions').auth(console, auth)
      .send({ subdomain: 'helpme', reason: 'Owner says the diary is empty', ticket: 'T-101' }).expect(201)).body;
    expect(s).toMatchObject({ status: 'active', mode: 'read', tenant: { subdomain: 'helpme' } });
    expect(t.lastMessage('owner@helpme.test').body).toMatch(/has entered your Banquet.ai account.*diary is empty.*T-101/);

    const entered = (await t.http().post(`/api/support/sessions/${s.id}/enter`).auth(console, auth).send({ activity: 'master' }).expect(200)).body;
    expect(entered.subdomain).toBe('helpme');
    let inside = entered.token as string;
    const me = (await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(200)).body;
    expect(me).toMatchObject({ support: true, activity: 'master', user: { firstName: 'agent one', userId: 'Banquet.ai Support', kind: 'support' } });

    // Read-only: reading works, changing does not.
    await t.http().get('/api/masters/company').set('Host', host).auth(inside, auth).expect(200);
    await t.http().post('/api/masters/company').set('Host', host).auth(inside, auth).send({ name: 'Support Co' }).expect(403);
    // Never acts on a real user's own account, and never on the support setting.
    await t.http().post('/api/auth/change-password').set('Host', host).auth(inside, auth).send({ currentPassword: 'a', newPassword: 'b' }).expect(403);
    await t.http().get('/api/support-access').set('Host', host).auth(inside, auth).expect(403);
    // Not usable on another tenant.
    await t.tenantWithEntp('other');
    await t.http().get('/api/auth/me').set('Host', 'other.banquet.ai').auth(inside, auth).expect(401);

    await t.http().post('/api/support-session/edit-mode').set('Host', host).auth(inside, auth).send({ reason: 'fix' }).expect(400);
    await t.http().post('/api/support-session/edit-mode').set('Host', host).auth(inside, auth).send({ reason: 'Add the missing company record' }).expect(200);
    await t.http().post('/api/masters/company').set('Host', host).auth(inside, auth)
      .send({ name: 'Support Co', city: 'Kochi', state: 'Kerala', country: 'India' }).expect(201);

    // Switching panel keeps the same session.
    inside = (await t.http().post('/api/support-session/activity').set('Host', host).auth(inside, auth).send({ activity: 'operations' }).expect(200)).body.token;
    expect((await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(200)).body.activity).toBe('operations');

    // Support never appears in the client's user list.
    const users = (await t.http().get('/api/users').set('Host', host).auth(entp, auth).expect(200)).body as { userId: string }[];
    expect(users.map((u) => u.userId)).not.toContain('Banquet.ai Support');

    const log = (await t.http().get('/api/support-access').set('Host', host).auth(entp, auth).expect(200)).body;
    expect(log.supportAccess).toBe('allowed');
    expect(log.sessions[0].actions.map((a: { method: string; path: string }) => `${a.method} ${a.path}`))
      .toEqual(['EDIT MODE Add the missing company record', 'POST /api/masters/company']);

    // Logging out ends the session; the token stops working.
    await t.http().post('/api/auth/logout').set('Host', host).auth(inside, auth).expect(204);
    await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(401);
    await t.http().post(`/api/support/sessions/${s.id}/enter`).auth(console, auth).send({ activity: 'master' }).expect(400);
  });

  it('asks the client first when the client chooses so; only a manager can override', async () => {
    await t.http().put('/api/support-access').set('Host', host).auth(entp, auth).send({ supportAccess: 'ask' }).expect(200);
    const login = (await t.http().post('/api/support/login').send({ email: 'agent@banquet.ai', password: 'Support2026x' }).expect(200)).body;
    const agent = (await t.http().post('/api/support/otp/verify')
      .send({ otpToken: login.otpToken, code: t.otpIn(t.lastMessage('agent@banquet.ai').body) }).expect(200)).body.token as string;

    const asked = (await t.http().post('/api/support/sessions').auth(agent, auth)
      .send({ subdomain: 'helpme', reason: 'Bill totals look wrong' }).expect(201)).body;
    expect(asked.status).toBe('pending');
    expect(t.lastMessage('owner@helpme.test').body).toMatch(/asks to enter/);
    await t.http().post(`/api/support/sessions/${asked.id}/enter`).auth(agent, auth).send({ activity: 'operations' }).expect(409);
    await t.http().post('/api/support/sessions').auth(agent, auth)
      .send({ subdomain: 'helpme', reason: 'Bill totals look wrong', emergency: true }).expect(403);

    await t.http().post(`/api/support-access/${asked.id}/approve`).set('Host', host).auth(entp, auth).expect(200);
    expect(t.lastMessage('agent@banquet.ai').body).toMatch(/approved/);
    await t.http().post(`/api/support/sessions/${asked.id}/enter`).auth(agent, auth).send({ activity: 'operations' }).expect(200);
    await t.http().post(`/api/support-access/${asked.id}/deny`).set('Host', host).auth(entp, auth).expect(409);

    const manager = await staff('lead@banquet.ai', 'manager');
    const forced = (await t.http().post('/api/support/sessions').auth(manager, auth)
      .send({ subdomain: 'helpme', reason: 'Client is locked out and unreachable', emergency: true }).expect(201)).body;
    expect(forced).toMatchObject({ status: 'active', emergency: true });
    expect(t.lastMessage('owner@helpme.test').body).toMatch(/emergency override/);
  });

  it('ends after the time limit', async () => {
    const db = t.app.get<Connection>(getConnectionToken());
    const login = (await t.http().post('/api/support/login').send({ email: 'agent@banquet.ai', password: 'Support2026x' }).expect(200)).body;
    const agent = (await t.http().post('/api/support/otp/verify')
      .send({ otpToken: login.otpToken, code: t.otpIn(t.lastMessage('agent@banquet.ai').body) }).expect(200)).body.token as string;
    const sessions = (await t.http().get('/api/support/sessions').auth(agent, auth).expect(200)).body as { id: string; status: string }[];
    const live = sessions.find((s) => s.status === 'active')!;
    const inside = (await t.http().post(`/api/support/sessions/${live.id}/enter`).auth(agent, auth).send({ activity: 'operations' }).expect(200)).body.token;
    await db.collection('supportsessions').updateMany({}, { $set: { endsAt: new Date(Date.now() - 1000) } });
    await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(401);
    const after = (await t.http().get('/api/support/sessions').auth(agent, auth).expect(200)).body as { id: string; status: string }[];
    expect(after.find((s) => s.id === live.id)!.status).toBe('ended');
  });
});
