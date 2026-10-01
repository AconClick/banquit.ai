import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentTenant } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { PricingService } from './pricing.service.js';
import type { PropertySettingsValues } from './settings.js';

class RateDto {
  @IsBoolean() offered: boolean;
  @ValidateIf((_, v) => v !== null) @IsNumber() rate: number | null;
  @ValidateIf((_, v) => v !== null) @IsBoolean() taxInclusive: boolean | null;
  @ValidateIf((_, v) => v !== null) @IsArray() @IsString({ each: true }) taxIds: string[] | null;
}

class SettingsDto {
  @IsOptional() @IsNumber() optionDays?: number;
  @IsOptional() @IsNumber() optionBeforeFunctionDays?: number;
  @IsOptional() @IsNumber() guaranteeCutoffHours?: number;
  @IsOptional() @IsNumber() advancePercent?: number;
  @IsOptional() @IsNumber() secondInstalmentPercent?: number;
  @IsOptional() @IsNumber() secondInstalmentDaysBefore?: number;
  @IsOptional() @IsArray() cancellationSlabs?: PropertySettingsValues['cancellationSlabs'];
  @IsOptional() @IsBoolean() roundTotal?: boolean;
  @IsOptional() defaultTaxIds?: PropertySettingsValues['defaultTaxIds'];
}

/** Per-property prices, taxes and business rules. Reading is open to both panels; changes are Master setup. */
@Controller('properties/:propertyId')
@UseGuards(AuthGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('settings')
  settings(@CurrentTenant() tenant: TenantDocument, @Param('propertyId') propertyId: string) {
    return this.pricing.settings(tenant._id, propertyId);
  }

  @Put('settings')
  @RequirePermission('settings.manage')
  saveSettings(@CurrentTenant() tenant: TenantDocument, @Param('propertyId') propertyId: string, @Body() body: SettingsDto) {
    return this.pricing.saveSettings(tenant._id, propertyId, body);
  }

  @Get('rates')
  rates(@CurrentTenant() tenant: TenantDocument, @Param('propertyId') propertyId: string) {
    return this.pricing.rateSheet(tenant._id, propertyId);
  }

  @Put('rates/:kind/:itemId')
  @RequirePermission('masters.manage')
  saveRate(
    @CurrentTenant() tenant: TenantDocument,
    @Param('propertyId') propertyId: string,
    @Param('kind') kind: string,
    @Param('itemId') itemId: string,
    @Body() body: RateDto,
  ) {
    return this.pricing.saveRate(tenant._id, propertyId, kind, itemId, body);
  }
}
