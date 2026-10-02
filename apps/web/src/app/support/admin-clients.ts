import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.interceptor';
import { AdminApi, BILLING_LABELS, ClientSummary, STATUS_LABELS } from './admin-api';

/** Every client account, searchable and filtered by status and billing. */
@Component({
  selector: 'app-admin-clients',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="page-head"><h1>Clients</h1></div>
    <form class="filters" (ngSubmit)="apply()">
      <input name="q" [(ngModel)]="q" placeholder="Search name, domain or email" aria-label="Search" />
      <select name="status" [(ngModel)]="status" (ngModelChange)="apply()" aria-label="Status">
        <option value="">All statuses</option>
        @for (s of statusKeys; track s) { <option [value]="s">{{ statusLabels[s] }}</option> }
      </select>
      <select name="billing" [(ngModel)]="billing" (ngModelChange)="apply()" aria-label="Billing">
        <option value="">Any billing</option>
        @for (b of billingKeys; track b) { <option [value]="b">{{ billingLabels[b] }}</option> }
      </select>
      <button>Search</button>
    </form>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>Client</th><th>Contact</th><th>Status</th><th>Plan</th><th>Billing</th><th>Usage</th><th>Signed up</th></tr></thead>
        <tbody>
          @for (c of list(); track c.subdomain) {
            <tr [class.inactive]="c.status === 'rejected'">
              <td><a [routerLink]="[c.subdomain]">{{ c.name }}</a><br /><small class="muted">{{ c.subdomain }}</small></td>
              <td>{{ c.contactName }}<br /><small class="muted">{{ c.contactEmail }}</small></td>
              <td><span class="pill" [class.warn]="c.status !== 'active'">{{ statusLabels[c.status] }}</span></td>
              <td>{{ c.planCode ?? '' }}</td>
              <td>{{ billingLabels[c.billing] }}@if (c.billing === 'paid') { <small class="muted"> to {{ c.paidUntil }}</small> }@if (c.billing === 'trial') { <small class="muted"> to {{ c.trialEndsAt }}</small> }</td>
              <td class="nowrap">{{ c.properties }} properties, {{ c.users }} users</td>
              <td class="nowrap">{{ c.createdAt | date: 'd MMM y' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">{{ loading() ? 'Loading…' : 'No clients match.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .filters input { flex: 1 1 220px; }
  `,
})
export class AdminClients implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly list = signal<ClientSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly billingLabels = BILLING_LABELS;
  protected readonly statusKeys = Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[];
  protected readonly billingKeys = ['trial', 'paid', 'overdue', 'unpaid'] as const;

  protected q = '';
  protected status = '';
  protected billing = '';

  ngOnInit() {
    this.route.queryParamMap.subscribe((p) => {
      this.q = p.get('q') ?? '';
      this.status = p.get('status') ?? '';
      this.billing = p.get('billing') ?? '';
      void this.load();
    });
  }

  protected apply() {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { q: this.q || null, status: this.status || null, billing: this.billing || null } });
  }

  private async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.list.set(await this.api.clients({ q: this.q, status: this.status, billing: this.billing }));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
