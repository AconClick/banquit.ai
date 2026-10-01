import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentAuth, CurrentTenant, type AuthContext } from '../common/request-context.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { AllowNoActivity, AuthGuard, NotForSupport, SupportReadOk } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookie, requestToken, SessionCookieInterceptor, setSessionCookie } from './session-cookie.js';
import { ActivityDto, ChangePasswordDto, ForgotPasswordDto, LoginDto, OtpDto, ResetPasswordDto } from './dto.js';

/** Every route that returns a new session token hands it over as the session cookie instead. */
@Controller('auth')
@UseInterceptors(SessionCookieInterceptor)
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
  @NotForSupport()
  changePassword(@CurrentAuth() auth: AuthContext, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(auth, body.currentPassword, body.newPassword);
  }

  @Post('activity')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  @NotForSupport()
  activity(@CurrentAuth() auth: AuthContext, @Body() body: ActivityDto) {
    return this.auth.chooseActivity(auth, body.activity);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  @NotForSupport()
  verifyOtp(@CurrentAuth() auth: AuthContext, @Body() body: OtpDto) {
    return this.auth.verifyOtp(auth, body.code);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  @SupportReadOk()
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth);
    clearSessionCookie(res);
  }

  /**
   * Turns a token given in the Authorization header into the session cookie. Used when Banquet.ai
   * support enters a client's app: the console hands the token over in the link, once.
   */
  @Post('session-cookie')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @AllowNoActivity()
  @SupportReadOk()
  sessionCookie(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const given = requestToken(req);
    if (given?.from !== 'header') throw new BadRequestException('Send the token in the Authorization header.');
    setSessionCookie(res, given.token);
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
