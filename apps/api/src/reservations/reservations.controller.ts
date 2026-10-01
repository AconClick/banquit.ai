import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentAuth, CurrentTenant, type AuthContext } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { RESERVATION_STATUSES, SETTLEMENT_MODES, type ReservationStatus, type SettlementMode } from './reservation.schema.js';
import { reservationView, ReservationsService } from './reservations.service.js';

class SlotDto {
  @IsString() @IsNotEmpty() hallId: string;
  @IsString() start: string;
  @IsString() end: string;
}

class ReservationDto {
  @IsString() @IsNotEmpty() propertyId: string;
  @IsIn(RESERVATION_STATUSES) status: ReservationStatus;
  @IsString() @MaxLength(120) hostName: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsString() @MaxLength(30) phone: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsString() functionTypeId: string;
  @IsOptional() @IsString() seatingStyleId?: string;
  @IsInt() guaranteedPax: number;
  @IsInt() expectedMaxPax: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SlotDto) slots: SlotDto[];
  @IsOptional() @IsString() optionDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() amendmentReasonId?: string;
}

class StatusDto {
  @IsIn(RESERVATION_STATUSES) status: ReservationStatus;
  @IsOptional() @IsString() reasonId?: string;
  @IsOptional() @IsString() optionDate?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsNumber() cancellationCharge?: number;
}

class PackageLineDto {
  @IsString() packageId: string;
  @IsInt() pax: number;
  @IsArray() @IsString({ each: true }) choices: string[];
}

class ExtraLineDto {
  @IsIn(['menuItem', 'modifier']) kind: 'menuItem' | 'modifier';
  @IsString() itemId: string;
  @IsNumber() qty: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class MenuDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PackageLineDto) packages: PackageLineDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExtraLineDto) extras: ExtraLineDto[];
  @IsOptional() @IsString() amendmentReasonId?: string;
}

class ReceiptDto {
  @IsNumber() amount: number;
  @IsIn(SETTLEMENT_MODES) mode: SettlementMode;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

class BlockDto {
  @IsString() @IsNotEmpty() hallId: string;
  @IsString() start: string;
  @IsString() end: string;
  @IsString() reasonId: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

@Controller()
@UseGuards(AuthGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('diary')
  @RequirePermission('diary.view')
  diary(
    @CurrentTenant() tenant: TenantDocument,
    @Query('propertyId') propertyId: string,
    @Query('from') from: string,
    @Query('days', new ParseIntPipe({ optional: true })) days = 7,
  ) {
    return this.reservations.diary(tenant._id, propertyId, from, days);
  }

  @Get('reservations/:id')
  @RequirePermission('diary.view')
  async get(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return reservationView(await this.reservations.get(tenant._id, id));
  }

  @Post('reservations')
  @RequirePermission('reservations.manage')
  create(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Body() body: ReservationDto) {
    return this.reservations.create(tenant._id, auth.user.id as string, body);
  }

  @Put('reservations/:id')
  @RequirePermission('reservations.manage')
  update(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: ReservationDto) {
    return this.reservations.update(tenant._id, auth.user.id as string, id, body);
  }

  @Post('reservations/:id/status')
  @HttpCode(200)
  @RequirePermission('reservations.manage')
  status(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: StatusDto) {
    const canSkipAdvance = auth.role.permissions.includes('reservations.confirmWithoutAdvance');
    return this.reservations.changeStatus(tenant._id, auth.user.id as string, id, body.status, { ...body, canSkipAdvance });
  }

  @Get('reservations/:id/details')
  @RequirePermission('diary.view')
  details(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return this.reservations.details(tenant._id, id);
  }

  @Get('reservations/:id/menu-options')
  @RequirePermission('diary.view')
  menuOptions(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    return this.reservations.menuOptions(tenant._id, id);
  }

  @Put('reservations/:id/menu')
  @RequirePermission('reservations.manage')
  menu(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: MenuDto) {
    return this.reservations.saveMenu(tenant._id, auth.user.id as string, id, body);
  }

  @Post('reservations/:id/receipts')
  @RequirePermission('reservations.manage')
  receipt(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: ReceiptDto) {
    return this.reservations.addReceipt(tenant._id, auth.user.id as string, id, body);
  }

  @Post('hall-blocks')
  @RequirePermission('reservations.manage')
  block(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Body() body: BlockDto) {
    return this.reservations.createBlock(tenant._id, auth.user.id as string, body);
  }

  @Post('hall-blocks/:id/remove')
  @HttpCode(204)
  @RequirePermission('reservations.manage')
  async unblock(@CurrentTenant() tenant: TenantDocument, @Param('id') id: string) {
    await this.reservations.removeBlock(tenant._id, id);
  }
}
