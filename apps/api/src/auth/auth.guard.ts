import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { authRules } from '../config.js';
import type { AppRequest } from '../common/request-context.js';
import { Role } from '../roles/role.schema.js';
import { PERMISSIONS, type Activity, type Permission } from '../roles/permissions.js';
import { User } from '../users/user.schema.js';

export interface TokenPayload {
  sub: string;
  tid: string;
  sid: string;
  act?: Activity;
}

const PERMISSION_KEY = 'permission';
const ALLOW_NO_ACTIVITY_KEY = 'allowNoActivity';

/** The route needs this permission, and the session must be in the panel the permission belongs to. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
/** The route can be used straight after password check, before an Activity is chosen. */
export const AllowNoActivity = () => SetMetadata(ALLOW_NO_ACTIVITY_KEY, true);

export const SESSION_MESSAGES = {
  replaced: 'You were logged out because this user signed in elsewhere.',
  idle: 'Your session expired after inactivity. Please log in again.',
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Role.name) private readonly roles: Model<Role>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Please log in.');

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }
    // A token from one tenant is never accepted on another tenant's address.
    if (!req.tenant || String(req.tenant._id) !== payload.tid) throw new UnauthorizedException('Please log in.');

    const user = await this.users.findOne({ _id: payload.sub, tenantId: req.tenant._id }).select('+sessionId');
    if (!user || !user.active) throw new UnauthorizedException('Please log in.');
    if (user.sessionId !== payload.sid) throw new UnauthorizedException(SESSION_MESSAGES.replaced);

    const now = Date.now();
    if (!user.lastSeenAt || now - user.lastSeenAt.getTime() > authRules.idleMinutes * 60_000) {
      throw new UnauthorizedException(SESSION_MESSAGES.idle);
    }
    if (now - user.lastSeenAt.getTime() > 60_000) {
      await this.users.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date(now) } });
    }

    const role = await this.roles.findOne({ _id: user.roleId, tenantId: req.tenant._id });
    if (!role) throw new ForbiddenException('Your user has no role. Please contact your administrator.');
    req.auth = { user, role, activity: payload.act };

    const handlers = [ctx.getHandler(), ctx.getClass()];
    const allowNoActivity = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_ACTIVITY_KEY, handlers);
    if (!payload.act && !allowNoActivity) throw new ForbiddenException('Choose Operations or Master first.');
    if (user.mustChangePassword && !allowNoActivity) throw new ForbiddenException('Please change your password first.');

    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, handlers);
    if (permission) {
      const needed = (Object.keys(PERMISSIONS) as Activity[]).find((a) =>
        (PERMISSIONS[a] as readonly string[]).includes(permission),
      );
      if (payload.act !== needed) throw new ForbiddenException(`Open the ${needed} panel to do this.`);
      if (!role.permissions.includes(permission)) throw new ForbiddenException('You do not have access to this.');
    }
    return true;
  }
}
