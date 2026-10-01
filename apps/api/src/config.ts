const production = process.env.NODE_ENV === 'production';

/** Central place for environment settings, with development defaults. */
export const config = {
  production,
  port: Number(process.env.PORT ?? 3000),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/banquetai',
  /** Root domain that tenant sub-domains hang off, e.g. prime.banquet.ai. */
  baseDomain: (process.env.BASE_DOMAIN ?? 'banquet.ai').toLowerCase(),
  /** Allows the X-Tenant header to pick the tenant (local development and the common app.banquet.ai URL). */
  allowTenantHeader: (process.env.ALLOW_TENANT_HEADER ?? String(!production)) === 'true',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  /** Shared secret for the Banquet.ai platform admin endpoints until the admin console has its own login. */
  platformAdminToken: process.env.PLATFORM_ADMIN_TOKEN ?? 'dev-platform-token',
  /** 'console' logs messages (development); 'aws' sends SMS via SNS and email via SES. */
  notifyProvider: process.env.NOTIFY_PROVIDER ?? 'console',
  awsRegion: process.env.AWS_REGION ?? 'ap-south-1',
  mailFrom: process.env.MAIL_FROM ?? 'no-reply@banquet.ai',
  /** Session cookies carry the Secure flag (always in production; off for http://localhost). */
  secureCookies: (process.env.SECURE_COOKIES ?? String(production)) === 'true',
  /**
   * How many proxies in front of the API to trust for the client IP (X-Forwarded-For).
   * Behind CloudFront and an ALB this is 2. Trusting every hop would let anyone fake their IP.
   */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  /** Browser origins allowed to call the API from another origin. Empty: same origin only (the web app and API share a host). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  /** Turns the per-IP request limits off (load tests only). */
  rateLimits: (process.env.RATE_LIMITS ?? 'true') === 'true',
};

const DEV_SECRETS = ['dev-only-secret-change-me', 'dev-platform-token'];

/** Settings a production start refuses to run without. Returns the problems found (empty when fine). */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const secret = (name: string) => {
    const value = env[name] ?? '';
    if (value.length < 32 || DEV_SECRETS.includes(value)) problems.push(`${name} must be set to a random value of at least 32 characters.`);
  };
  secret('JWT_SECRET');
  secret('PLATFORM_ADMIN_TOKEN');
  if (!env.MONGO_URL) problems.push('MONGO_URL must be set.');
  if ((env.NOTIFY_PROVIDER ?? 'console') !== 'aws') problems.push('NOTIFY_PROVIDER must be "aws" (the console provider logs passwords and codes).');
  if (env.SECURE_COOKIES === 'false') problems.push('SECURE_COOKIES cannot be false in production.');
  if (env.RATE_LIMITS === 'false') problems.push('RATE_LIMITS cannot be false in production.');
  return problems;
}

export const authRules = {
  maxFailedLogins: 5,
  lockMinutes: 15,
  idleMinutes: 30,
  maxSessionHours: 12,
  passwordHistory: 3,
  otpLength: 6,
  otpValidMinutes: 5,
  otpMaxAttempts: 3,
  otpResendSeconds: 30,
  resetLinkMinutes: 30,
  /** A support session ends after this many hours; a new reason is needed to enter again. */
  supportSessionHours: 4,
};
