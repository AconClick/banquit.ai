import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { authRules } from '../config.js';
import { checkPassword, generateOtp, generatePassword, hashPassword, passwordProblem, sha256 } from '../common/passwords.js';
import { Notifier } from '../notifications/notifier.js';
import { ACTIVITIES, ALL_PERMISSIONS, type Activity } from '../roles/permissions.js';
import { Tenant, TenantDocument } from '../tenants/tenant.schema.js';
import { SupportSession, SupportSessionDocument, SupportUser, SupportUserDocument } from './support.schema.js';

/** Token for the Banquet.ai admin console (no tenant). */
export interface ConsoleTokenPayload {
  typ: 'support-console' | 'support-otp';
  sub: string;
  sid?: string;
}

/** Token for a support session inside one tenant's app. */
export interface SupportSessionTokenPayload {
  typ: 'support-session';
  sub: string;
  tid: string;
  act: Activity;
}

const INVALID_LOGIN = 'Invalid email or password.';

export const supportUserView = (u: SupportUserDocument) => ({
  id: u.id as string, email: u.email, name: u.name, mobile: u.mobile, role: u.role, active: u.active, mustChangePassword: u.mustChangePassword,
});

export const supportSessionView = (s: SupportSessionDocument, tenant?: Pick<TenantDocument, 'subdomain' | 'name'> | null) => ({
  id: s.id as string,
  tenant: tenant ? { subdomain: tenant.subdomain, name: tenant.name } : undefined,
  supportName: s.supportName,
  reason: s.reason,
  ticket: s.ticket,
  emergency: s.emergency,
  status: isExpired(s) ? 'ended' : s.status,
  mode: s.mode,
  editReason: s.editReason,
  requestedAt: s.requestedAt,
  decidedBy: s.decidedBy ?? null,
  decidedAt: s.decidedAt ?? null,
  startedAt: s.startedAt ?? null,
  endsAt: s.endsAt ?? null,
  endedAt: s.endedAt ?? (isExpired(s) ? s.endsAt : null) ?? null,
  actions: s.actions.map((a) => ({ at: a.at, method: a.method, path: a.path })),
});

export const isExpired = (s: SupportSessionDocument) => s.status === 'active' && !!s.endsAt && s.endsAt <= new Date();

/** The stand-in user and role a support session acts as inside a tenant. Never stored. */
export function supportIdentity(s: SupportSessionDocument) {
  const user = {
    _id: undefined,
    id: `support:${s.id as string}`,
    userId: 'banquet.ai-support',
    firstName: 'Banquet.ai Support:',
    lastName: s.supportName,
    email: '',
    mobile: '',
    roleId: 'support',
    kind: 'support',
    active: true,
    mustChangePassword: false,
  };
  const role = { id: 'support', name: 'Banquet.ai Support', permissions: [...ALL_PERMISSIONS], builtIn: true };
  return { user, role };
}

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportUser.name) private readonly staff: Model<SupportUser>,
    @InjectModel(SupportSession.name) private readonly sessions: Model<SupportSession>,
    @InjectModel(Tenant.name) private readonly tenants: Model<Tenant>,
    private readonly jwt: JwtService,
    private readonly notifier: Notifier,
  ) {}

  // ---- Support staff accounts (created by the platform admin) ----

  async createStaff(input: { email: string; name: string; mobile?: string; role?: 'agent' | 'manager' }) {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Enter a valid email.');
    if (!input.name?.trim()) throw new BadRequestException('Name is required.');
    if (await this.staff.exists({ email })) throw new ConflictException('A support user with this email already exists.');
    const password = generatePassword();
    const user = await this.staff.create({
      email, name: input.name.trim(), mobile: (input.mobile ?? '').trim(), role: input.role === 'manager' ? 'manager' : 'agent',
      passwordHash: await hashPassword(password),
    });
    await this.notifier.send({
      channel: 'email', to: email, subject: 'Your Banquet.ai support login',
      body: `Your Banquet.ai support console login is ${email} with the temporary password ${password}. You will set your own password after the first login.`,
    });
    return supportUserView(user);
  }

  // ---- Console login: password, then OTP, always ----

  async login(email: string, password: string) {
    const user = await this.staff.findOne({ email: (email ?? '').trim().toLowerCase() }).select('+passwordHash');
    if (!user || !user.active) throw new UnauthorizedException(INVALID_LOGIN);
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException('Too many wrong passwords. Try again later.', HttpStatus.LOCKED);
    }
    if (!(await checkPassword(password ?? '', user.passwordHash))) {
      user.failedLogins += 1;
      if (user.failedLogins >= authRules.maxFailedLogins) {
        user.failedLogins = 0;
        user.lockedUntil = new Date(Date.now() + authRules.lockMinutes * 60_000);
      }
      await user.save();
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    user.failedLogins = 0;
    user.set('lockedUntil', undefined);
    const code = generateOtp(authRules.otpLength);
    user.otpHash = sha256(`${user.id}:${code}`);
    user.otpExpiresAt = new Date(Date.now() + authRules.otpValidMinutes * 60_000);
    user.otpAttempts = 0;
    await user.save();
    const body = `Your Banquet.ai support console code is ${code}. It is valid for ${authRules.otpValidMinutes} minutes.`;
    const sentTo = user.mobile
      ? (await this.notifier.send({ channel: 'sms', to: user.mobile, body }), 'mobile')
      : (await this.notifier.send({ channel: 'email', to: user.email, subject: 'Banquet.ai support code', body }), 'email');
    const otpToken = await this.jwt.signAsync({ typ: 'support-otp', sub: user.id as string } satisfies ConsoleTokenPayload, { expiresIn: `${authRules.otpValidMinutes}m` });
    return { otpToken, sentTo };
  }

  async verifyOtp(otpToken: string, code: string) {
    const payload = await this.jwt.verifyAsync<ConsoleTokenPayload>(otpToken ?? '').catch(() => null);
    if (payload?.typ !== 'support-otp') throw new UnauthorizedException('The code has expired. Please log in again.');
    const user = await this.staff.findById(payload.sub).select('+otpHash');
    if (!user?.active || !user.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new BadRequestException('The code has expired. Please log in again.');
    }
    if (user.otpAttempts >= authRules.otpMaxAttempts) throw new BadRequestException('Too many wrong codes. Please log in again.');
    if (sha256(`${user.id}:${String(code ?? '').trim()}`) !== user.otpHash) {
      user.otpAttempts += 1;
      await user.save();
      throw new BadRequestException('The code is wrong.');
    }
    user.set('otpHash', undefined);
    user.set('otpExpiresAt', undefined);
    user.sessionId = randomUUID();
    user.lastSeenAt = new Date();
    await user.save();
    return this.consoleSession(user);
  }

  /** Checks a console token and returns the support user. Used by the console guard. */
  async authenticate(token: string) {
    const payload = await this.jwt.verifyAsync<ConsoleTokenPayload>(token).catch(() => null);
    if (payload?.typ !== 'support-console') throw new UnauthorizedException('Please log in to the support console.');
    const user = await this.staff.findById(payload.sub).select('+sessionId');
    if (!user?.active) throw new UnauthorizedException('Please log in to the support console.');
    if (user.sessionId !== payload.sid) throw new UnauthorizedException('You were logged out because you signed in elsewhere.');
    const now = Date.now();
    if (!user.lastSeenAt || now - user.lastSeenAt.getTime() > authRules.idleMinutes * 60_000) {
      throw new UnauthorizedException('Your session expired after inactivity. Please log in again.');
    }
    if (now - user.lastSeenAt.getTime() > 60_000) await this.staff.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date(now) } });
    return user;
  }

  async changePassword(user: SupportUserDocument, currentPassword: string, newPassword: string) {
    const full = await this.staff.findById(user._id).select('+passwordHash +sessionId');
    if (!full || !(await checkPassword(currentPassword ?? '', full.passwordHash))) throw new BadRequestException('Current password is wrong.');
    const problem = passwordProblem(newPassword ?? '');
    if (problem) throw new BadRequestException(problem);
    if (await checkPassword(newPassword, full.passwordHash)) throw new BadRequestException('Choose a password you have not used before.');
    full.passwordHash = await hashPassword(newPassword);
    full.mustChangePassword = false;
    await full.save();
    return supportUserView(full);
  }

  async logout(user: SupportUserDocument) {
    await this.staff.updateOne({ _id: user._id }, { $unset: { sessionId: 1 } });
  }

  // ---- Entering a tenant ----

  async tenantList(q: string | undefined) {
    const filter: Record<string, unknown> = { status: 'active' };
    const text = (q ?? '').trim().toLowerCase();
    const list = await this.tenants.find(filter).sort({ subdomain: 1 }).limit(500);
    return list
      .filter((t) => !text || t.subdomain.includes(text) || t.name.toLowerCase().includes(text))
      .slice(0, 50)
      .map((t) => ({ subdomain: t.subdomain, name: t.name, supportAccess: t.supportAccess ?? 'allowed' }));
  }

  async request(user: SupportUserDocument, input: { subdomain: string; reason: string; ticket?: string; emergency?: boolean }) {
    this.mustHavePassword(user);
    const tenant = await this.tenants.findOne({ subdomain: (input.subdomain ?? '').trim().toLowerCase(), status: 'active' });
    if (!tenant) throw new NotFoundException('No active client with this domain.');
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10) throw new BadRequestException('Give a reason of at least 10 characters (what you need to check or fix).');
    if (input.emergency && user.role !== 'manager') throw new ForbiddenException('Only a support manager can use the emergency override.');
    const ask = tenant.supportAccess === 'ask' && !input.emergency;
    const now = new Date();
    const s = await this.sessions.create({
      tenantId: tenant._id, supportUserId: user._id, supportName: user.name, reason: reason.slice(0, 500),
      ticket: (input.ticket ?? '').trim().slice(0, 50), emergency: !!input.emergency && tenant.supportAccess === 'ask',
      status: ask ? 'pending' : 'active', requestedAt: now,
      ...(ask ? {} : { startedAt: now, endsAt: this.endsAt(now) }),
    });
    await this.tellClient(tenant, s, ask ? 'request' : s.emergency ? 'emergency' : 'start');
    return supportSessionView(s, tenant);
  }

  async mySessions(user: SupportUserDocument) {
    const list = await this.sessions.find({ supportUserId: user._id }).sort({ requestedAt: -1 }).limit(30);
    const tenants = await this.tenants.find({ _id: { $in: [...new Set(list.map((s) => String(s.tenantId)))] } });
    const byId = new Map(tenants.map((t) => [String(t._id), t]));
    return list.map((s) => supportSessionView(s, byId.get(String(s.tenantId))));
  }

  /** Opens the tenant's app in the session: a token for that tenant only, never stored as a user. */
  async enter(user: SupportUserDocument, id: string, activity: Activity) {
    this.mustHavePassword(user);
    if (!ACTIVITIES.includes(activity)) throw new BadRequestException('Choose Operations or Master.');
    const s = await this.own(user, id);
    if (s.status === 'pending') throw new ConflictException('The client has not approved this request yet.');
    if (s.status !== 'active' || isExpired(s)) throw new BadRequestException('This support session has ended. Start a new one with a reason.');
    const tenant = await this.tenants.findById(s.tenantId);
    if (!tenant || tenant.status !== 'active') throw new NotFoundException('This client is not active.');
    return { ...(await this.sessionToken(s, activity)), subdomain: tenant.subdomain };
  }

  async endFromConsole(user: SupportUserDocument, id: string) {
    const s = await this.own(user, id);
    return supportSessionView(await this.end(s));
  }

  // ---- Inside the tenant (support-session token) ----

  async sessionToken(s: SupportSessionDocument, activity: Activity) {
    const payload: SupportSessionTokenPayload = { typ: 'support-session', sub: s.id as string, tid: String(s.tenantId), act: activity };
    const { user } = supportIdentity(s);
    const seconds = Math.max(60, Math.floor(((s.endsAt?.getTime() ?? Date.now()) - Date.now()) / 1000));
    return {
      token: await this.jwt.signAsync(payload, { expiresIn: seconds }),
      user, activity, activities: [...ACTIVITIES], mustChangePassword: false,
      support: supportSessionView(s),
    };
  }

  async editMode(s: SupportSessionDocument, reason: string) {
    const text = (reason ?? '').trim();
    if (text.length < 10) throw new BadRequestException('Say what you are going to change (at least 10 characters).');
    s.mode = 'edit';
    s.editReason = text.slice(0, 500);
    s.actions.push({ at: new Date(), method: 'EDIT MODE', path: text.slice(0, 200) });
    await s.save();
    return supportSessionView(s);
  }

  async end(s: SupportSessionDocument) {
    if (s.status === 'active' || s.status === 'pending') {
      s.status = 'ended';
      s.endedAt = new Date();
      await s.save();
    }
    return s;
  }

  /** Records a change made in a support session (method and path; the request body is not kept). */
  async record(s: SupportSessionDocument, method: string, path: string) {
    await this.sessions.updateOne({ _id: s._id }, { $push: { actions: { at: new Date(), method, path: path.slice(0, 200) } } });
  }

  findSession(id: string, tenantId: Types.ObjectId) {
    return Types.ObjectId.isValid(id) ? this.sessions.findOne({ _id: id, tenantId }) : null;
  }

  // ---- Client side (Master panel) ----

  async accessLog(tenant: TenantDocument) {
    const list = await this.sessions.find({ tenantId: tenant._id }).sort({ requestedAt: -1 }).limit(100);
    return { supportAccess: tenant.supportAccess ?? 'allowed', sessions: list.map((s) => supportSessionView(s)) };
  }

  async setAccess(tenant: TenantDocument, value: 'allowed' | 'ask') {
    if (value !== 'allowed' && value !== 'ask') throw new BadRequestException('Choose Allowed or Ask each time.');
    await this.tenants.updateOne({ _id: tenant._id }, { $set: { supportAccess: value } });
    return this.accessLog(await this.tenants.findById(tenant._id) as TenantDocument);
  }

  async decide(tenant: TenantDocument, id: string, approve: boolean, by: string) {
    const s = await this.findSession(id, tenant._id);
    if (!s) throw new NotFoundException('Support request not found.');
    if (s.status !== 'pending') throw new ConflictException('This request has already been answered.');
    const now = new Date();
    s.status = approve ? 'active' : 'denied';
    s.decidedBy = by;
    s.decidedAt = now;
    if (approve) {
      s.startedAt = now;
      s.endsAt = this.endsAt(now);
    }
    await s.save();
    const staff = await this.staff.findById(s.supportUserId);
    if (staff) {
      await this.notifier.send({
        channel: 'email', to: staff.email, subject: `Support request ${approve ? 'approved' : 'declined'} by ${tenant.name}`,
        body: `${tenant.name} ${approve ? 'approved' : 'declined'} your support request ("${s.reason}").${approve ? ' You can enter from the support console for the next ' + authRules.supportSessionHours + ' hours.' : ''}`,
      });
    }
    return supportSessionView(s);
  }

  private endsAt(from: Date) {
    return new Date(from.getTime() + authRules.supportSessionHours * 3_600_000);
  }

  private mustHavePassword(user: SupportUserDocument) {
    if (user.mustChangePassword) throw new ForbiddenException('Please set your own password first.');
  }

  private async own(user: SupportUserDocument, id: string) {
    const s = Types.ObjectId.isValid(id) ? await this.sessions.findOne({ _id: id, supportUserId: user._id }) : null;
    if (!s) throw new NotFoundException('Support session not found.');
    return s;
  }

  private async consoleSession(user: SupportUserDocument) {
    const payload: ConsoleTokenPayload = { typ: 'support-console', sub: user.id as string, sid: user.sessionId };
    return { token: await this.jwt.signAsync(payload), user: supportUserView(user) };
  }

  /** The client's contact is emailed whenever support asks to enter or enters. */
  private async tellClient(tenant: TenantDocument, s: SupportSessionDocument, kind: 'request' | 'start' | 'emergency') {
    const who = `${s.supportName} from Banquet.ai support`;
    const why = `Reason: ${s.reason}${s.ticket ? ` (ticket ${s.ticket})` : ''}.`;
    const body = {
      request: `${who} asks to enter your Banquet.ai account. ${why} Approve or decline it in Master › Support Access.`,
      start: `${who} has entered your Banquet.ai account for up to ${authRules.supportSessionHours} hours. ${why} You can see what they do in Master › Support Access.`,
      emergency: `${who} entered your Banquet.ai account using the emergency override because approval could not be obtained. ${why} Every action is listed in Master › Support Access.`,
    }[kind];
    await this.notifier.send({ channel: 'email', to: tenant.contactEmail, subject: kind === 'request' ? 'Banquet.ai support asks to enter your account' : 'Banquet.ai support entered your account', body });
  }
}
