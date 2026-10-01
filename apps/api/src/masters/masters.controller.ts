import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentTenant } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { MASTERS } from './definitions.js';
import { masterView, MastersService } from './masters.service.js';

class ActiveDto {
  @IsBoolean() active: boolean;
}

/**
 * All Master Data Set screens share these endpoints. Reading is open to any logged-in user
 * (Operations needs halls, menus and taxes too); changes need the "masters.manage" permission.
 */
@Controller('masters')
@UseGuards(AuthGuard)
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  definitions() {
    return MASTERS;
  }

  @Get(':kind')
  async list(
    @CurrentTenant() tenant: TenantDocument,
    @Param('kind') kind: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ) {
    return (await this.masters.list(tenant._id, kind, !!includeInactive)).map(masterView);
  }

  @Post(':kind')
  @RequirePermission('masters.manage')
  async create(@CurrentTenant() tenant: TenantDocument, @Param('kind') kind: string, @Body() body: Record<string, unknown>) {
    return masterView(await this.masters.create(tenant._id, kind, body));
  }

  @Put(':kind/:id')
  @RequirePermission('masters.manage')
  async update(
    @CurrentTenant() tenant: TenantDocument,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return masterView(await this.masters.update(tenant._id, kind, id, body));
  }

  @Post(':kind/:id/active')
  @HttpCode(200)
  @RequirePermission('masters.manage')
  async setActive(
    @CurrentTenant() tenant: TenantDocument,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: ActiveDto,
  ) {
    return masterView(await this.masters.setActive(tenant._id, kind, id, body.active));
  }
}
