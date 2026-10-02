import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { MasterRecord } from '../masters/master-record.schema.js';
import { Notifier } from '../notifications/notifier.js';
import { ProvisioningService } from '../platform/provisioning.service.js';
import { todayIn } from '../reservations/local-time.js';
import { SupportService } from '../support/support.service.js';
import { Tenant, type TenantDocument, type TenantStatus } from '../tenants/tenant.schema.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { User } from '../users/user.schema.js';
import { AdminAction, PAYMENT_METHODS, Plan, PlatformPayment, type PaymentMethod, type PlanDocument } from './admin.schema.js';
import { DnsLookup, VERIFY_PREFIX } from './dns.js';

export type BillingState = 'trial' | 'paid' | 'overdue' | 'unpaid' | 'none';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Where an active client stands with Banquet.ai: on trial, paid up, overdue, or never paid. */
export function billingState(t: Pick<Tenant, 'status' | 'trialEndsAt' | 'paidUntil'>, today: string): BillingState {
  if (t.status !== 'active') return 'none';
  if (t.paidUntil && t.paidUntil >= today) return 'paid';
  if (t.trialEndsAt && t.trialEndsAt >= today) return 'trial';
  if (t.paidUntil || t.trialEndsAt) return 'overdue';
  return 'unpaid';
}

/** Adds days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const planView = (p: PlanDocument) => ({
  code: p.code, name: p.name, currency: p.currency, monthlyPrice: p.monthlyPrice, yearlyPrice: p.yearlyPrice,
  maxProperties: p.maxProperties, maxUsers: p.maxUsers, active: p.active, notes: p.notes,
});

export interface PlanInput {
  code?: string;
  name?: string;
  currency?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  maxProperties?: number;
  maxUsers?: number;
  active?: boolean;
  notes?: string;
}

export interface PaymentInput {
  amount: number;
  currency?: string;
  method: PaymentMethod;
  reference?: string;
  periodFrom: string;
  periodTo: string;
  note?: string;
}

/** Banquet.ai's own admin work on client accounts (the platform admin console). */
@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Tenant.name) private readonly tenants: Model<Tenant>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(MasterRecord.name) private readonly masters: Model<MasterRecord>,
    @InjectModel(Plan.name) private readonly plans: Model<Plan>,
    @InjectModel(PlatformPayment.name) private readonly payments: Model<PlatformPayment>,
    @InjectModel(AdminAction.name) private readonly actions: Model<AdminAction>,
    private readonly tenantsService: TenantsService,
    private readonly provisioning: ProvisioningService,
    private readonly support: SupportService,
    private readonly notifier: Notifier,
    private readonly dns: DnsLookup,
  ) {}

  private today() {
    return todayIn(undefined);
  }

  // ---- Overview ----

  async dashboard() {
    const today = this.today();
    const all = await this.tenants.find().select('subdomain name status planCode trialEndsAt paidUntil createdAt').lean();
    const byStatus: Record<string, number> = {};
    const byBilling: Record<string, number> = {};
    for (const t of all) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      const b = billingState(t, today);
      if (b !== 'none') byBilling[b] = (byBilling[b] ?? 0) + 1;
    }
    const row = (t: (typeof all)[number]) => ({ subdomain: t.subdomain, name: t.name, planCode: t.planCode ?? null, trialEndsAt: t.trialEndsAt ?? null, paidUntil: t.paidUntil ?? null });
    const soon = addDays(today, 7);
    return {
      today,
      byStatus,
      byBilling,
      waitingApproval: all.filter((t) => t.status === 'pending').map(row),
      overdue: all.filter((t) => billingState(t, today) === 'overdue').map(row),
      trialEndingSoon: all.filter((t) => billingState(t, today) === 'trial' && t.trialEndsAt! <= soon).map(row),
    };
  }

  async listTenants(filter: { q?: string; status?: string; billing?: string }) {
    const today = this.today();
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    const text = (filter.q ?? '').trim().toLowerCase();
    if (text) {
      const safe = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [{ subdomain: { $regex: safe } }, { name: { $regex: safe, $options: 'i' } }, { contactEmail: { $regex: safe } }];
    }
    const list = await this.tenants.find(query).sort({ createdAt: -1 }).limit(500).lean();
    const usage = await this.usage(list.map((t) => t._id));
    return list
      .map((t) => ({
        subdomain: t.subdomain, name: t.name, status: t.status, contactName: t.contactName, contactEmail: t.contactEmail,
        planCode: t.planCode ?? null, trialEndsAt: t.trialEndsAt ?? null, paidUntil: t.paidUntil ?? null,
        billing: billingState(t, today), createdAt: (t as { createdAt?: Date }).createdAt ?? null,
        ...(usage.get(String(t._id)) ?? { users: 0, properties: 0 }),
      }))
      .filter((t) => !filter.billing || t.billing === filter.billing);
  }

  async tenantDetail(subdomain: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    const today = this.today();
    const [usage, payments, plan, log] = await Promise.all([
      this.usage([t._id]),
      this.payments.find({ tenantId: t._id }).sort({ periodTo: -1, createdAt: -1 }).limit(100),
      t.planCode ? this.plans.findOne({ code: t.planCode }) : null,
      this.actions.find({ tenantId: t._id }).sort({ at: -1 }).limit(50),
    ]);
    const used = usage.get(String(t._id)) ?? { users: 0, properties: 0 };
    return {
      subdomain: t.subdomain, name: t.name, status: t.status,
      contactName: t.contactName, contactEmail: t.contactEmail, contactMobile: t.contactMobile,
      approval: t.approval ?? null, supportAccess: t.supportAccess ?? 'allowed',
      createdAt: (t as unknown as { createdAt?: Date }).createdAt ?? null,
      planCode: t.planCode ?? null, plan: plan ? planView(plan) : null, trialEndsAt: t.trialEndsAt ?? null, paidUntil: t.paidUntil ?? null,
      billing: billingState(t, today), loginHost: this.tenantsService.loginHost(t),
      usage: used,
      overLimit: {
        properties: !!plan?.maxProperties && used.properties > plan.maxProperties,
        users: !!plan?.maxUsers && used.users > plan.maxUsers,
      },
      domains: t.customDomains.map((d) => ({
        domain: d.domain, verified: d.verified, addedAt: d.addedAt ?? null, verifiedAt: d.verifiedAt ?? null,
        lastCheckedAt: d.lastCheckedAt ?? null, lastCheckError: d.lastCheckError ?? null,
        // Set before the TXT check; shown so the admin can tell the client what to add.
        txtName: `${VERIFY_PREFIX}.${d.domain}`, txtValue: d.verifyToken ? `banquet-verify=${d.verifyToken}` : null,
        cnameTarget: `${t.subdomain}.${config.baseDomain}`,
      })),
      statusHistory: t.statusHistory.map((h) => ({ from: h.from, to: h.to, at: h.at, by: h.by, reason: h.reason })),
      payments: payments.map((p) => ({
        id: p.id as string, amount: p.amount, currency: p.currency, method: p.method, reference: p.reference,
        periodFrom: p.periodFrom, periodTo: p.periodTo, planCode: p.planCode ?? null, recordedBy: p.recordedBy, note: p.note,
        recordedAt: (p as unknown as { createdAt?: Date }).createdAt ?? null,
      })),
      log: log.map((a) => ({ at: a.at, by: a.by, action: a.action, detail: a.detail })),
    };
  }

  /** Active users and active properties per client, for the plan limits. */
  private async usage(ids: Types.ObjectId[]) {
    const out = new Map<string, { users: number; properties: number }>();
    if (!ids.length) return out;
    const [users, properties] = await Promise.all([
      this.users.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { tenantId: { $in: ids }, active: true } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      this.masters.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { tenantId: { $in: ids }, kind: 'property', active: true } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
    ]);
    for (const id of ids) out.set(String(id), { users: 0, properties: 0 });
    for (const u of users) out.get(String(u._id))!.users = u.n;
    for (const p of properties) out.get(String(p._id))!.properties = p.n;
    return out;
  }

  // ---- Account status ----

  async approve(by: string, subdomain: string, input: { planCode?: string; trialDays?: number }) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    if (t.status !== 'pending') throw new ConflictException(`This account is already ${t.status}.`);
    if (input.planCode) await this.activePlan(input.planCode);
    const trialDays = input.trialDays ?? 0;
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) throw new BadRequestException('Trial days must be a whole number from 0 to 365.');
    await this.provisioning.approve(t, 'manual', by);
    const set: Record<string, unknown> = {};
    if (input.planCode) set.planCode = input.planCode.toUpperCase();
    if (trialDays) set.trialEndsAt = addDays(this.today(), trialDays - 1);
    if (Object.keys(set).length) await this.tenants.updateOne({ _id: t._id }, { $set: set });
    await this.log(by, t._id, 'Approved', [input.planCode && `plan ${input.planCode.toUpperCase()}`, trialDays && `${trialDays}-day trial`].filter(Boolean).join(', '));
    return this.tenantDetail(subdomain);
  }

  async reject(by: string, subdomain: string, reason: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    await this.changeStatus(t, ['pending'], 'rejected', by, reason);
    await this.notifier.send({
      channel: 'email', to: t.contactEmail, subject: 'Your Banquet.ai sign-up',
      body: `We could not approve the Banquet.ai account "${t.subdomain}" for ${t.name}. Reason: ${reason.trim()}. Reply to this email if you have questions.`,
    });
    return this.tenantDetail(subdomain);
  }

  /**
   * Suspends a client: nobody can log in, everyone logged in is signed out, and any Banquet.ai support
   * session in the account ends. Their data is kept and comes back on reactivation.
   */
  async suspend(by: string, subdomain: string, reason: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    await this.changeStatus(t, ['active'], 'suspended', by, reason);
    await this.users.updateMany({ tenantId: t._id }, { $unset: { sessionId: 1 } });
    await this.support.endSessionsFor(t._id);
    await this.notifier.send({
      channel: 'email', to: t.contactEmail, subject: 'Your Banquet.ai account is suspended',
      body: `The Banquet.ai account for ${t.name} (${t.subdomain}) is suspended. Reason: ${reason.trim()}. Your data is kept. Contact Banquet.ai to reactivate it.`,
    });
    return this.tenantDetail(subdomain);
  }

  async reactivate(by: string, subdomain: string, reason: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    await this.changeStatus(t, ['suspended'], 'active', by, reason);
    await this.notifier.send({
      channel: 'email', to: t.contactEmail, subject: 'Your Banquet.ai account is active again',
      body: `The Banquet.ai account for ${t.name} is active again. Log in at ${this.tenantsService.loginUrl(t)}.`,
    });
    return this.tenantDetail(subdomain);
  }

  /** Changes status only if it is still one of `from` (so two admins cannot both act on stale screens). */
  private async changeStatus(t: TenantDocument, from: TenantStatus[], to: TenantStatus, by: string, reason: string) {
    const why = (reason ?? '').trim();
    if (why.length < 5) throw new BadRequestException('Give a reason (at least 5 characters). The client sees it.');
    const done = await this.tenants.updateOne(
      { _id: t._id, status: { $in: from } },
      { $set: { status: to }, $push: { statusHistory: { from: t.status, to, at: new Date(), by, reason: why.slice(0, 500) } } },
    );
    if (!done.modifiedCount) throw new ConflictException(`This account is ${t.status}, so it cannot be ${to === 'active' ? 'reactivated' : to}.`);
    await this.log(by, t._id, { rejected: 'Rejected', suspended: 'Suspended', active: 'Reactivated' }[to as string] ?? to, why);
  }

  // ---- Plans and payments ----

  async listPlans() {
    return (await this.plans.find().sort({ active: -1, monthlyPrice: 1, code: 1 })).map(planView);
  }

  async createPlan(by: string, input: PlanInput) {
    const code = (input.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new BadRequestException('Plan code must be 2 to 20 letters, digits, - or _.');
    if (await this.plans.exists({ code })) throw new ConflictException('A plan with this code already exists.');
    const plan = new this.plans({ code });
    this.applyPlan(plan, input, true);
    await plan.save();
    await this.log(by, undefined, 'Plan created', code);
    return planView(plan);
  }

  async updatePlan(by: string, code: string, input: PlanInput) {
    const plan = await this.plans.findOne({ code: (code ?? '').toUpperCase() });
    if (!plan) throw new NotFoundException('Plan not found.');
    this.applyPlan(plan, input, false);
    await plan.save();
    await this.log(by, undefined, 'Plan changed', plan.code);
    return planView(plan);
  }

  private applyPlan(plan: PlanDocument, input: PlanInput, isNew: boolean) {
    if (input.name !== undefined || isNew) {
      if (!input.name?.trim()) throw new BadRequestException('Plan name is required.');
      plan.name = input.name.trim();
    }
    if (input.currency !== undefined) {
      if (!/^[A-Za-z]{3}$/.test(input.currency)) throw new BadRequestException('Currency must be a 3-letter code such as INR or USD.');
      plan.currency = input.currency.toUpperCase();
    }
    for (const key of ['monthlyPrice', 'yearlyPrice', 'maxProperties', 'maxUsers'] as const) {
      const v = input[key];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new BadRequestException('Prices and limits cannot be negative.');
      if (key.startsWith('max') && !Number.isInteger(v)) throw new BadRequestException('Limits must be whole numbers (0 means no limit).');
      plan[key] = key.startsWith('max') ? v : Math.round(v * 100) / 100;
    }
    if (input.active !== undefined) plan.active = input.active;
    if (input.notes !== undefined) plan.notes = input.notes.trim().slice(0, 500);
  }

  private async activePlan(code: string) {
    const plan = await this.plans.findOne({ code: code.toUpperCase() });
    if (!plan) throw new BadRequestException('Plan not found.');
    if (!plan.active) throw new BadRequestException('This plan is no longer offered.');
    return plan;
  }

  async setPlan(by: string, subdomain: string, input: { planCode: string; trialEndsAt?: string | null }) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    const plan = await this.activePlan(input.planCode);
    const set: Record<string, unknown> = { planCode: plan.code };
    const unset: Record<string, 1> = {};
    if (input.trialEndsAt !== undefined) {
      if (input.trialEndsAt === null || input.trialEndsAt === '') unset.trialEndsAt = 1;
      else if (!DATE.test(input.trialEndsAt)) throw new BadRequestException('Trial end must be a date.');
      else set.trialEndsAt = input.trialEndsAt;
    }
    await this.tenants.updateOne({ _id: t._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    await this.log(by, t._id, 'Plan set', `${plan.code}${set.trialEndsAt ? `, trial to ${set.trialEndsAt as string}` : unset.trialEndsAt ? ', trial removed' : ''}`);
    return this.tenantDetail(subdomain);
  }

  /** Records a subscription payment and moves "paid until" forward to the end of the period it covers. */
  async recordPayment(by: string, subdomain: string, input: PaymentInput) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    if (!(typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0)) throw new BadRequestException('Enter the amount received.');
    if (!PAYMENT_METHODS.includes(input.method)) throw new BadRequestException('Choose how it was paid.');
    if (!DATE.test(input.periodFrom ?? '') || !DATE.test(input.periodTo ?? '')) throw new BadRequestException('Enter the period this payment covers.');
    if (input.periodTo < input.periodFrom) throw new BadRequestException('The period ends before it starts.');
    const plan = t.planCode ? await this.plans.findOne({ code: t.planCode }) : null;
    const currency = (input.currency ?? plan?.currency ?? 'INR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Currency must be a 3-letter code such as INR or USD.');
    const p = await this.payments.create({
      tenantId: t._id, amount: Math.round(input.amount * 100) / 100, currency, method: input.method,
      reference: (input.reference ?? '').trim().slice(0, 100), periodFrom: input.periodFrom, periodTo: input.periodTo,
      planCode: t.planCode, recordedBy: by, note: (input.note ?? '').trim().slice(0, 500),
    });
    // Only ever moves forward, also when two payments are recorded at once.
    await this.tenants.updateOne(
      { _id: t._id, $or: [{ paidUntil: { $exists: false } }, { paidUntil: null }, { paidUntil: { $lt: input.periodTo } }] },
      { $set: { paidUntil: input.periodTo } },
    );
    await this.log(by, t._id, 'Payment recorded', `${currency} ${p.amount} by ${p.method}${p.reference ? ` (${p.reference})` : ''}, ${p.periodFrom} to ${p.periodTo}`);
    return this.tenantDetail(subdomain);
  }

  // ---- Custom domains ----

  /** Adds a client's own domain, unverified, with the TXT value that proves they own it. */
  async addDomain(by: string, subdomain: string, domain: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    const clean = (domain ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!DOMAIN.test(clean)) throw new BadRequestException('Enter a domain such as bookings.hotelprime.com.');
    if (clean === config.baseDomain || clean.endsWith(`.${config.baseDomain}`)) throw new BadRequestException(`Addresses under ${config.baseDomain} are given automatically.`);
    if (await this.tenants.exists({ 'customDomains.domain': clean })) throw new ConflictException('This domain is already used by a client.');
    const entry = { domain: clean, verified: false, verifyToken: randomBytes(16).toString('hex'), addedAt: new Date() };
    try {
      await this.tenants.updateOne({ _id: t._id }, { $push: { customDomains: entry } });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException('This domain is already used by a client.');
      throw err;
    }
    await this.log(by, t._id, 'Domain added', clean);
    return this.tenantDetail(subdomain);
  }

  /** Checks the TXT record; marks the domain verified when the value matches. */
  async checkDomain(by: string, subdomain: string, domain: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    const d = t.customDomains.find((x) => x.domain === (domain ?? '').toLowerCase());
    if (!d) throw new NotFoundException('This domain is not on the account.');
    if (d.verified) return this.tenantDetail(subdomain);
    const name = `${VERIFY_PREFIX}.${d.domain}`;
    const expected = `banquet-verify=${d.verifyToken}`;
    let error: string | null = null;
    try {
      const values = await this.dns.txt(name);
      if (!values.includes(expected)) error = values.length ? `The TXT record at ${name} has a different value.` : `No TXT record found at ${name}.`;
    } catch (err) {
      const code = (err as { code?: string }).code;
      error = code === 'ENOTFOUND' || code === 'ENODATA' ? `No TXT record found at ${name}. DNS changes can take up to a few hours.` : `DNS lookup failed (${code ?? 'error'}). Try again shortly.`;
    }
    const now = new Date();
    await this.tenants.updateOne(
      { _id: t._id, 'customDomains.domain': d.domain },
      error
        ? { $set: { 'customDomains.$.lastCheckedAt': now, 'customDomains.$.lastCheckError': error } }
        : { $set: { 'customDomains.$.verified': true, 'customDomains.$.verifiedAt': now, 'customDomains.$.lastCheckedAt': now }, $unset: { 'customDomains.$.lastCheckError': 1 } },
    );
    if (!error) await this.log(by, t._id, 'Domain verified', d.domain);
    return this.tenantDetail(subdomain);
  }

  async removeDomain(by: string, subdomain: string, domain: string) {
    const t = await this.tenantsService.getBySubdomain(subdomain);
    const clean = (domain ?? '').toLowerCase();
    const done = await this.tenants.updateOne({ _id: t._id }, { $pull: { customDomains: { domain: clean } } });
    if (!done.modifiedCount) throw new NotFoundException('This domain is not on the account.');
    await this.log(by, t._id, 'Domain removed', clean);
    return this.tenantDetail(subdomain);
  }

  // ---- Log ----

  async log(by: string, tenantId: Types.ObjectId | undefined, action: string, detail = '') {
    await this.actions.create({ by, tenantId, action, detail: detail.slice(0, 500) });
  }

  async recentActions() {
    const list = await this.actions.find().sort({ at: -1 }).limit(100);
    const tenants = await this.tenants.find({ _id: { $in: list.map((a) => a.tenantId).filter(Boolean) } }).select('subdomain name');
    const byId = new Map(tenants.map((t) => [String(t._id), t]));
    return list.map((a) => ({ at: a.at, by: a.by, action: a.action, detail: a.detail, tenant: a.tenantId ? (byId.get(String(a.tenantId))?.subdomain ?? null) : null }));
  }
}
