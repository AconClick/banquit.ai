import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth, CurrentTenant, type AuthContext } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { AllowNoActivity, AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ActivityDto, ChangePasswordDto, ForgotPasswordDto, LoginDto, OtpDto, ResetPasswordDto } from './dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@CurrentTenant() tenant: TenantDocument, @Body() body: LoginDto) {
    return this.auth.login(tenant, body.userId, body.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  changePassword(@CurrentAuth() auth: AuthContext, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(auth, body.currentPassword, body.newPassword);
  }

  @Post('activity')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  activity(@CurrentAuth() auth: AuthContext, @Body() body: ActivityDto) {
    return this.auth.chooseActivity(auth, body.activity);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  verifyOtp(@CurrentAuth() auth: AuthContext, @Body() body: OtpDto) {
    return this.auth.verifyOtp(auth, body.code);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth);
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@CurrentTenant() tenant: TenantDocument, @Body() body: ForgotPasswordDto) {
    await this.auth.forgotPassword(tenant, body.userId);
    return { message: 'If this user exists, a reset link has been emailed.' };
  }

  @Post('reset-password')
  @HttpCode(204)
  async reset(@CurrentTenant() tenant: TenantDocument, @Body() body: ResetPasswordDto) {
    await this.auth.resetPassword(tenant, body.token, body.newPassword);
  }
}
