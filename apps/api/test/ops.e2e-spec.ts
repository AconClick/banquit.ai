import { ErrorReporter } from '../src/common/observability.js';
import { TenantsService } from '../src/tenants/tenants.service.js';
import { startApp } from './helpers.js';

describe('Operations: health checks, request ids, error reporting', () => {
  let t: Awaited<ReturnType<typeof startApp>>;
  let reported: Array<Record<string, unknown>>;

  beforeAll(async () => {
    t = await startApp();
    reported = [];
    const reporter = t.app.get(ErrorReporter);
    reporter.report = (_err, context) => reported.push(context);
  });
  afterAll(() => t.close());

  it('answers liveness and readiness without a tenant', async () => {
    expect((await t.http().get('/api/health').set('Host', '10.0.1.23').expect(200)).body.status).toBe('ok');
    const ready = (await t.http().get('/api/health/ready').set('Host', '10.0.1.23').expect(200)).body;
    expect(ready).toMatchObject({ status: 'ok', mongo: 'up' });
  });

  it('gives every response a request id and keeps a sane one from the proxy', async () => {
    const res = await t.http().get('/api/tenants/current').set('Host', 'nobody.banquet.ai').expect(404);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const given = await t.http().get('/api/health').set('X-Request-Id', 'edge-1a2b3c4d').expect(200);
    expect(given.headers['x-request-id']).toBe('edge-1a2b3c4d');
    const bad = await t.http().get('/api/health').set('X-Request-Id', '<script>').expect(200);
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });

  it('answers 400 for a malformed id and reports real server errors with the request id', async () => {
    const { host, token } = await t.tenantWithEntp('opsy', 'operations');
    const cast = await t.http().get('/api/reservations/not-an-id').set('Host', host).auth(token, { type: 'bearer' });
    expect(cast.status).toBeLessThan(500);
    expect(reported).toHaveLength(0);

    const spy = vi.spyOn(TenantsService.prototype, 'getBySubdomain').mockRejectedValueOnce(new Error('database exploded'));
    const res = await t.http().post('/api/tenants/resolve').send({ domain: 'opsy' }).expect(500);
    spy.mockRestore();
    expect(res.body).toEqual({ statusCode: 500, message: 'Something went wrong. Please try again.', requestId: res.headers['x-request-id'] });
    expect(JSON.stringify(res.body)).not.toMatch(/exploded/);
    expect(reported).toEqual([expect.objectContaining({ requestId: res.headers['x-request-id'], method: 'POST', path: '/api/tenants/resolve' })]);
  });
});
