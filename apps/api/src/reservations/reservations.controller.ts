import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AuthGuard, RequirePermission } from '../auth/auth.guard.js';
import { CurrentAuth, CurrentTenant, type AuthContext } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { RESERVATION_STATUSES, type ReservationStatus } from './reservation.schema.js';
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
    return this.reservations.changeStatus(tenant._id, auth.user.id as string, id, body.status, body);
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
