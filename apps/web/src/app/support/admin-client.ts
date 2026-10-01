import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.interceptor';
import { AdminApi, BILLING_LABELS, ClientDetail, PAYMENT_METHODS, PaymentMethod, Plan, STATUS_LABELS } from './admin-api';

type StatusAction = 'reject' | 'suspend' | 'reactivate';

/** One client account: approve or suspend it, set its plan, record payments and verify its own domains. */
@Component({
  selector: 'app-admin-client',
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe],
  template: `
    <p><a routerLink="/support/admin/clients">‹ All clients</a></p>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (notice(); as n) { <p class="alert ok" role="status">{{ n }}</p> }
    @if (c(); as c) {
      <div class="page-head">
        <h1>{{ c.name }} <span class="pill" [class.warn]="c.status !== 'active'">{{ statusLabels[c.status] }}</span></h1>
      </div>

      <div class="cols">
        <section class="card">
          <h2>Account</h2>
          <dl>
            <dt>Address</dt><dd>{{ c.loginHost }}</dd>
            <dt>Contact</dt><dd>{{ c.contactName }}<br />{{ c.contactEmail }}@if (c.contactMobile) { <br />{{ c.contactMobile }} }</dd>
            <dt>Signed up</dt><dd>{{ c.createdAt | date: 'd MMM y' }}</dd>
            <dt>Support access</dt><dd>{{ c.supportAccess === 'ask' ? 'Asks each time' : 'Allowed' }}</dd>
            <dt>Usage</dt>
            <dd>
              <span [class.over]="c.overLimit.properties">{{ c.usage.properties }}@if (c.plan?.maxProperties) { of {{ c.plan!.maxProperties }} } properties</span>,
              <span [class.over]="c.overLimit.users">{{ c.usage.users }}@if (c.plan?.maxUsers) { of {{ c.plan!.maxUsers }} } users</span>
              @if (c.overLimit.properties || c.overLimit.users) { <br /><small class="over">Over the plan's limit.</small> }
            </dd>
          </dl>

          @if (c.status === 'pending') {
            <h3>Approve</h3>
            <form class="row" (ngSubmit)="approve()">
              <label>Plan
                <select name="approvePlan" [(ngModel)]="approvePlan">
                  <option value="">Choose later</option>
                  @for (p of activePlans(); track p.code) { <option [value]="p.code">{{ p.name }} ({{ p.code }})</option> }
                </select>
              </label>
              <label>Free trial (days) <input name="trialDays" type="number" min="0" max="365" [(ngModel)]="trialDays" /></label>
              <div class="actions"><button class="primary" [disabled]="busy()">Approve and send login</button></div>
            </form>
          }

          <div class="status-actions">
            @if (c.status === 'pending') { <button (click)="startAction('reject')" [disabled]="busy()">Reject…</button> }
            @if (c.status === 'active') { <button (click)="startAction('suspend')" [disabled]="busy()">Suspend…</button> }
            @if (c.status === 'suspended') { <button class="primary" (click)="startAction('reactivate')" [disabled]="busy()">Reactivate…</button> }
          </div>
          @if (action(); as a) {
            <form class="reason" (ngSubmit)="confirmAction()">
              <p class="muted">{{ actionHelp[a] }}</p>
              <label>Reason (the client sees it) <input name="reason" [(ngModel)]="reason" required minlength="5" maxlength="500" autofocus /></label>
              <div class="actions">
                <button type="button" class="link" (click)="action.set(null)">Cancel</button>
                <button class="primary" [disabled]="busy() || reason.trim().length < 5">{{ actionLabel[a] }}</button>
              </div>
            </form>
          }
        </section>

        <section class="card">
          <h2>Plan and billing</h2>
          <p>
            <strong>{{ c.plan?.name ?? 'No plan yet' }}</strong>@if (c.plan) { <small class="muted"> {{ c.plan.currency }} {{ c.plan.monthlyPrice | number: '1.0-2' }}/month, {{ c.plan.yearlyPrice | number: '1.0-2' }}/year</small> }
            <br />
            @if (c.billing !== 'none') { <span class="pill" [class.warn]="c.billing === 'overdue' || c.billing === 'unpaid'">{{ billingLabels[c.billing] }}</span> }
            @if (c.paidUntil) { <small class="muted"> Paid until {{ c.paidUntil }}.</small> }
            @if (c.trialEndsAt) { <small class="muted"> Trial until {{ c.trialEndsAt }}.</small> }
          </p>
          <form class="row" (ngSubmit)="savePlan()">
            <label>Plan
              <select name="planCode" [(ngModel)]="planCode" required>
                <option value="" disabled>Choose</option>
                @for (p of activePlans(); track p.code) { <option [value]="p.code">{{ p.name }} ({{ p.code }})</option> }
              </select>
            </label>
            <label>Trial ends <input name="trialEndsAt" type="date" [(ngModel)]="trialEndsAt" /></label>
            <div class="actions"><button [disabled]="busy() || !planCode">Save plan</button></div>
          </form>

          <h3>Record a payment</h3>
          <form (ngSubmit)="recordPayment()">
            <div class="row">
              <label>Amount <input name="amount" type="number" min="0.01" step="0.01" [(ngModel)]="pay.amount" required /></label>
              <label>Currency <input name="currency" [(ngModel)]="pay.currency" maxlength="3" size="4" [placeholder]="c.plan?.currency ?? 'INR'" /></label>
              <label>Paid by
                <select name="method" [(ngModel)]="pay.method">
                  @for (m of methods; track m.value) { <option [value]="m.value">{{ m.label }}</option> }
                </select>
              </label>
            </div>
            <div class="row">
              <label>Covers from <input name="periodFrom" type="date" [(ngModel)]="pay.periodFrom" required /></label>
              <label>to <input name="periodTo" type="date" [(ngModel)]="pay.periodTo" required /></label>
              <label>Reference <input name="reference" [(ngModel)]="pay.reference" maxlength="100" placeholder="UTR, cheque no." /></label>
            </div>
            <label>Note <input name="note" [(ngModel)]="pay.note" maxlength="500" /></label>
            <div class="actions"><button [disabled]="busy() || !pay.amount || !pay.periodFrom || !pay.periodTo">Record payment</button></div>
          </form>
        </section>
      </div>

      <section class="card block">
        <h2>Own domains</h2>
        <p class="muted">The client's own address, such as bookings.theirhotel.com. Their IT adds two DNS records; press Check once they have.</p>
        @for (d of c.domains; track d.domain) {
          <div class="domain">
            <div class="domain-head">
              <strong>{{ d.domain }}</strong>
              @if (d.verified) { <span class="pill ok">Verified {{ d.verifiedAt | date: 'd MMM y' }}</span> } @else { <span class="pill warn">Not verified</span> }
              <span class="spacer"></span>
              @if (!d.verified) { <button (click)="checkDomain(d.domain)" [disabled]="busy()">Check</button> }
              <button class="link" (click)="removeDomain(d.domain)" [disabled]="busy()">Remove</button>
            </div>
            @if (!d.verified) {
              <table class="grid dns">
                <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                <tbody>
                  <tr><td>TXT</td><td><code>{{ d.txtName }}</code></td><td><code>{{ d.txtValue }}</code></td></tr>
                  <tr><td>CNAME</td><td><code>{{ d.domain }}</code></td><td><code>{{ d.cnameTarget }}</code></td></tr>
                </tbody>
              </table>
              @if (d.lastCheckError) { <p class="alert error">{{ d.lastCheckError }} <small>(checked {{ d.lastCheckedAt | date: 'd MMM, h:mm a' }})</small></p> }
            }
          </div>
        } @empty { <p class="muted">None yet.</p> }
        <form class="row add-domain" (ngSubmit)="addDomain()">
          <input name="domain" [(ngModel)]="newDomain" placeholder="bookings.theirhotel.com" aria-label="New domain" />
          <button [disabled]="busy() || !newDomain.trim()">Add domain</button>
        </form>
      </section>

      <section class="card block">
        <h2>Payments</h2>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>Covers</th><th class="right">Amount</th><th>Paid by</th><th>Reference</th><th>Plan</th><th>Recorded</th></tr></thead>
            <tbody>
              @for (p of c.payments; track p.id) {
                <tr>
                  <td class="nowrap">{{ p.periodFrom }} to {{ p.periodTo }}</td>
                  <td class="right nowrap">{{ p.currency }} {{ p.amount | number: '1.2-2' }}</td>
                  <td>{{ methodLabel(p.method) }}</td>
                  <td>{{ p.reference }}@if (p.note) { <br /><small class="muted">{{ p.note }}</small> }</td>
                  <td>{{ p.planCode ?? '' }}</td>
                  <td>{{ p.recordedBy }}<br /><small class="muted">{{ p.recordedAt | date: 'd MMM y' }}</small></td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted">No payments recorded.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card block">
        <h2>History</h2>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>
              @for (a of c.log; track $index) {
                <tr><td class="nowrap">{{ a.at | date: 'd MMM y, h:mm a' }}</td><td>{{ a.by }}</td><td>{{ a.action }}</td><td>{{ a.detail }}</td></tr>
              } @empty { <tr><td colspan="4" class="muted">Nothing yet.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    .row > .actions { align-self: flex-end; margin-bottom: 0.9rem; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; }
    .block { margin-top: 1rem; }
    h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }
    h3 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .over { color: var(--danger); }
    .status-actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
    .reason { margin-top: 0.75rem; }
    .domain { border-top: 1px solid var(--border); padding: 0.75rem 0; }
    .domain-head { display: flex; align-items: center; gap: 0.6rem; }
    .spacer { flex: 1; }
    .dns { margin-top: 0.5rem; }
    .dns code { word-break: break-all; }
    .pill.ok { color: var(--ok); background: var(--ok-bg); }
    .add-domain input { flex: 1 1 260px; }
  `,
})
export class AdminClient implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly c = signal<ClientDetail | null>(null);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly activePlans = computed(() => this.plans().filter((p) => p.active));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly action = signal<StatusAction | null>(null);
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly billingLabels = BILLING_LABELS;
  protected readonly methods = PAYMENT_METHODS;
  protected readonly actionLabel: Record<StatusAction, string> = { reject: 'Reject sign-up', suspend: 'Suspend account', reactivate: 'Reactivate account' };
  protected readonly actionHelp: Record<StatusAction, string> = {
    reject: 'The client is emailed that the sign-up was not approved.',
    suspend: 'Nobody can log in, everyone is signed out and any support session ends. Their data is kept.',
    reactivate: 'Their users can log in again. The client is emailed.',
  };

  private sub = '';
  protected approvePlan = '';
  protected trialDays = 14;
  protected planCode = '';
  protected trialEndsAt = '';
  protected reason = '';
  protected newDomain = '';
  protected pay = this.blankPayment();

  async ngOnInit() {
    this.sub = this.route.snapshot.paramMap.get('subdomain') ?? '';
    try {
      const [c, plans] = await Promise.all([this.api.client(this.sub), this.api.plans()]);
      this.plans.set(plans);
      this.show(c);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private show(c: ClientDetail) {
    this.c.set(c);
    this.planCode = c.planCode ?? '';
    this.trialEndsAt = c.trialEndsAt ?? '';
  }

  private blankPayment() {
    return { amount: null as number | null, currency: '', method: 'bank' as PaymentMethod, reference: '', periodFrom: '', periodTo: '', note: '' };
  }

  private run(work: () => Promise<ClientDetail>, done: string) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    work()
      .then((c) => {
        this.show(c);
        this.notice.set(done);
      })
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  protected methodLabel(m: PaymentMethod) {
    return PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;
  }

  protected approve() {
    this.run(() => this.api.approve(this.sub, { planCode: this.approvePlan || undefined, trialDays: Number(this.trialDays) || 0 }), 'Approved. The client has been emailed their login.');
  }

  protected startAction(a: StatusAction) {
    this.reason = '';
    this.action.set(a);
  }

  protected confirmAction() {
    const a = this.action();
    if (!a) return;
    const done = { reject: 'Sign-up rejected. The client has been emailed.', suspend: 'Account suspended. Everyone has been signed out.', reactivate: 'Account active again.' }[a];
    this.run(async () => {
      const c = await this.api[a](this.sub, this.reason.trim());
      this.action.set(null);
      return c;
    }, done);
  }

  protected savePlan() {
    this.run(() => this.api.setPlan(this.sub, { planCode: this.planCode, trialEndsAt: this.trialEndsAt || null }), 'Plan saved.');
  }

  protected recordPayment() {
    const p = this.pay;
    this.run(async () => {
      const c = await this.api.recordPayment(this.sub, {
        amount: Number(p.amount), currency: p.currency.trim() || undefined, method: p.method,
        reference: p.reference, periodFrom: p.periodFrom, periodTo: p.periodTo, note: p.note,
      });
      this.pay = this.blankPayment();
      return c;
    }, 'Payment recorded.');
  }

  protected addDomain() {
    this.run(async () => {
      const c = await this.api.addDomain(this.sub, this.newDomain.trim());
      this.newDomain = '';
      return c;
    }, 'Domain added. Send the client the two DNS records below.');
  }

  protected checkDomain(domain: string) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.api.checkDomain(this.sub, domain)
      .then((c) => {
        this.show(c);
        const d = c.domains.find((x) => x.domain === domain);
        if (d?.verified) this.notice.set(`${domain} is verified.`);
      })
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  protected removeDomain(domain: string) {
    if (!confirm(`Remove ${domain} from this client? Their users will no longer reach Banquet.ai at that address.`)) return;
    this.run(() => this.api.removeDomain(this.sub, domain), 'Domain removed.');
  }
}
