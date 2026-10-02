import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentAuth, CurrentTenant, type AuthContext } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import type { LineSource } from './bill-engine.js';
import { BILL_STATUSES, PAYMENT_MODES, type PaymentMode } from './bill.schema.js';
import { BillingSetupService } from './billing-setup.service.js';
import { CreditNotesService } from './credit-notes.service.js';
import { BillingService } from './billing.service.js';

const SOURCES: LineSource[] = ['package', 'extra', 'running', 'hallHire', 'liquorLicence'];

class DiscountDto {
  @IsIn(['percent', 'amount']) type: 'percent' | 'amount';
  @IsNumber() value: number;
  @IsString() @MaxLength(200) reason: string;
}

class LineDto {
  @IsOptional() @IsString() id?: string;
  @IsIn(SOURCES) source: LineSource;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsIn(['alacarte', 'services']) aType?: 'alacarte' | 'services';
  @IsOptional() @IsIn(['menuItem', 'modifier']) kind?: string;
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() hallId?: string;
  @IsOptional() actualPax?: number | null;
  @IsOptional() @IsNumber() qty?: number;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) taxIds?: string[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  @IsOptional() @IsString() @MaxLength(200) remark?: string;
}

class DraftDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) billDiscount?: DiscountDto | null;
}

class PaymentDto {
  @IsOptional() @IsIn(['payment', 'refund']) kind?: 'payment' | 'refund';
  @IsNumber() amount: number;
  @IsIn(PAYMENT_MODES) mode: PaymentMode;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

class VoidDto {
  @IsString() @MaxLength(300) reason: string;
}

class CreditLineDto {
  @IsString() lineId: string;
  @IsNumber() amount: number;
}

class CreditNoteDto {
  @IsString() @MaxLength(300) reason: string;
  @IsOptional() @IsBoolean() full?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreditLineDto) lines?: CreditLineDto[];
}

class SeriesDto {
  @IsString() @MaxLength(40) prefix: string;
  @IsInt() digits: number;
  @IsBoolean() resetYearly: boolean;
}

class SeriesSetDto {
  @IsOptional() @ValidateNested() @Type(() => SeriesDto) bill?: SeriesDto;
  @IsOptional() @ValidateNested() @Type(() => SeriesDto) creditNote?: SeriesDto;
}

class NextNumbersDto {
  @IsOptional() @IsInt() bill?: number;
  @IsOptional() @IsInt() creditNote?: number;
}

class PrintDto {
  @IsOptional() @IsString() @MaxLength(100_000) logo?: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() headerLines?: string;
  @IsOptional() @IsString() registration?: string;
  @IsOptional() @IsString() billTitle?: string;
  @IsOptional() @IsString() proformaTitle?: string;
  @IsOptional() @IsString() creditNoteTitle?: string;
  @IsOptional() @IsString() proformaNote?: string;
  @IsOptional() @IsString() bankDetails?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() footer?: string;
  @IsOptional() @IsString() signatureLabel?: string;
  @IsOptional() @IsBoolean() showDiscountColumn?: boolean;
  @IsOptional() @IsBoolean() showTaxColumn?: boolean;
  @IsOptional() @IsIn(['A4', 'Letter']) paperSize?: 'A4' | 'Letter';
}

class SetupDto {
  @IsOptional() @ValidateNested() @Type(() => PrintDto) print?: PrintDto;
  @IsOptional() @IsInt() fyStartMonth?: number;
  @IsOptional() @ValidateNested() @Type(() => SeriesSetDto) series?: SeriesSetDto;
  @IsOptional() @ValidateNested() @Type(() => NextNumbersDto) nextNumbers?: NextNumbersDto;
}

@Controller('billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly setup: BillingSetupService,
    private readonly credits: CreditNotesService,
  ) {}

  @Get('bills/:id/credit-notes')
  @RequirePermission('billing.manage')
  billCredits(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return this.credits.forBill(tenant._id, id);
  }

  @Post('bills/:id/credit-notes')
  @RequirePermission('billing.approve')
  issueCredit(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: CreditNoteDto) {
    return this.credits.issue(tenant._id, auth.user.id as string, id, body);
  }

  @Get('credit-notes')
  @RequirePermission('billing.manage')
  listCredits(@CurrentTenant() tenant: TenantDocument, @Query('propertyId') propertyId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.credits.list(tenant._id, { propertyId, from, to });
  }

  @Get('credit-notes/:id')
  @RequirePermission('billing.manage')
  getCredit(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return this.credits.get(tenant._id, id);
  }

  @Post('credit-notes/:id/cancel')
  @HttpCode(200)
  @RequirePermission('billing.approve')
  cancelCredit(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: VoidDto) {
    return this.credits.cancel(tenant._id, auth.user.id as string, id, body.reason);
  }

  @Get('setup/:propertyId')
  @RequirePermission('billing.setup')
  getSetup(@CurrentTenant() tenant: TenantDocument, @Param('propertyId') propertyId: string) {
    return this.setup.view(tenant._id, propertyId);
  }

  @Put('setup/:propertyId')
  @RequirePermission('billing.setup')
  saveSetup(@CurrentTenant() tenant: TenantDocument, @Param('propertyId') propertyId: string, @Body() body: SetupDto) {
    return this.setup.save(tenant._id, propertyId, body);
  }

  @Get('bills')
  @RequirePermission('billing.manage')
  list(
    @CurrentTenant() tenant: TenantDocument,
    @Query('propertyId') propertyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const s = status && (BILL_STATUSES as readonly string[]).includes(status) ? status : undefined;
    return this.billing.list(tenant._id, { propertyId, status: s, from, to });
  }

  @Get('bills/:id')
  @RequirePermission('billing.manage')
  get(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return this.billing.getView(tenant._id, id);
  }

  @Get('reservations/:id')
  @RequirePermission('billing.manage')
  forReservation(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return this.billing.forReservation(tenant._id, id);
  }

  @Post('reservations/:id/draft')
  @RequirePermission('billing.manage')
  draft(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.billing.createDraft(tenant._id, auth.user.id as string, id);
  }

  @Put('bills/:id')
  @RequirePermission('billing.manage')
  save(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: DraftDto) {
    return this.billing.saveDraft(tenant._id, auth.user.id as string, id, body);
  }

  @Post('bills/:id/refresh')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  refresh(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.billing.refreshDraft(tenant._id, auth.user.id as string, id);
  }

  @Post('bills/:id/finalise')
  @HttpCode(200)
  @RequirePermission('billing.approve')
  finalise(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.billing.finalise(tenant._id, auth.user.id as string, id);
  }

  @Post('bills/:id/payments')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  pay(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: PaymentDto) {
    return this.billing.addPayment(tenant._id, auth.user.id as string, id, body);
  }

  @Post('bills/:id/void')
  @HttpCode(200)
  @RequirePermission('billing.approve')
  void(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: VoidDto) {
    return this.billing.void(tenant._id, auth.user.id as string, id, body.reason);
  }
}
