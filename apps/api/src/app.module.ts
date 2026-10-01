import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { authRules, config } from './config.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { TenantMiddleware } from './common/request-context.js';
import { MasterRecord, MasterRecordSchema } from './masters/master-record.schema.js';
import { MastersController } from './masters/masters.controller.js';
import { MastersService } from './masters/masters.service.js';
import { Counter, CounterSchema, HallBlock, HallBlockSchema, Reservation, ReservationSchema } from './reservations/reservation.schema.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { ReservationsService } from './reservations/reservations.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PlatformController, TenantsController } from './platform/platform.controller.js';
import { ProvisioningService } from './platform/provisioning.service.js';
import { Role, RoleSchema } from './roles/role.schema.js';
import { RolesController } from './roles/roles.controller.js';
import { RolesService } from './roles/roles.service.js';
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
      { name: Counter.name, schema: CounterSchema },
    ]),
    JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: `${authRules.maxSessionHours}h` } }),
    NotificationsModule,
  ],
  controllers: [TenantsController, PlatformController, AuthController, RolesController, UsersController, MastersController, ReservationsController],
  providers: [TenantsService, RolesService, UsersService, AuthService, ProvisioningService, MastersService, ReservationsService, AuthGuard],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*path');
  }
}
