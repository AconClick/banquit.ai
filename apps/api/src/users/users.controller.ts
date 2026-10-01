import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentAuth, CurrentTenant, type AuthContext } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { publicUser, UsersService } from './users.service.js';

export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(30) userId: string;
  @IsString() @IsNotEmpty() @MaxLength(60) firstName: string;
  @IsOptional() @IsString() @MaxLength(60) lastName?: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
  @IsMongoId() roleId: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MaxLength(60) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
  @IsOptional() @IsMongoId() roleId?: string;
}

class ActiveDto {
  @IsBoolean() active: boolean;
}

@Controller('users')
@UseGuards(AuthGuard)
@RequirePermission('users.manage')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
  ) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantDocument) {
    return (await this.users.list(tenant._id)).map(publicUser);
  }

  @Post()
  async create(@CurrentTenant() tenant: TenantDocument, @Body() body: CreateUserDto) {
    return publicUser(await this.users.create(tenant._id, body, 'standard', this.tenants.loginHost(tenant)));
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string, @Body() body: UpdateUserDto) {
    return publicUser(await this.users.update(tenant._id, id, body));
  }

  @Post(':id/active')
  @HttpCode(200)
  async setActive(
    @CurrentTenant() tenant: TenantDocument,
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: ActiveDto,
  ) {
    return publicUser(await this.users.setActive(tenant._id, id, body.active, auth.user.id as string));
  }

  @Post(':id/unlock')
  @HttpCode(200)
  async unlock(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return publicUser(await this.users.unlock(tenant._id, id));
  }
}
