import {
  Body, CanActivate, Controller, Req, createParamDecorator, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Param, Post, Put, Query, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AuthGuard, NotForSupport, RequirePermission, SupportReadOk } from '../auth/auth.guard.js';
import { ActivityDto, ChangePasswordDto, OtpDto } from '../auth/dto.js';
import { CurrentAuth, CurrentTenant, type AppRequest, type AuthContext } from '../common/request-context.js';
import { PlatformAdminGuard } from '../platform/platform-admin.guard.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import type { SupportUserDocument } from './support.schema.js';
import { SupportService, supportSessionView, supportUserView } from './support.service.js';

interface ConsoleRequest extends Request {
  supportUser?: SupportUserDocument;
}

/** The Banquet.ai support console: a separate login, never a tenant user. */
@Injectable()
export class SupportConsoleGuard implements CanActivate {
  constructor(private readonly support: SupportService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ConsoleRequest>();
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Please log in to the support console.');
    req.supportUser = await this.support.authenticate(token);
    return true;
  }
}

/** The support user the console guard signed in. */
const SupportUserParam = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<ConsoleRequest>().supportUser as SupportUserDocument);

class ConsoleLoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(200) password: string;
}

class ConsoleOtpDto extends OtpDto {
  @IsString() @IsNotEmpty() otpToken: string;
}

class SupportRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(15) subdomain: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @IsOptional() @IsString() @MaxLength(50) ticket?: string;
  @IsOptional() @IsBoolean() emergency?: boolean;
}

class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

class SupportUserDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(20) mobile?: string;
  @IsOptional() @IsIn(['agent', 'manager']) role?: 'agent' | 'manager';
}

class AccessDto {
  @IsIn(['allowed', 'ask']) supportAccess: 'allowed' | 'ask';
}

@Controller('support')
export class SupportConsoleController {
  constructor(private readonly support: SupportService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: ConsoleLoginDto) {
    return this.support.login(body.email, body.password);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() body: ConsoleOtpDto) {
    return this.support.verifyOtp(body.otpToken, body.code);
  }

  @Get('me')
  @UseGuards(SupportConsoleGuard)
  me(@SupportUserParam() user: SupportUserDocument) {
    return supportUserView(user);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(SupportConsoleGuard)
  changePassword(@SupportUserParam() user: SupportUserDocument, @Body() body: ChangePasswordDto) {
    return this.support.changePassword(user, body.currentPassword, body.newPassword);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SupportConsoleGuard)
  async logout(@SupportUserParam() user: SupportUserDocument) {
    await this.support.logout(user);
  }

  @Get('tenants')
  @UseGuards(SupportConsoleGuard)
  tenants(@Query('q') q?: string) {
    return this.support.tenantList(q);
  }

  @Get('sessions')
  @UseGuards(SupportConsoleGuard)
  sessions(@SupportUserParam() user: SupportUserDocument) {
    return this.support.mySessions(user);
  }

  @Post('sessions')
  @UseGuards(SupportConsoleGuard)
  request(@SupportUserParam() user: SupportUserDocument, @Body() body: SupportRequestDto) {
    return this.support.request(user, body);
  }

  @Post('sessions/:id/enter')
  @HttpCode(200)
  @UseGuards(SupportConsoleGuard)
  enter(@SupportUserParam() user: SupportUserDocument, @Param('id') id: string, @Body() body: ActivityDto) {
    return this.support.enter(user, id, body.activity);
  }

  @Post('sessions/:id/end')
  @HttpCode(200)
  @UseGuards(SupportConsoleGuard)
  end(@SupportUserParam() user: SupportUserDocument, @Param('id') id: string) {
    return this.support.endFromConsole(user, id);
  }
}

/** Used from inside the tenant's app while a support session is open. */
@Controller('support-session')
@UseGuards(AuthGuard)
export class SupportSessionController {
  constructor(private readonly support: SupportService) {}

  @Get()
  info(@CurrentAuth() auth: AuthContext) {
    return supportSessionView(this.session(auth));
  }

  @Post('edit-mode')
  @HttpCode(200)
  @SupportReadOk()
  editMode(@CurrentAuth() auth: AuthContext, @Body() body: ReasonDto) {
    return this.support.editMode(this.session(auth), body.reason);
  }

  /** Switches between Operations and Master inside the same support session. */
  @Post('activity')
  @HttpCode(200)
  @SupportReadOk()
  activity(@CurrentAuth() auth: AuthContext, @Body() body: ActivityDto) {
    return this.support.sessionToken(this.session(auth), body.activity);
  }

  @Post('end')
  @HttpCode(200)
  @SupportReadOk()
  async end(@CurrentAuth() auth: AuthContext) {
    return supportSessionView(await this.support.end(this.session(auth)));
  }

  private session(auth: AuthContext) {
    if (!auth.support) throw new ForbiddenException('This is only for Banquet.ai support sessions.');
    return auth.support;
  }
}

/** The client's side: whether support may enter, pending requests, and the log of every visit. */
@Controller('support-access')
@UseGuards(AuthGuard)
@NotForSupport()
export class SupportAccessController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermission('settings.manage')
  log(@CurrentTenant() tenant: TenantDocument) {
    return this.support.accessLog(tenant);
  }

  @Put()
  @RequirePermission('settings.manage')
  set(@CurrentTenant() tenant: TenantDocument, @Body() body: AccessDto) {
    return this.support.setAccess(tenant, body.supportAccess);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('settings.manage')
  approve(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.support.decide(tenant, id, true, this.name(auth));
  }

  @Post(':id/deny')
  @HttpCode(200)
  @RequirePermission('settings.manage')
  deny(@CurrentTenant() tenant: TenantDocument, @CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.support.decide(tenant, id, false, this.name(auth));
  }

  private name(auth: AuthContext) {
    return `${auth.user.firstName} ${auth.user.lastName ?? ''}`.trim();
  }
}

class EmailDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(100) token: string;
  @IsBoolean() approve: boolean;
}

/** The approve/decline link in a support request email. The token is the permission; no login. */
@Controller('support-approval')
export class SupportApprovalController {
  constructor(private readonly support: SupportService) {}

  @Get()
  view(@Req() req: AppRequest, @Query('token') token: string) {
    return this.support.emailRequest(token, req.tenant);
  }

  @Post()
  @HttpCode(200)
  decide(@Req() req: AppRequest, @Body() body: EmailDecisionDto) {
    return this.support.decideByEmail(body.token, body.approve, req.tenant);
  }
}

/** Banquet.ai's platform admin creates support staff logins. */
@Controller('platform/support-users')
@UseGuards(PlatformAdminGuard)
export class SupportStaffController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@Body() body: SupportUserDto) {
    return this.support.createStaff(body);
  }
}
