/**
 * Development seed: creates and approves the demo tenant "prime" and prints the entp password.
 * Run with `npm run seed` after `npm run build`.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ProvisioningService } from './platform/provisioning.service.js';
import { TenantsService } from './tenants/tenants.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
const tenants = app.get(TenantsService);
const exists = await tenants.getBySubdomain('prime').catch(() => null);
if (exists) {
  console.log('Tenant "prime" already exists. Log in at http://localhost:4200 with domain "prime".');
} else {
  const tenant = await tenants.signup({
    subdomain: 'prime',
    name: 'Hotel Prime Residency',
    contactName: 'Demo Owner',
    contactEmail: 'owner@prime.test',
    contactMobile: '+910000000000',
  });
  await app.get(ProvisioningService).approve(tenant, 'manual', 'seed script');
  console.log('Created tenant "prime". The entp password is in the email logged above.');
}
await app.close();
