import { config } from '../src/config.js';
import { ADMIN, startApp, tokenOf } from './helpers.js';

describe('Security: session cookie, CSRF, rate limits, headers', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  const host = 'safe.banquet.ai';
  const auth = { type: 'bearer' as const };
  const login = () => t.http().post('/api/auth/login').set('Host', host).send({ userId: 'entp', password: 'Start2026x' });

  beforeAll(async () => {
    t = await startApp();
    await t.tenantWithEntp('safe');
  });
  afterAll(() => t.close());
  afterEach(() => {
    config.rateLimits = false;
    vi.restoreAllMocks();
  });
  /** Turns limits on, pinned inside one counting window so the test cannot straddle two. */
  const limitsOn = () => {
    config.rateLimits = true;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
  };

  it('keeps the session in an httpOnly, SameSite=Strict cookie and never in the body', async () => {
    const res = await login().expect(200);
    expect(res.body.token).toBeUndefined();
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('bq_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);

    const jar = cookie.split(';')[0];
    expect((await t.http().get('/api/auth/me').set('Host', host).set('Cookie', jar).expect(200)).body.user.userId).toBe('entp');
    // Changes by cookie need the CSRF header, which another site's form cannot send.
    await t.http().post('/api/auth/activity').set('Host', host).set('Cookie', jar).send({ activity: 'operations' }).expect(403);
    const ops = await t.http().post('/api/auth/activity').set('Host', host).set('Cookie', jar).set('X-Banquet-Csrf', '1')
      .send({ activity: 'operations' }).expect(200);
    expect(ops.body.token).toBeUndefined();
    expect(ops.body.activity).toBe('operations');
  });

  it('ends the old session on logout and on a new login, and clears the cookie', async () => {
    const first = tokenOf(await login().expect(200));
    const second = tokenOf(await login().expect(200));
    await t.http().get('/api/auth/me').set('Host', host).auth(first, auth).expect(401);
    const out = await t.http().post('/api/auth/logout').set('Host', host).set('Cookie', `bq_session=${second}`).set('X-Banquet-Csrf', '1').expect(204);
    expect(String(out.headers['set-cookie'])).toMatch(/bq_session=;.*Expires=Thu, 01 Jan 1970/);
    await t.http().get('/api/auth/me').set('Host', host).auth(second, auth).expect(401);
  });

  it('turns a header token into the session cookie only when it is valid', async () => {
    const token = tokenOf(await login().expect(200));
    const res = await t.http().post('/api/auth/session-cookie').set('Host', host).auth(token, auth).expect(204);
    expect(tokenOf(res)).toBe(token);
    await t.http().post('/api/auth/session-cookie').set('Host', host).auth('not-a-token', auth).expect(401);
    await t.http().post('/api/auth/session-cookie').set('Host', host).set('Cookie', `bq_session=${token}`).set('X-Banquet-Csrf', '1').expect(400);
  });

  it('does not let parallel guesses get past the 3-attempt OTP limit', async () => {
    const token = tokenOf(await login().expect(200));
    await t.http().post('/api/auth/activity').set('Host', host).auth(token, auth).send({ activity: 'master' }).expect(200);
    const code = t.otpIn(t.lastMessage(t.outbox.at(-1)!.to).body);
    const wrong = code === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(Array.from({ length: 10 }, () =>
      t.http().post('/api/auth/otp/verify').set('Host', host).auth(token, auth).send({ code: wrong })));
    expect(guesses.filter((g) => g.body.message === 'The code is wrong.').length).toBeLessThanOrEqual(3);
    // Even the right code is refused now; a new one must be requested.
    await t.http().post('/api/auth/otp/verify').set('Host', host).auth(token, auth).send({ code }).expect(400);
  });

  it('limits login attempts per IP', async () => {
    limitsOn();
    let limited = 0;
    for (let i = 0; i < 32; i++) {
      const res = await t.http().post('/api/auth/login').set('Host', host).send({ userId: `nobody${i}`, password: 'wrong' });
      if (res.status === 429) limited++;
    }
    expect(limited).toBe(2);
  });

  it('limits sign-ups per IP', async () => {
    limitsOn();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await t.http().post('/api/tenants/signup').send({
        subdomain: `spam${i}`, name: 'Spam', contactName: 'S', contactEmail: `s${i}@spam.test`, contactMobile: '+910000000001',
      });
      codes.push(res.status);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('sends security headers and hides the framework', async () => {
    const res = await t.http().get('/api/tenants/current').set('Host', host).expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    // No CORS: another origin's script cannot read the API.
    const cors = await t.http().get('/api/tenants/current').set('Host', host).set('Origin', 'https://evil.example').expect(200);
    expect(cors.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ends a support session inside the client once the staff member logs out of the console', async () => {
    await t.http().post('/api/platform/support-users').set(ADMIN).send({ email: 'sec@banquet.ai', name: 'Sec Agent', role: 'agent' }).expect(201);
    const password = t.passwordIn(t.lastMessage('sec@banquet.ai').body);
    const signIn = async (pw: string) => {
      const otp = (await t.http().post('/api/support/login').send({ email: 'sec@banquet.ai', password: pw }).expect(200)).body.otpToken;
      return (await t.http().post('/api/support/otp/verify').send({ otpToken: otp, code: t.otpIn(t.lastMessage('sec@banquet.ai').body) }).expect(200)).body.token as string;
    };
    let console = await signIn(password);
    await t.http().post('/api/support/change-password').auth(console, auth).send({ currentPassword: password, newPassword: 'Support2026x' }).expect(200);
    console = await signIn('Support2026x');
    const s = (await t.http().post('/api/support/sessions').auth(console, auth).send({ subdomain: 'safe', reason: 'Checking the diary view' }).expect(201)).body;
    const inside = (await t.http().post(`/api/support/sessions/${s.id}/enter`).auth(console, auth).send({ activity: 'operations' }).expect(200)).body.token;
    await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(200);
    await t.http().post('/api/support/logout').auth(console, auth).expect(204);
    await t.http().get('/api/auth/me').set('Host', host).auth(inside, auth).expect(401);
  });
});
