import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SupportUser } from './support-api';

export type TenantStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type BillingState = 'trial' | 'paid' | 'overdue' | 'unpaid' | 'none';
export type PaymentMethod = 'bank' | 'upi' | 'card' | 'gateway' | 'cheque' | 'other';
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank', label: 'Bank transfer' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' },
  { value: 'gateway', label: 'Payment gateway' }, { value: 'cheque', label: 'Cheque' }, { value: 'other', label: 'Other' },
];

export interface ClientRow {
  subdomain: string;
  name: string;
  planCode: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
}

export interface Dashboard {
  today: string;
  byStatus: Partial<Record<TenantStatus, number>>;
  byBilling: Partial<Record<BillingState, number>>;
  waitingApproval: ClientRow[];
  overdue: ClientRow[];
  trialEndingSoon: ClientRow[];
}

export interface ClientSummary extends ClientRow {
  status: TenantStatus;
  contactName: string;
  contactEmail: string;
  billing: BillingState;
  createdAt: string | null;
  users: number;
  properties: number;
}

export interface Plan {
  code: string;
  name: string;
  currency: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxProperties: number;
  maxUsers: number;
  active: boolean;
  notes: string;
}

export interface ClientDomain {
  domain: string;
  verified: boolean;
  addedAt: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  txtName: string;
  txtValue: string | null;
  cnameTarget: string;
}

export interface ClientPayment {
  id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string;
  periodFrom: string;
  periodTo: string;
  planCode: string | null;
  recordedBy: string;
  note: string;
  recordedAt: string | null;
}

export interface LogEntry {
  at: string;
  by: string;
  action: string;
  detail: string;
  tenant?: string | null;
}

export interface ClientDetail extends ClientRow {
  status: TenantStatus;
  contactName: string;
  contactEmail: string;
  contactMobile: string;
  supportAccess: 'allowed' | 'ask';
  createdAt: string | null;
  plan: Plan | null;
  billing: BillingState;
  loginHost: string;
  usage: { users: number; properties: number };
  overLimit: { users: boolean; properties: boolean };
  domains: ClientDomain[];
  statusHistory: { from: string; to: string; at: string; by: string; reason: string }[];
  payments: ClientPayment[];
  log: LogEntry[];
}

export interface StaffMember extends SupportUser {
  lastSeenAt: string | null;
}

export const STATUS_LABELS: Record<TenantStatus, string> = { pending: 'Waiting for approval', active: 'Active', suspended: 'Suspended', rejected: 'Rejected' };
export const BILLING_LABELS: Record<BillingState, string> = { trial: 'On trial', paid: 'Paid', overdue: 'Overdue', unpaid: 'Not paid yet', none: '' };

/** The admin side of the Banquet.ai console. Uses the console's own cookie, like SupportApi. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  dashboard() { return this.get<Dashboard>('dashboard'); }
  log() { return this.get<LogEntry[]>('log'); }

  clients(filter: { q?: string; status?: string; billing?: string }) {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => !!v)) as Record<string, string>;
    return firstValueFrom(this.http.get<ClientSummary[]>('/api/admin/tenants', { params }));
  }

  client(sub: string) { return this.get<ClientDetail>(`tenants/${enc(sub)}`); }
  approve(sub: string, input: { planCode?: string; trialDays?: number }) { return this.post<ClientDetail>(`tenants/${enc(sub)}/approve`, input); }
  reject(sub: string, reason: string) { return this.post<ClientDetail>(`tenants/${enc(sub)}/reject`, { reason }); }
  suspend(sub: string, reason: string) { return this.post<ClientDetail>(`tenants/${enc(sub)}/suspend`, { reason }); }
  reactivate(sub: string, reason: string) { return this.post<ClientDetail>(`tenants/${enc(sub)}/reactivate`, { reason }); }
  setPlan(sub: string, input: { planCode: string; trialEndsAt: string | null }) { return this.put<ClientDetail>(`tenants/${enc(sub)}/plan`, input); }

  recordPayment(sub: string, input: { amount: number; currency?: string; method: PaymentMethod; reference?: string; periodFrom: string; periodTo: string; note?: string }) {
    return this.post<ClientDetail>(`tenants/${enc(sub)}/payments`, input);
  }

  addDomain(sub: string, domain: string) { return this.post<ClientDetail>(`tenants/${enc(sub)}/domains`, { domain }); }
  checkDomain(sub: string, domain: string) { return this.post<ClientDetail>(`tenants/${enc(sub)}/domains/${enc(domain)}/check`, {}); }
  removeDomain(sub: string, domain: string) { return firstValueFrom(this.http.delete<ClientDetail>(`/api/admin/tenants/${enc(sub)}/domains/${enc(domain)}`)); }

  plans() { return this.get<Plan[]>('plans'); }
  createPlan(input: Partial<Plan>) { return this.post<Plan>('plans', input); }
  updatePlan(code: string, input: Partial<Plan>) { return this.put<Plan>(`plans/${enc(code)}`, input); }

  staff() { return this.get<StaffMember[]>('staff'); }
  addStaff(input: { email: string; name: string; mobile?: string; role: SupportUser['role'] }) { return this.post<SupportUser>('staff', input); }
  updateStaff(id: string, input: Partial<Pick<SupportUser, 'name' | 'mobile' | 'role' | 'active'>>) { return this.put<StaffMember>(`staff/${enc(id)}`, input); }
  resetStaffPassword(id: string) { return this.post<StaffMember>(`staff/${enc(id)}/reset-password`, {}); }

  private get<T>(path: string) { return firstValueFrom(this.http.get<T>(`/api/admin/${path}`)); }
  private post<T>(path: string, body: object) { return firstValueFrom(this.http.post<T>(`/api/admin/${path}`, body)); }
  private put<T>(path: string, body: object) { return firstValueFrom(this.http.put<T>(`/api/admin/${path}`, body)); }
}

const enc = encodeURIComponent;
