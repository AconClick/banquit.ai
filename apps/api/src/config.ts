/** Central place for environment settings, with development defaults. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/banquetai',
  /** Root domain that tenant sub-domains hang off, e.g. prime.banquet.ai. */
  baseDomain: (process.env.BASE_DOMAIN ?? 'banquet.ai').toLowerCase(),
  /** Allows the X-Tenant header to pick the tenant (local development and the common app.banquet.ai URL). */
  allowTenantHeader: (process.env.ALLOW_TENANT_HEADER ?? 'true') === 'true',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  /** Shared secret for the Banquet.ai platform admin endpoints until the admin console has its own login. */
  platformAdminToken: process.env.PLATFORM_ADMIN_TOKEN ?? 'dev-platform-token',
  /** 'console' logs messages (development); 'aws' sends SMS via SNS and email via SES. */
  notifyProvider: process.env.NOTIFY_PROVIDER ?? 'console',
  awsRegion: process.env.AWS_REGION ?? 'ap-south-1',
  mailFrom: process.env.MAIL_FROM ?? 'no-reply@banquet.ai',
};

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
};
