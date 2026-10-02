import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { BILL_STATUS_LABELS, BillListRow, BillStatus, BillingApi, money } from './billing-api';

/** All bills, newest function first, filtered by property, status and function dates. */
@Component({
  selector: 'app-bills-page',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head"><h1>Bills</h1></div>
    <form class="filters" (ngSubmit)="load()">
      <label>Property
        <select name="property" [(ngModel)]="filter.propertyId">
          <option value="">All properties</option>
          @for (p of properties(); track p.id) { <option [value]="p.id">{{ p['name'] }}</option> }
        </select>
      </label>
      <label>Status
        <select name="status" [(ngModel)]="filter.status">
          <option value="">Any</option>
          @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
        </select>
      </label>
      <label>Function from <input type="date" name="from" [(ngModel)]="filter.from" /></label>
      <label>to <input type="date" name="to" [(ngModel)]="filter.to" /></label>
      <button class="primary" type="submit">Show</button>
    </form>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Bill</th><th>Booking</th><th>Host</th><th>Function</th><th>Status</th><th class="num">Total</th><th class="num">Balance</th></tr>
        </thead>
        <tbody>
          @for (b of rows(); track b.id) {
            <tr>
              <td><a [routerLink]="['/operations/billing', b.reservationId]">{{ b.number ?? 'Draft' }}</a></td>
              <td>{{ b.reservationNumber }}</td>
              <td>{{ b.hostName }}</td>
              <td>{{ b.functionDate }}</td>
              <td><span class="pill">{{ labels[b.status] }}</span></td>
              <td class="num">@if (b.currency && b.total !== null) { <span class="muted cur">{{ b.currency }}</span> }{{ money(b.total, b.currency) }}</td>
              <td class="num">{{ b.balance === null ? '' : money(b.balance, b.currency) }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">{{ loading() ? 'Loading…' : 'No bills match.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="muted small">Draft bills show their totals once finalised. Open a booking from the diary to start its bill.</p>
  `,
  styles: `
    .filters { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; margin-bottom: 1rem; }
    .filters label { flex: 1 1 160px; margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); }
    th { font-weight: 500; color: var(--muted); font-size: 0.8rem; }
    .small { font-size: 0.8rem; }
    .cur { font-size: 0.75rem; margin-right: 0.35rem; }
  `,
})
export class BillsPage implements OnInit {
  private readonly api = inject(BillingApi);
  private readonly store = inject(MastersStore);

  protected readonly rows = signal<BillListRow[]>([]);
  protected readonly properties = signal<MasterRecord[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly labels = BILL_STATUS_LABELS;
  protected readonly statuses = Object.entries(BILL_STATUS_LABELS) as [BillStatus, string][];
  protected readonly money = money;
  protected filter = { propertyId: '', status: '', from: '', to: '' };

  async ngOnInit() {
    try {
      this.properties.set(await this.store.list('property', false));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
    await this.load();
  }

  protected async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set(await this.api.list(this.filter));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
