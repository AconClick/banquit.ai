import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AdminConsoleGuard, SupportUserParam } from '../support/support.controller.js';
import { SUPPORT_ROLES, type SupportRole, type SupportUserDocument } from '../support/support.schema.js';
import { SupportService } from '../support/support.service.js';
import { PAYMENT_METHODS, type PaymentMethod } from './admin.schema.js';
import { AdminService } from './admin.service.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class ApproveDto {
  @IsOptional() @IsString() @MaxLength(20) planCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) trialDays?: number;
}

class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

class PlanDto {
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsNumber() @Min(0) monthlyPrice?: number;
  @IsOptional() @IsNumber() @Min(0) yearlyPrice?: number;
  @IsOptional() @IsInt() @Min(0) maxProperties?: number;
  @IsOptional() @IsInt() @Min(0) maxUsers?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class SetPlanDto {
  @IsString() @IsNotEmpty() @MaxLength(20) planCode: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATE) trialEndsAt?: string | null;
}

class PaymentDto {
  @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @Matches(DATE) periodFrom: string;
  @Matches(DATE) periodTo: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class DomainDto {
  @IsString() @IsNotEmpty() @MaxLength(253) domain: string;
}

class StaffDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
  @IsOptional() @IsIn(SUPPORT_ROLES) role?: SupportRole;
}

class StaffUpdateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
  @IsOptional() @IsIn(SUPPORT_ROLES) role?: SupportRole;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** The Banquet.ai admin console (Banquet.ai admins only): clients, plans, payments, domains and staff. */
@Controller('admin')
@UseGuards(AdminConsoleGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly support: SupportService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('log')
  recentActions() {
    return this.admin.recentActions();
  }

  @Get('tenants')
  tenants(@Query('q') q?: string, @Query('status') status?: string, @Query('billing') billing?: string) {
    return this.admin.listTenants({ q, status, billing });
  }

  @Get('tenants/:subdomain')
  tenant(@Param('subdomain') subdomain: string) {
    return this.admin.tenantDetail(subdomain);
  }

  @Post('tenants/:subdomain/approve')
  @HttpCode(200)
  approve(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: ApproveDto) {
    return this.admin.approve(me.name, subdomain, body);
  }

  @Post('tenants/:subdomain/reject')
  @HttpCode(200)
  reject(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: ReasonDto) {
    return this.admin.reject(me.name, subdomain, body.reason);
  }

  @Post('tenants/:subdomain/suspend')
  @HttpCode(200)
  suspend(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: ReasonDto) {
    return this.admin.suspend(me.name, subdomain, body.reason);
  }

  @Post('tenants/:subdomain/reactivate')
  @HttpCode(200)
  reactivate(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: ReasonDto) {
    return this.admin.reactivate(me.name, subdomain, body.reason);
  }

  @Put('tenants/:subdomain/plan')
  setPlan(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: SetPlanDto) {
    return this.admin.setPlan(me.name, subdomain, body);
  }

  @Post('tenants/:subdomain/payments')
  recordPayment(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: PaymentDto) {
    return this.admin.recordPayment(me.name, subdomain, body);
  }

  @Post('tenants/:subdomain/domains')
  addDomain(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Body() body: DomainDto) {
    return this.admin.addDomain(me.name, subdomain, body.domain);
  }

  @Post('tenants/:subdomain/domains/:domain/check')
  @HttpCode(200)
  checkDomain(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Param('domain') domain: string) {
    return this.admin.checkDomain(me.name, subdomain, domain);
  }

  @Delete('tenants/:subdomain/domains/:domain')
  removeDomain(@SupportUserParam() me: SupportUserDocument, @Param('subdomain') subdomain: string, @Param('domain') domain: string) {
    return this.admin.removeDomain(me.name, subdomain, domain);
  }

  @Get('plans')
  plans() {
    return this.admin.listPlans();
  }

  @Post('plans')
  createPlan(@SupportUserParam() me: SupportUserDocument, @Body() body: PlanDto) {
    return this.admin.createPlan(me.name, body);
  }

  @Put('plans/:code')
  updatePlan(@SupportUserParam() me: SupportUserDocument, @Param('code') code: string, @Body() body: PlanDto) {
    return this.admin.updatePlan(me.name, code, body);
  }

  @Get('staff')
  staff() {
    return this.support.listStaff();
  }

  @Post('staff')
  async createStaff(@SupportUserParam() me: SupportUserDocument, @Body() body: StaffDto) {
    const created = await this.support.createStaff(body);
    await this.admin.log(me.name, undefined, 'Support user added', `${created.name} (${created.role})`);
    return created;
  }

  @Put('staff/:id')
  async updateStaff(@SupportUserParam() me: SupportUserDocument, @Param('id') id: string, @Body() body: StaffUpdateDto) {
    const updated = await this.support.updateStaff(me, id, body);
    await this.admin.log(me.name, undefined, 'Support user changed', `${updated.name}: ${Object.keys(body).join(', ')}`);
    return updated;
  }

  @Post('staff/:id/reset-password')
  @HttpCode(200)
  async resetStaffPassword(@SupportUserParam() me: SupportUserDocument, @Param('id') id: string) {
    const updated = await this.support.resetStaffPassword(id);
    await this.admin.log(me.name, undefined, 'Support password reset', updated.name);
    return updated;
  }
}
