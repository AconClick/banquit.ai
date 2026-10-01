import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentTenant, type AppRequest } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { TENANT_STATUS_MESSAGES } from '../tenants/subdomain-rules.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { publicUser } from '../users/users.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { ProvisioningService } from './provisioning.service.js';

class SignupDto {
  @IsString() @IsNotEmpty() @MaxLength(15) subdomain: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @IsNotEmpty() @MaxLength(120) contactName: string;
  @IsEmail() contactEmail: string;
  @IsString() @IsNotEmpty() @MaxLength(20) contactMobile: string;
}

class ResolveDto {
  @IsString() @IsNotEmpty() @MaxLength(253) domain: string;
}

class ApproveDto {
  @IsString() @IsNotEmpty() @MaxLength(120) approvedBy: string;
}

class PaymentDto {
  @IsString() @IsNotEmpty() subdomain: string;
  @IsString() @IsNotEmpty() @MaxLength(120) reference: string;
}

class ImplementationUserDto {
  @IsString() @IsNotEmpty() @MaxLength(30) userId: string;
  @IsString() @IsNotEmpty() @MaxLength(60) firstName: string;
  @IsOptional() @IsString() @MaxLength(60) lastName?: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
}

class DomainDto {
  @IsString() @IsNotEmpty() domain: string;
  @IsBoolean() verified: boolean;
}

const tenantView = (t: TenantDocument) => ({
  subdomain: t.subdomain,
  name: t.name,
  status: t.status,
  approval: t.approval ?? null,
  customDomains: t.customDomains,
});

/** Public endpoints used by the sign-up form and the login page. */
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post('signup')
  async signup(@Body() body: SignupDto) {
    return tenantView(await this.tenants.signup(body));
  }

  /** "Domain" step on the common login page: where should the browser go? */
  @Post('resolve')
  @HttpCode(200)
  async resolve(@Body() body: ResolveDto) {
    const tenant = await this.tenants.getBySubdomain(body.domain);
    return {
      subdomain: tenant.subdomain,
      name: tenant.name,
      active: tenant.status === 'active',
      message: TENANT_STATUS_MESSAGES[tenant.status] ?? null,
      loginHost: this.tenants.loginHost(tenant),
    };
  }

  /** The tenant this address belongs to, so the login page can show its name. */
  @Get('current')
  current(@Req() req: AppRequest, @CurrentTenant({ allowInactive: true }) tenant: TenantDocument) {
    return {
      subdomain: tenant.subdomain,
      name: tenant.name,
      active: tenant.status === 'active',
      message: TENANT_STATUS_MESSAGES[tenant.status] ?? null,
      fromHost: !req.header('x-tenant'),
    };
  }
}

/** Banquet.ai's own admin actions. */
@Controller('platform')
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly provisioning: ProvisioningService,
  ) {}

  @Get('tenants/:subdomain')
  async get(@Param('subdomain') subdomain: string) {
    return tenantView(await this.tenants.getBySubdomain(subdomain));
  }

  @Post('tenants/:subdomain/approve')
  @HttpCode(200)
  async approve(@Param('subdomain') subdomain: string, @Body() body: ApproveDto) {
    const tenant = await this.tenants.getBySubdomain(subdomain);
    return tenantView(await this.provisioning.approve(tenant, 'manual', body.approvedBy));
  }

  /** Called when the payment gateway confirms the sign-up payment. */
  @Post('payments/confirmed')
  @HttpCode(200)
  async paymentConfirmed(@Body() body: PaymentDto) {
    const tenant = await this.tenants.getBySubdomain(body.subdomain);
    return tenantView(await this.provisioning.approve(tenant, 'payment', body.reference));
  }

  @Post('tenants/:subdomain/implementation-users')
  async addImplementationUser(@Param('subdomain') subdomain: string, @Body() body: ImplementationUserDto) {
    const tenant = await this.tenants.getBySubdomain(subdomain);
    return publicUser(await this.provisioning.addImplementationUser(tenant, body));
  }

  @Post('tenants/:subdomain/domains')
  @HttpCode(200)
  async addDomain(@Param('subdomain') subdomain: string, @Body() body: DomainDto) {
    const tenant = await this.tenants.getBySubdomain(subdomain);
    return tenantView(await this.tenants.addCustomDomain(tenant, body.domain, body.verified));
  }
}
