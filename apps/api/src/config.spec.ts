import { productionConfigProblems } from './config.js';

describe('productionConfigProblems', () => {
  const good = {
    JWT_SECRET: 'x'.repeat(48), PLATFORM_ADMIN_TOKEN: 'y'.repeat(48), MONGO_URL: 'mongodb+srv://cluster/db', NOTIFY_PROVIDER: 'aws',
  };

  it('accepts a complete production setup', () => {
    expect(productionConfigProblems(good)).toEqual([]);
  });

  it('refuses development secrets, short secrets and the console notifier', () => {
    const problems = productionConfigProblems({ ...good, JWT_SECRET: 'dev-only-secret-change-me', PLATFORM_ADMIN_TOKEN: 'short', NOTIFY_PROVIDER: undefined });
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toMatch(/JWT_SECRET.*PLATFORM_ADMIN_TOKEN.*NOTIFY_PROVIDER/);
  });

  it('refuses a missing database and switched-off protections', () => {
    const problems = productionConfigProblems({ ...good, MONGO_URL: '', SECURE_COOKIES: 'false', RATE_LIMITS: 'false' });
    expect(problems).toEqual([
      'MONGO_URL must be set.', 'SECURE_COOKIES cannot be false in production.', 'RATE_LIMITS cannot be false in production.',
    ]);
  });
});
