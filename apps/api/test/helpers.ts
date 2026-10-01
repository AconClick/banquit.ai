import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { authRules } from '../src/config.js';
import { ConsoleNotifier, Notifier } from '../src/notifications/notifier.js';

export const ADMIN = { 'x-platform-token': 'dev-platform-token' };

/** The session token a login-type response set as the session cookie (the body no longer carries it). */
export function tokenOf(res: { headers: Record<string, unknown> }): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
  const found = cookies.map((c) => /^(?:__Host-)?bq_session=([^;]+)/.exec(c)).find(Boolean);
  if (!found) throw new Error('The response did not set a session cookie.');
  return decodeURIComponent(found[1]);
}

/** Starts the app on a clean database and offers helpers to sign up tenants and log in. */
export async function startApp() {
  authRules.otpResendSeconds = 0;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  const db = app.get<Connection>(getConnectionToken());
  await db.dropDatabase();
  await db.syncIndexes();
  const outbox = (app.get(Notifier) as ConsoleNotifier).outbox;
  const http = () => request(app.getHttpServer());
  const lastMessage = (to: string) => [...outbox].reverse().find((m) => m.to === to)!;
  const passwordIn = (body: string) => /password (\S+)\./.exec(body)![1];
  const otpIn = (body: string) => /is (\d{6})\./.exec(body)![1];

  /** Signs up and approves a tenant, then returns a token for entp in the given panel. */
  async function tenantWithEntp(subdomain: string, activity: 'master' | 'operations' = 'master') {
    const mobile = `+91${String(Math.abs(hash(subdomain))).padStart(10, '0').slice(0, 10)}`;
    const host = `${subdomain}.banquet.ai`;
    await http().post('/api/tenants/signup').send({
      subdomain, name: `${subdomain} Hotel`, contactName: 'Owner', contactEmail: `owner@${subdomain}.test`, contactMobile: mobile,
    }).expect(201);
    await http().post(`/api/platform/tenants/${subdomain}/approve`).set(ADMIN).send({ approvedBy: 'test' }).expect(200);
    const password = passwordIn(lastMessage(`owner@${subdomain}.test`).body);
    const login = await http().post('/api/auth/login').set('Host', host).send({ userId: 'entp', password }).expect(200);
    const changed = await http().post('/api/auth/change-password').set('Host', host).auth(tokenOf(login), { type: 'bearer' })
      .send({ currentPassword: password, newPassword: 'Start2026x' }).expect(200);
    const act = await http().post('/api/auth/activity').set('Host', host).auth(tokenOf(changed), { type: 'bearer' })
      .send({ activity }).expect(200);
    if (activity === 'operations') return { host, token: tokenOf(act) as string };
    const verified = await http().post('/api/auth/otp/verify').set('Host', host).auth(tokenOf(changed), { type: 'bearer' })
      .send({ code: otpIn(lastMessage(mobile).body) }).expect(200);
    return { host, token: tokenOf(verified) as string };
  }

  async function close() {
    await db.dropDatabase();
    await app.close();
  }

  return { app, http, outbox, lastMessage, passwordIn, otpIn, tenantWithEntp, close };
}

function hash(s: string) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}
