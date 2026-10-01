import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayUnique, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentTenant } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { PERMISSIONS } from './permissions.js';
import type { RoleDocument } from './role.schema.js';
import { RolesService } from './roles.service.js';

class RoleDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions: string[];
}

const view = (r: RoleDocument) => ({ id: r.id as string, name: r.name, permissions: r.permissions, builtIn: r.builtIn });

@Controller('roles')
@UseGuards(AuthGuard)
@RequirePermission('roles.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  catalogue() {
    return PERMISSIONS;
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantDocument) {
    return (await this.roles.list(tenant._id)).map(view);
  }

  @Post()
  async create(@CurrentTenant() tenant: TenantDocument, @Body() body: RoleDto) {
    return view(await this.roles.create(tenant._id, body.name, body.permissions));
  }

  @Put(':id')
  async update(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string, @Body() body: RoleDto) {
    return view(await this.roles.update(tenant._id, id, body.name, body.permissions));
  }
}
