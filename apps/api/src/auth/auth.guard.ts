import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { authRules } from '../config.js';
import type { AppRequest } from '../common/request-context.js';
import { Role } from '../roles/role.schema.js';
import { PERMISSIONS, type Activity, type Permission } from '../roles/permissions.js';
import { SupportSession, SupportUser } from '../support/support.schema.js';
import { isExpired, supportIdentity, type SupportSessionTokenPayload } from '../support/support.service.js';
import { User, type UserDocument } from '../users/user.schema.js';
import type { RoleDocument } from '../roles/role.schema.js';
import { CSRF_HEADER, requestToken } from './session-cookie.js';

export interface TokenPayload {
  sub: string;
  tid: string;
  sid: string;
  act?: Activity;
}

const PERMISSION_KEY = 'permission';
const ALLOW_NO_ACTIVITY_KEY = 'allowNoActivity';
const NOT_FOR_SUPPORT_KEY = 'notForSupport';
const SUPPORT_READ_OK_KEY = 'supportReadOk';

/** The route needs this permission, and the session must be in the panel the permission belongs to. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
/** The route can be used straight after password check, before an Activity is chosen. */
export const AllowNoActivity = () => SetMetadata(ALLOW_NO_ACTIVITY_KEY, true);
/** A Banquet.ai support session may not use this route (it acts on a real user's own account). */
export const NotForSupport = () => SetMetadata(NOT_FOR_SUPPORT_KEY, true);
/** A read-only support session may still call this route (e.g. to switch mode or leave). */
export const SupportReadOk = () => SetMetadata(SUPPORT_READ_OK_KEY, true);

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

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
    @InjectModel(SupportSession.name) private readonly supportSessions: Model<SupportSession>,
    @InjectModel(SupportUser.name) private readonly supportStaff: Model<SupportUser>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const given = requestToken(req);
    if (!given) throw new UnauthorizedException('Please log in.');
    // A browser sends the cookie on any request to this host, including a form posted from another
    // site. Such a form cannot add a custom header, so changes made by cookie must carry this one.
    if (given.from === 'cookie' && !SAFE_METHODS.includes(req.method) && req.header(CSRF_HEADER) !== '1') {
      throw new ForbiddenException('Request blocked. Please reload the page.');
    }
    const token = given.token;

    let payload: TokenPayload | SupportSessionTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload | SupportSessionTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }
    // A token from one tenant is never accepted on another tenant's address.
    if (!req.tenant || String(req.tenant._id) !== payload.tid) throw new UnauthorizedException('Please log in.');
    if ('typ' in payload) {
      if (payload.typ !== 'support-session') throw new UnauthorizedException('Please log in.');
      return this.supportSession(ctx, req, payload);
    }

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

    this.checkPermission(ctx, payload.act, role.permissions);
    return true;
  }

  /**
   * Banquet.ai support inside a tenant (login-and-tenancy.md section 6): the session must be
   * live, is read-only until switched to edit mode, and every change is recorded against it.
   */
  private async supportSession(ctx: ExecutionContext, req: AppRequest, payload: SupportSessionTokenPayload) {
    const s = await this.supportSessions.findOne({ _id: payload.sub, tenantId: req.tenant!._id });
    if (!s || s.status !== 'active' || isExpired(s)) {
      throw new UnauthorizedException('The Banquet.ai support session has ended.');
    }
    // It also ends when the support staff member is disabled or logs out of the support console.
    const staff = await this.supportStaff.findOne({ _id: s.supportUserId }).select('+sessionId');
    if (!staff?.active || !staff.sessionId) throw new UnauthorizedException('The Banquet.ai support session has ended.');
    const handlers = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NOT_FOR_SUPPORT_KEY, handlers)) {
      throw new ForbiddenException('Not available in a Banquet.ai support session.');
    }
    const { user, role } = supportIdentity(s);
    req.auth = { user: user as unknown as UserDocument, role: role as unknown as RoleDocument, activity: payload.act, support: s };
    this.checkPermission(ctx, payload.act, role.permissions);

    const changes = !SAFE_METHODS.includes(req.method);
    if (changes && !this.reflector.getAllAndOverride<boolean>(SUPPORT_READ_OK_KEY, handlers)) {
      if (s.mode !== 'edit') {
        throw new ForbiddenException('This support session is read-only. Switch to edit mode and say what you will change first.');
      }
      await this.supportSessions.updateOne(
        { _id: s._id },
        { $push: { actions: { at: new Date(), method: req.method, path: req.originalUrl.split('?')[0].slice(0, 200) } } },
      );
    }
    return true;
  }

  private checkPermission(ctx: ExecutionContext, act: Activity | undefined, permissions: readonly string[]) {
    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!permission) return;
    const needed = (Object.keys(PERMISSIONS) as Activity[]).find((a) => (PERMISSIONS[a] as readonly string[]).includes(permission));
    if (act !== needed) throw new ForbiddenException(`Open the ${needed} panel to do this.`);
    if (!permissions.includes(permission)) throw new ForbiddenException('You do not have access to this.');
  }
}
