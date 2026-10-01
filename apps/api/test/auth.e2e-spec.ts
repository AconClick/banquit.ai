import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ConsoleNotifier, Notifier } from '../src/notifications/notifier.js';
import { authRules } from '../src/config.js';

const ADMIN = { 'x-platform-token': 'dev-platform-token' };
const PRIME = 'prime.banquet.ai';

describe('Sign-up, approval and login', () => {
  let app: NestExpressApplication;
  let outbox: ConsoleNotifier['outbox'];
  let http: () => ReturnType<typeof request>;

  const lastMessage = (to: string) => [...outbox].reverse().find((m) => m.to === to)!;
  const passwordIn = (body: string) => /password (\S+)\./.exec(body)![1];
  const otpIn = (body: string) => /is (\d{6})\./.exec(body)![1];

  async function signupAndApprove(subdomain: string, mobile = '+919800000001') {
    await http().post('/api/tenants/signup').send({
      subdomain, name: `${subdomain} Hotel`, contactName: 'Owner', contactEmail: `owner@${subdomain}.test`, contactMobile: mobile,
    }).expect(201);
    await http().post(`/api/platform/tenants/${subdomain}/approve`).set(ADMIN).send({ approvedBy: 'Banquet.ai admin' }).expect(200);
    return passwordIn(lastMessage(`owner@${subdomain}.test`).body);
  }

  async function loginAndChange(host: string, userId: string, password: string, newPassword: string) {
    const login = await http().post('/api/auth/login').set('Host', host).send({ userId, password }).expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    const changed = await http().post('/api/auth/change-password').set('Host', host)
      .auth(login.body.token, { type: 'bearer' }).send({ currentPassword: password, newPassword }).expect(200);
    return changed.body.token as string;
  }

  beforeAll(async () => {
    authRules.otpResendSeconds = 0; // the throttle has its own test below
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.get<Connection>(getConnectionToken()).syncIndexes();
    outbox = (app.get(Notifier) as ConsoleNotifier).outbox;
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  it('rejects bad and reserved sub-domains', async () => {
    const base = { name: 'X', contactName: 'X', contactEmail: 'x@x.test', contactMobile: '1' };
    await http().post('/api/tenants/signup').send({ ...base, subdomain: 'ab' }).expect(400);
    await http().post('/api/tenants/signup').send({ ...base, subdomain: 'admin' }).expect(400);
  });

  it('blocks login until the tenant is approved', async () => {
    await http().post('/api/tenants/signup').send({
      subdomain: 'waiting', name: 'W', contactName: 'W', contactEmail: 'w@w.test', contactMobile: '1',
    }).expect(201);
    const res = await http().post('/api/auth/login').set('Host', 'waiting.banquet.ai').send({ userId: 'entp', password: 'x' }).expect(403);
    expect(res.body.message).toMatch(/waiting for approval/);
    const resolved = await http().post('/api/tenants/resolve').send({ domain: 'WAITING' }).expect(200);
    expect(resolved.body).toMatchObject({ active: false, loginHost: 'waiting.banquet.ai' });
  });

  it('approves on payment and emails entp credentials', async () => {
    await http().post('/api/tenants/signup').send({
      subdomain: 'paid', name: 'Paid', contactName: 'P', contactEmail: 'p@paid.test', contactMobile: '1',
    }).expect(201);
    const res = await http().post('/api/platform/payments/confirmed').set(ADMIN).send({ subdomain: 'paid', reference: 'pay_123' }).expect(200);
    expect(res.body).toMatchObject({ status: 'active', approval: { method: 'payment', reference: 'pay_123' } });
    expect(lastMessage('p@paid.test').body).toMatch(/user id "entp"/);
    await http().post('/api/platform/payments/confirmed').set(ADMIN).send({ subdomain: 'paid', reference: 'again' }).expect(409);
    await http().post('/api/platform/tenants/paid/approve').send({ approvedBy: 'x' }).expect(401);
  });

  it('runs the full entp login: password change, Operations, then Master with OTP', async () => {
    const password = await signupAndApprove('prime');
    const login = await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'ENTP', password }).expect(200);
    expect(login.body.activities).toEqual(['operations', 'master']);

    // Nothing but the password change is allowed until the password is changed.
    await http().post('/api/auth/activity').set('Host', PRIME).auth(login.body.token, { type: 'bearer' })
      .send({ activity: 'operations' }).expect(403);
    await http().post('/api/auth/change-password').set('Host', PRIME).auth(login.body.token, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: 'short' }).expect(400);
    const changed = await http().post('/api/auth/change-password').set('Host', PRIME).auth(login.body.token, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: 'Prime2026x' }).expect(200);
    const token = changed.body.token;

    const ops = await http().post('/api/auth/activity').set('Host', PRIME).auth(token, { type: 'bearer' })
      .send({ activity: 'operations' }).expect(200);
    expect(ops.body).toMatchObject({ otpRequired: false, activity: 'operations' });
    // Operations does not open Master screens.
    await http().get('/api/users').set('Host', PRIME).auth(ops.body.token, { type: 'bearer' }).expect(403);

    const master = await http().post('/api/auth/activity').set('Host', PRIME).auth(token, { type: 'bearer' })
      .send({ activity: 'master' }).expect(200);
    expect(master.body).toEqual({ otpRequired: true, sentTo: 'mobile' });
    const sms = lastMessage('+919800000001');
    expect(sms.channel).toBe('sms');
    await http().post('/api/auth/otp/verify').set('Host', PRIME).auth(token, { type: 'bearer' }).send({ code: '000000' === otpIn(sms.body) ? '111111' : '000000' }).expect(400);
    const verified = await http().post('/api/auth/otp/verify').set('Host', PRIME).auth(token, { type: 'bearer' })
      .send({ code: otpIn(sms.body) }).expect(200);
    expect(verified.body.activity).toBe('master');

    const users = await http().get('/api/users').set('Host', PRIME).auth(verified.body.token, { type: 'bearer' }).expect(200);
    expect(users.body.map((u: { userId: string }) => u.userId)).toEqual(['entp']);
  });

  it('keeps tenants apart', async () => {
    const otherPassword = await signupAndApprove('other', '+919800000002');
    const otherToken = await loginAndChange('other.banquet.ai', 'entp', otherPassword, 'Other2026x');
    // A token from "other" is useless on prime's address.
    await http().get('/api/auth/me').set('Host', PRIME).auth(otherToken, { type: 'bearer' }).expect(401);
    // entp exists in both tenants, each with its own password.
    await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'entp', password: 'Other2026x' }).expect(401);
  });

  it('allows only one active session per user', async () => {
    const first = await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'entp', password: 'Prime2026x' }).expect(200);
    await http().get('/api/auth/me').set('Host', PRIME).auth(first.body.token, { type: 'bearer' }).expect(200);
    await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'entp', password: 'Prime2026x' }).expect(200);
    const res = await http().get('/api/auth/me').set('Host', PRIME).auth(first.body.token, { type: 'bearer' }).expect(401);
    expect(res.body.message).toMatch(/signed in elsewhere/);
  });

  it('locks a user after 5 wrong passwords', async () => {
    for (let i = 0; i < 5; i++) {
      await http().post('/api/auth/login').set('Host', 'other.banquet.ai').send({ userId: 'entp', password: 'wrong' }).expect(401);
    }
    await http().post('/api/auth/login').set('Host', 'other.banquet.ai').send({ userId: 'entp', password: 'Other2026x' }).expect(423);
  });

  it('serves a tenant on its verified custom domains', async () => {
    await http().post('/api/platform/tenants/prime/domains').set(ADMIN).send({ domain: 'banquets.primeresidency.com', verified: false }).expect(200);
    await http().get('/api/tenants/current').set('Host', 'banquets.primeresidency.com').expect(404);
    await http().post('/api/platform/tenants/prime/domains').set(ADMIN).send({ domain: 'banquets.primeresidency.com', verified: true }).expect(200);
    await http().post('/api/platform/tenants/prime/domains').set(ADMIN).send({ domain: 'events.primeresidency.com', verified: true }).expect(200);
    for (const host of ['banquets.primeresidency.com', 'events.primeresidency.com']) {
      const res = await http().get('/api/tenants/current').set('Host', host).expect(200);
      expect(res.body.subdomain).toBe('prime');
    }
    await http().post('/api/platform/tenants/other/domains').set(ADMIN).send({ domain: 'events.primeresidency.com', verified: true }).expect(409);
  });

  it('gives implementation engineers named logins that only the client admin can disable', async () => {
    const created = await http().post('/api/platform/tenants/prime/implementation-users').set(ADMIN)
      .send({ userId: 'impl.ravi', firstName: 'Ravi', email: 'ravi@banquet.ai', mobile: '+919800000009' }).expect(201);
    expect(created.body.kind).toBe('implementation');
    const implToken = await loginAndChange(PRIME, 'impl.ravi', passwordIn(lastMessage('ravi@banquet.ai').body), 'Ravi2026xx');
    const me = await http().get('/api/auth/me').set('Host', PRIME).auth(implToken, { type: 'bearer' }).expect(200);
    expect(me.body.role.name).toBe('Implementation');

    // entp opens Master and disables the engineer.
    const login = await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'entp', password: 'Prime2026x' }).expect(200);
    await http().post('/api/auth/activity').set('Host', PRIME).auth(login.body.token, { type: 'bearer' }).send({ activity: 'master' }).expect(200);
    const master = await http().post('/api/auth/otp/verify').set('Host', PRIME).auth(login.body.token, { type: 'bearer' })
      .send({ code: otpIn(lastMessage('+919800000001').body) }).expect(200);
    const auth = { type: 'bearer' as const };
    await http().post(`/api/users/${created.body.id}/active`).set('Host', PRIME).auth(master.body.token, auth).send({ active: false }).expect(200);
    await http().get('/api/auth/me').set('Host', PRIME).auth(implToken, auth).expect(401);

    const entp = (await http().get('/api/users').set('Host', PRIME).auth(master.body.token, auth)).body.find((u: { userId: string }) => u.userId === 'entp');
    await http().post(`/api/users/${entp.id}/active`).set('Host', PRIME).auth(master.body.token, auth).send({ active: false }).expect(400);
  });

  it('lets entp create roles and users, and enforces role permissions', async () => {
    const login = await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'entp', password: 'Prime2026x' }).expect(200);
    const t0 = login.body.token;
    await http().post('/api/auth/activity').set('Host', PRIME).auth(t0, { type: 'bearer' }).send({ activity: 'master' }).expect(200);
    const master = (await http().post('/api/auth/otp/verify').set('Host', PRIME).auth(t0, { type: 'bearer' })
      .send({ code: otpIn(lastMessage('+919800000001').body) }).expect(200)).body.token;
    const auth = { type: 'bearer' as const };

    const role = await http().post('/api/roles').set('Host', PRIME).auth(master, auth)
      .send({ name: 'Reception', permissions: ['diary.view', 'reservations.manage'] }).expect(201);
    await http().post('/api/roles').set('Host', PRIME).auth(master, auth).send({ name: 'reception', permissions: [] }).expect(409);
    await http().post('/api/roles').set('Host', PRIME).auth(master, auth).send({ name: 'Bad', permissions: ['nope'] }).expect(400);

    await http().post('/api/users').set('Host', PRIME).auth(master, auth)
      .send({ userId: 'reception1', firstName: 'Asha', email: 'asha@prime.test', roleId: role.body.id }).expect(201);
    const token = await loginAndChange(PRIME, 'reception1', passwordIn(lastMessage('asha@prime.test').body), 'Asha2026xx');
    const me = await http().get('/api/auth/me').set('Host', PRIME).auth(token, auth).expect(200);
    expect(me.body.activities).toEqual(['operations']);
    await http().post('/api/auth/activity').set('Host', PRIME).auth(token, auth).send({ activity: 'master' }).expect(403);
  });

  it('throttles OTP resends and limits wrong codes', async () => {
    const login = await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'entp', password: 'Prime2026x' }).expect(200);
    const auth = { type: 'bearer' as const };
    await http().post('/api/auth/activity').set('Host', PRIME).auth(login.body.token, auth).send({ activity: 'master' }).expect(200);
    authRules.otpResendSeconds = 30;
    await http().post('/api/auth/activity').set('Host', PRIME).auth(login.body.token, auth).send({ activity: 'master' }).expect(429);
    authRules.otpResendSeconds = 0;
    const code = otpIn(lastMessage('+919800000001').body);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      await http().post('/api/auth/otp/verify').set('Host', PRIME).auth(login.body.token, auth).send({ code: wrong }).expect(400);
    }
    const res = await http().post('/api/auth/otp/verify').set('Host', PRIME).auth(login.body.token, auth).send({ code }).expect(400);
    expect(res.body.message).toMatch(/Too many wrong codes/);
  });

  it('resets a forgotten password by emailed link', async () => {
    await http().post('/api/auth/forgot-password').set('Host', PRIME).send({ userId: 'nobody' }).expect(202);
    await http().post('/api/auth/forgot-password').set('Host', PRIME).send({ userId: 'reception1' }).expect(202);
    const token = /token=([a-f0-9]+)/.exec(lastMessage('asha@prime.test').body)![1];
    await http().post('/api/auth/reset-password').set('Host', PRIME).send({ token, newPassword: 'Asha2026xx' }).expect(400);
    await http().post('/api/auth/reset-password').set('Host', PRIME).send({ token, newPassword: 'Fresh2026x' }).expect(204);
    await http().post('/api/auth/reset-password').set('Host', PRIME).send({ token, newPassword: 'Fresh2026y' }).expect(400);
    await http().post('/api/auth/login').set('Host', PRIME).send({ userId: 'reception1', password: 'Fresh2026x' }).expect(200);
  });
});
