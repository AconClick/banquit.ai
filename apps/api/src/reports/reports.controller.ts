import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentTenant } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { ReportsService } from './reports.service.js';

class ReportQueryDto {
  /** Leave out for all properties. */
  @IsOptional() @IsString() propertyId?: string;
  @IsString() from: string;
  @IsString() to: string;
}

@Controller('reports')
@UseGuards(AuthGuard)
@RequirePermission('reports.view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('bookings-by-status')
  bookingsByStatus(@CurrentTenant() tenant: TenantDocument, @Query() q: ReportQueryDto) {
    return this.reports.bookingsByStatus(tenant._id, q);
  }

  @Get('hall-occupancy')
  hallOccupancy(@CurrentTenant() tenant: TenantDocument, @Query() q: ReportQueryDto) {
    return this.reports.hallOccupancy(tenant._id, q);
  }

  @Get('enquiry-conversion')
  enquiryConversion(@CurrentTenant() tenant: TenantDocument, @Query() q: ReportQueryDto) {
    return this.reports.enquiryConversion(tenant._id, q);
  }

  @Get('function-sheets')
  functionSheets(@CurrentTenant() tenant: TenantDocument, @Query() q: ReportQueryDto) {
    return this.reports.functionSheets(tenant._id, q);
  }

  @Get('forecast')
  forecast(@CurrentTenant() tenant: TenantDocument, @Query() q: ReportQueryDto) {
    return this.reports.forecast(tenant._id, q);
  }

  @Get('revenue')
  revenue(@CurrentTenant() tenant: TenantDocument, @Query() q: ReportQueryDto) {
    return this.reports.revenue(tenant._id, q);
  }
}
