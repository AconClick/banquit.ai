import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { config } from './config.js';

export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  // Only the proxies we run (CloudFront and the load balancer) may tell us the client's IP.
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  // The API only returns JSON: forbid it from being framed or run as a page, and require HTTPS for a year.
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: config.production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  }));
  // The web app calls the API on its own host, so cross-origin calls are off unless origins are listed.
  if (config.corsOrigins.length) app.enableCors({ origin: config.corsOrigins, credentials: true });
  return app;
}
