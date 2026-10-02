import { config } from '../src/config.js';
import { ADMIN, startApp, tokenOf } from './helpers.js';

/** Before a domain is bought, every client shares one address (the CloudFront default) and picks its Domain at login. */
describe('Single shared address (no domain yet)', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  const host = 'd123abc.cloudfront.net';

  beforeAll(async () => {
    t = await startApp();
    config.singleHost = host;
  });
  afterAll(async () => {
    config.singleHost = '';
    await t.close();
  });

  it('picks the client from the Domain typed at login and puts it in every email link', async () => {
    await t.http().post('/api/tenants/signup').send({
      subdomain: 'shared', name: 'Shared Hotel', contactName: 'Owner', contactEmail: 'owner@shared.test', contactMobile: '+919811111111',
    }).expect(201);
    await t.http().post('/api/platform/tenants/shared/approve').set(ADMIN).send({ approvedBy: 'test' }).expect(200);
    const welcome = t.lastMessage('owner@shared.test').body;
    expect(welcome).toContain(`https://${host}/login?domain=shared`);

    // Without the Domain the shared address belongs to no client.
    await t.http().get('/api/tenants/current').set('Host', host).expect(404);
    const current = await t.http().get('/api/tenants/current').set('Host', host).set('X-Tenant', 'shared').expect(200);
    expect(current.body).toMatchObject({ subdomain: 'shared', fromHost: false });

    const password = t.passwordIn(welcome);
    const login = await t.http().post('/api/auth/login').set('Host', host).set('X-Tenant', 'shared').send({ userId: 'entp', password }).expect(200);
    await t.http().get('/api/auth/me').set('Host', host).set('X-Tenant', 'shared').auth(tokenOf(login), { type: 'bearer' }).expect(200);

    await t.http().post('/api/auth/forgot-password').set('Host', host).set('X-Tenant', 'shared').send({ userId: 'entp' }).expect(202);
    expect(t.lastMessage('owner@shared.test').body).toMatch(new RegExp(`https://${host.replace(/\./g, '\\.')}/reset-password\\?token=[0-9a-f]+&domain=shared`));
  });
});
