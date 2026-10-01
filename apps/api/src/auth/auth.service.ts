import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { authRules } from '../config.js';
import { checkPassword, generateOtp, hashPassword, passwordProblem, randomToken, sha256 } from '../common/passwords.js';
import type { AuthContext } from '../common/request-context.js';
import { Notifier } from '../notifications/notifier.js';
import { activitiesFor, type Activity } from '../roles/permissions.js';
import { Role } from '../roles/role.schema.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { publicUser } from '../users/users.service.js';
import { User, UserDocument } from '../users/user.schema.js';
import type { TokenPayload } from './auth.guard.js';

const INVALID_LOGIN = 'Invalid user id or password.';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Role.name) private readonly roles: Model<Role>,
    private readonly jwt: JwtService,
    private readonly notifier: Notifier,
    private readonly tenants: TenantsService,
  ) {}

  async login(tenant: TenantDocument, userId: string, password: string) {
    const user = await this.users
      .findOne({ tenantId: tenant._id, userId: userId.trim().toLowerCase() })
      .select('+passwordHash');
    if (!user || !user.active) throw new UnauthorizedException(INVALID_LOGIN);

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException(`Too many wrong passwords. Try again in ${minutes} minute(s).`, HttpStatus.LOCKED);
    }

    if (!(await checkPassword(password, user.passwordHash))) {
      user.failedLogins += 1;
      if (user.failedLogins >= authRules.maxFailedLogins) {
        user.failedLogins = 0;
        user.lockedUntil = new Date(Date.now() + authRules.lockMinutes * 60_000);
      }
      await user.save();
      throw new UnauthorizedException(INVALID_LOGIN);
    }

    // One active session per user: a new session id makes every older token invalid.
    user.failedLogins = 0;
    user.set('lockedUntil', undefined);
    user.sessionId = randomUUID();
    user.lastSeenAt = new Date();
    await user.save();
    return this.session(user);
  }

  async me(auth: AuthContext) {
    return {
      user: publicUser(auth.user),
      role: { id: auth.role.id as string, name: auth.role.name, permissions: auth.role.permissions },
      activity: auth.activity ?? null,
      activities: activitiesFor(auth.role.permissions),
    };
  }

  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string) {
    const user = await this.users.findById(auth.user._id).select('+passwordHash +passwordHistory +sessionId');
    if (!user || !(await checkPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is wrong.');
    }
    await this.setPassword(user, newPassword);
    return this.session(user, auth.activity);
  }

  /** Operations opens straight away. Master needs an OTP first, sent by SMS (or email if no mobile). */
  async chooseActivity(auth: AuthContext, activity: Activity) {
    if (auth.user.mustChangePassword) throw new ForbiddenException('Please change your password first.');
    if (!activitiesFor(auth.role.permissions).includes(activity)) {
      throw new ForbiddenException('You do not have access to this panel.');
    }
    if (activity === 'operations') return { otpRequired: false, ...(await this.session(auth.user, 'operations')) };

    const user = auth.user;
    if (user.otpSentAt && Date.now() - user.otpSentAt.getTime() < authRules.otpResendSeconds * 1000) {
      throw new HttpException('Please wait a few seconds before asking for a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtp(authRules.otpLength);
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          otpHash: sha256(`${user.id}:${code}`),
          otpExpiresAt: new Date(Date.now() + authRules.otpValidMinutes * 60_000),
          otpSentAt: new Date(),
          otpAttempts: 0,
        },
      },
    );
    const body = `Your Banquet.ai code for Master access is ${code}. It is valid for ${authRules.otpValidMinutes} minutes.`;
    const sentTo = user.mobile
      ? (await this.notifier.send({ channel: 'sms', to: user.mobile, body }), 'mobile')
      : (await this.notifier.send({ channel: 'email', to: user.email, subject: 'Banquet.ai verification code', body }), 'email');
    return { otpRequired: true, sentTo };
  }

  async verifyOtp(auth: AuthContext, code: string) {
    const user = await this.users.findById(auth.user._id).select('+otpHash +sessionId');
    if (!user?.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new BadRequestException('The code has expired. Please ask for a new one.');
    }
    if (user.otpAttempts >= authRules.otpMaxAttempts) {
      throw new BadRequestException('Too many wrong codes. Please ask for a new one.');
    }
    if (sha256(`${user.id}:${code.trim()}`) !== user.otpHash) {
      user.otpAttempts += 1;
      await user.save();
      throw new BadRequestException('The code is wrong.');
    }
    user.set('otpHash', undefined);
    user.set('otpExpiresAt', undefined);
    user.otpAttempts = 0;
    await user.save();
    return this.session(user, 'master');
  }

  async logout(auth: AuthContext) {
    await this.users.updateOne({ _id: auth.user._id }, { $unset: { sessionId: 1 } });
  }

  /** Always answers the same way, so it cannot be used to find out which user ids exist. */
  async forgotPassword(tenant: TenantDocument, userId: string) {
    const user = await this.users.findOne({ tenantId: tenant._id, userId: userId.trim().toLowerCase(), active: true });
    if (!user) return;
    const token = randomToken();
    user.resetTokenHash = sha256(token);
    user.resetExpiresAt = new Date(Date.now() + authRules.resetLinkMinutes * 60_000);
    await user.save();
    await this.notifier.send({
      channel: 'email',
      to: user.email,
      subject: 'Reset your Banquet.ai password',
      body: `Open https://${this.tenants.loginHost(tenant)}/reset-password?token=${token} within ${authRules.resetLinkMinutes} minutes to set a new password.`,
    });
  }

  async resetPassword(tenant: TenantDocument, token: string, newPassword: string) {
    const user = await this.users
      .findOne({ tenantId: tenant._id, resetTokenHash: sha256(token), resetExpiresAt: { $gt: new Date() } })
      .select('+passwordHash +passwordHistory');
    if (!user) throw new BadRequestException('This reset link is invalid or has expired.');
    user.set('resetTokenHash', undefined);
    user.set('resetExpiresAt', undefined);
    user.failedLogins = 0;
    user.set('lockedUntil', undefined);
    user.set('sessionId', undefined);
    await this.setPassword(user, newPassword);
  }

  private async setPassword(user: UserDocument, newPassword: string) {
    const problem = passwordProblem(newPassword);
    if (problem) throw new BadRequestException(problem);
    const recent = [user.passwordHash, ...(user.passwordHistory ?? [])].slice(0, authRules.passwordHistory);
    for (const old of recent) {
      if (await checkPassword(newPassword, old)) {
        throw new BadRequestException(`You cannot reuse any of your last ${authRules.passwordHistory} passwords.`);
      }
    }
    user.passwordHistory = recent.slice(0, authRules.passwordHistory - 1);
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();
  }

  private async session(user: UserDocument, activity?: Activity) {
    const role = await this.roles.findById(user.roleId);
    const payload: TokenPayload = { sub: user.id as string, tid: String(user.tenantId), sid: user.sessionId as string };
    if (activity) payload.act = activity;
    return {
      token: await this.jwt.signAsync(payload),
      user: publicUser(user),
      activity: activity ?? null,
      activities: activitiesFor(role?.permissions ?? []),
      mustChangePassword: user.mustChangePassword,
    };
  }
}
