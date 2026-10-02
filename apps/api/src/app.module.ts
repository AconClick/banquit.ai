import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { authRules, config } from './config.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { Bill, BillSchema } from './billing/bill.schema.js';
import { BillingSetup, BillingSetupSchema } from './billing/billing-setup.schema.js';
import { BillingSetupService } from './billing/billing-setup.service.js';
import { BillingController } from './billing/billing.controller.js';
import { BillingService } from './billing/billing.service.js';
import { BOOKING_SOURCE, ReservationBookingSource } from './billing/booking-source.js';
import { ErrorReporter, LogErrorReporter, ReportingExceptionFilter, RequestLogMiddleware } from './common/observability.js';
import { RateLimiter, RateLimitMiddleware } from './common/rate-limit.js';
import { HealthController } from './health/health.controller.js';
import { TenantMiddleware } from './common/request-context.js';
import { MasterRecord, MasterRecordSchema } from './masters/master-record.schema.js';
import { MastersController } from './masters/masters.controller.js';
import { MastersService } from './masters/masters.service.js';
import { Counter, CounterSchema, HallBlock, HallBlockSchema, HallLock, HallLockSchema, Reservation, ReservationSchema } from './reservations/reservation.schema.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { BookingDetailsService } from './reservations/booking-details.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { PricingService } from './pricing/pricing.service.js';
import { PropertyRate, PropertyRateSchema, PropertySettings, PropertySettingsSchema } from './pricing/pricing.schema.js';
import { ReservationsService } from './reservations/reservations.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PlatformController, TenantsController } from './platform/platform.controller.js';
import { ProvisioningService } from './platform/provisioning.service.js';
import { Role, RoleSchema } from './roles/role.schema.js';
import { ReportCacheService } from './reports/report-cache.service.js';
import { ReportSummary, ReportSummarySchema, ReportWatermark, ReportWatermarkSchema } from './reports/report-summary.schema.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { RolesController } from './roles/roles.controller.js';
import { RolesService } from './roles/roles.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminAction, AdminActionSchema, Plan, PlanSchema, PlatformPayment, PlatformPaymentSchema } from './admin/admin.schema.js';
import { AdminService } from './admin/admin.service.js';
import { DnsLookup, NodeDnsLookup } from './admin/dns.js';
import { AdminConsoleGuard, SupportAccessController, SupportApprovalController, SupportConsoleController, SupportConsoleGuard, SupportSessionController, SupportStaffController } from './support/support.controller.js';
import { SupportSession, SupportSessionSchema, SupportUser, SupportUserSchema } from './support/support.schema.js';
import { SupportService } from './support/support.service.js';
import { Tenant, TenantSchema } from './tenants/tenant.schema.js';
import { TenantsService } from './tenants/tenants.service.js';
import { User, UserSchema } from './users/user.schema.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Module({
  imports: [
    MongooseModule.forRoot(config.mongoUrl),
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: MasterRecord.name, schema: MasterRecordSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: HallBlock.name, schema: HallBlockSchema },
      { name: HallLock.name, schema: HallLockSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: PropertyRate.name, schema: PropertyRateSchema },
      { name: PropertySettings.name, schema: PropertySettingsSchema },
      { name: Bill.name, schema: BillSchema },
      { name: BillingSetup.name, schema: BillingSetupSchema },
      { name: SupportUser.name, schema: SupportUserSchema },
      { name: SupportSession.name, schema: SupportSessionSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: PlatformPayment.name, schema: PlatformPaymentSchema },
      { name: AdminAction.name, schema: AdminActionSchema },
      { name: ReportSummary.name, schema: ReportSummarySchema },
      { name: ReportWatermark.name, schema: ReportWatermarkSchema },
    ]),
    JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: `${authRules.maxSessionHours}h` } }),
    NotificationsModule,
  ],
  controllers: [HealthController, TenantsController, PlatformController, AuthController, RolesController, UsersController, MastersController, ReservationsController, PricingController, ReportsController, BillingController,
    SupportConsoleController, SupportSessionController, SupportAccessController, SupportApprovalController, SupportStaffController, AdminController],
  providers: [TenantsService, RolesService, UsersService, AuthService, ProvisioningService, MastersService, PricingService, BookingDetailsService, ReservationsService, ReportsService, ReportCacheService, AuthGuard,
    RateLimiter, { provide: ErrorReporter, useClass: LogErrorReporter }, { provide: APP_FILTER, useClass: ReportingExceptionFilter }, BillingService, BillingSetupService, { provide: BOOKING_SOURCE, useClass: ReservationBookingSource }, SupportService, SupportConsoleGuard, AdminConsoleGuard, AdminService, { provide: DnsLookup, useClass: NodeDnsLookup }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLogMiddleware).forRoutes('*path');
    // Health checks come from the load balancer by IP address: no tenant, no limits.
    consumer.apply(RateLimitMiddleware, TenantMiddleware).exclude('health', 'health/ready').forRoutes('*path');
  }
}
