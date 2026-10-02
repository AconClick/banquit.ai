import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.interceptor';
import { AdminApi, BILLING_LABELS, Dashboard, LogEntry, STATUS_LABELS } from './admin-api';

/** Admin overview: what needs attention today, and the latest admin actions. */
@Component({
  selector: 'app-admin-dashboard',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="page-head"><h1>Overview</h1></div>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (data(); as d) {
      <div class="stats">
        @for (s of statuses; track s) {
          <a class="card stat" routerLink="/support/admin/clients" [queryParams]="{ status: s }">
            <strong>{{ d.byStatus[s] ?? 0 }}</strong><span class="muted">{{ statusLabels[s] }}</span>
          </a>
        }
        @for (b of billings; track b) {
          <a class="card stat" routerLink="/support/admin/clients" [queryParams]="{ status: 'active', billing: b }">
            <strong>{{ d.byBilling[b] ?? 0 }}</strong><span class="muted">{{ billingLabels[b] }}</span>
          </a>
        }
      </div>

      <div class="lists">
        <section class="card">
          <h2>Waiting for approval</h2>
          @for (c of d.waitingApproval; track c.subdomain) {
            <p><a [routerLink]="['/support/admin/clients', c.subdomain]">{{ c.name }}</a> <small class="muted">{{ c.subdomain }}</small></p>
          } @empty { <p class="muted">Nobody is waiting.</p> }
        </section>
        <section class="card">
          <h2>Overdue</h2>
          @for (c of d.overdue; track c.subdomain) {
            <p><a [routerLink]="['/support/admin/clients', c.subdomain]">{{ c.name }}</a>
              <small class="muted">{{ c.paidUntil ? 'paid until ' + c.paidUntil : 'trial ended ' + c.trialEndsAt }}</small></p>
          } @empty { <p class="muted">No overdue clients.</p> }
        </section>
        <section class="card">
          <h2>Trial ends within a week</h2>
          @for (c of d.trialEndingSoon; track c.subdomain) {
            <p><a [routerLink]="['/support/admin/clients', c.subdomain]">{{ c.name }}</a> <small class="muted">ends {{ c.trialEndsAt }}</small></p>
          } @empty { <p class="muted">None.</p> }
        </section>
      </div>
    }

    <h2>Recent admin actions</h2>
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>When</th><th>Who</th><th>Client</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          @for (a of log(); track $index) {
            <tr>
              <td class="nowrap">{{ a.at | date: 'd MMM, h:mm a' }}</td>
              <td>{{ a.by }}</td>
              <td>@if (a.tenant) { <a [routerLink]="['/support/admin/clients', a.tenant]">{{ a.tenant }}</a> }</td>
              <td>{{ a.action }}</td>
              <td>{{ a.detail }}</td>
            </tr>
          } @empty { <tr><td colspan="5" class="muted">Nothing yet.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
    .stat { display: flex; flex-direction: column; text-decoration: none; color: inherit; padding: 0.9rem 1rem; }
    .stat strong { font-size: 1.6rem; }
    .lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
    .lists h2 { font-size: 1rem; margin: 0 0 0.6rem; }
    .lists p { margin: 0.3rem 0; }
  `,
})
export class AdminDashboard implements OnInit {
  private readonly api = inject(AdminApi);
  protected readonly data = signal<Dashboard | null>(null);
  protected readonly log = signal<LogEntry[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly statuses = ['pending', 'active', 'suspended'] as const;
  protected readonly billings = ['trial', 'paid', 'overdue', 'unpaid'] as const;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly billingLabels = BILLING_LABELS;

  async ngOnInit() {
    try {
      const [d, log] = await Promise.all([this.api.dashboard(), this.api.log()]);
      this.data.set(d);
      this.log.set(log);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
