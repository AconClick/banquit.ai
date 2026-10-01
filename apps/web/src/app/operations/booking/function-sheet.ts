import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { TenantService } from '../../core/tenant.service';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { STATUS_LABELS } from '../diary/diary-api';
import { ATYPE_LABELS, BookingApi, BookingDetails, MenuOptions } from './booking-api';

/**
 * Function sheet (event order) for the kitchen, service and housekeeping teams. No prices:
 * it says what to prepare, where, when and for how many.
 */
@Component({
  selector: 'app-function-sheet',
  imports: [RouterLink],
  template: `
    @if (d(); as r) {
      <div class="toolbar no-print">
        <a [routerLink]="['/operations/bookings', r.id]">‹ Back to booking</a>
        <button class="primary" (click)="print()">Print</button>
      </div>
      <article class="sheet">
        <header>
          <div>
            <p class="muted">{{ tenantName() }} · {{ name('property', r.propertyId, 'name') }}</p>
            <h1>Function sheet {{ r.number }}</h1>
          </div>
          <div class="status">{{ labels[r.status] }}<br /><span class="muted">Printed {{ printedAt }}</span></div>
        </header>

        <table class="facts">
          <tbody>
            <tr><th>Host</th><td>{{ r.hostName }}</td><th>Function</th><td>{{ name('functionType', r.functionTypeId) }}</td></tr>
            <tr><th>Contact</th><td>{{ r.contactName || '—' }}, {{ r.phone }}</td><th>Seating</th><td>{{ name('seatingStyle', r.seatingStyleId) || '—' }}</td></tr>
            @for (s of r.slots; track s.start) {
              <tr><th>Hall</th><td>{{ name('hall', s.hallId) }}</td><th>Time</th><td>{{ s.start.replace('T', ' ') }} to {{ s.end.slice(11) }}</td></tr>
            }
            <tr><th>Guaranteed</th><td><strong>{{ r.guaranteedPax }} pax</strong></td><th>Expected max</th><td>{{ r.expectedMaxPax }} pax</td></tr>
          </tbody>
        </table>

        <h2>Menu</h2>
        @for (p of r.packages; track p.packageId) {
          <section class="block">
            <h3>{{ p.name }} <span class="muted">· {{ p.pax }} pax</span></h3>
            @for (g of groupsOf(p); track g.name) {
              <p><strong>{{ g.name }}:</strong> {{ g.items.join(', ') || 'Not chosen yet' }}</p>
            }
          </section>
        } @empty { <p class="muted">No package on this booking.</p> }

        @if (r.extras.length) {
          <h2>Extras and services</h2>
          <table class="list">
            <thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead>
            <tbody>
              @for (e of r.extras; track e.kind + e.itemId) {
                <tr><td>{{ e.name }}</td><td>{{ aTypes[e.aType] }}</td><td>{{ e.qty }}</td><td>{{ e.note }}</td></tr>
              }
            </tbody>
          </table>
        }

        @if (r.notes) {
          <h2>Notes</h2>
          <p class="pre">{{ r.notes }}</p>
        }
        @for (w of r.menuWarnings; track w) { <p class="warn">⚠ {{ w }}</p> }

        <footer>
          <div>Banquet manager</div><div>Chef</div><div>Guest</div>
        </footer>
      </article>
    } @else if (error(); as e) {
      <p class="alert error" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    :host { display: block; padding: 1rem 16px 2rem; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; max-width: 820px; margin: 0 auto 1rem; }
    .toolbar a { color: var(--primary); text-decoration: none; font-size: 0.9rem; }
    .sheet { max-width: 820px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 2rem; }
    header { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 2px solid var(--text); padding-bottom: 0.75rem; margin-bottom: 1rem; }
    header p { margin: 0; }
    h1 { margin: 0.2rem 0 0; font-size: 1.4rem; }
    h2 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
    h3 { font-size: 0.95rem; margin: 0.75rem 0 0.35rem; }
    .status { text-align: right; font-weight: 600; }
    .status .muted { font-weight: 400; font-size: 0.8rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .facts th { text-align: left; color: var(--muted); font-weight: 500; width: 16%; padding: 0.3rem 0.5rem 0.3rem 0; vertical-align: top; }
    .facts td { padding: 0.3rem 1rem 0.3rem 0; vertical-align: top; }
    .list th, .list td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); }
    .block p { margin: 0.2rem 0; font-size: 0.9rem; }
    .pre { white-space: pre-wrap; }
    .warn { color: var(--warn); }
    footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; margin-top: 3.5rem; }
    footer div { border-top: 1px solid var(--text); padding-top: 0.3rem; font-size: 0.8rem; color: var(--muted); }
    @media print {
      :host { padding: 0; }
      .sheet { border: none; padding: 0; max-width: none; }
    }
  `,
})
export class FunctionSheet implements OnInit {
  private readonly api = inject(BookingApi);
  private readonly store = inject(MastersStore);
  private readonly tenants = inject(TenantService);
  readonly id = input.required<string>();

  protected readonly d = signal<BookingDetails | null>(null);
  protected readonly options = signal<MenuOptions | null>(null);
  protected readonly lookups = signal<Record<string, MasterRecord[]>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly labels = STATUS_LABELS;
  protected readonly aTypes = ATYPE_LABELS;
  protected readonly printedAt = new Date().toLocaleString();
  protected readonly tenantName = computed(() => this.tenants.tenant()?.name ?? '');

  async ngOnInit() {
    try {
      const [d, options, ...lists] = await Promise.all([
        this.api.details(this.id()),
        this.api.menuOptions(this.id()),
        ...['property', 'hall', 'functionType', 'seatingStyle'].map((k) => this.store.list(k, true)),
      ]);
      this.lookups.set({ property: lists[0], hall: lists[1], functionType: lists[2], seatingStyle: lists[3] });
      this.options.set(options);
      this.d.set(d);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected name(kind: string, id: string | null | undefined, field = 'description') {
    const r = id ? this.lookups()[kind]?.find((x) => x.id === id) : undefined;
    return r ? String(r[field]) : '';
  }

  /** The chosen items of a package line, grouped by the package's sub-groups. */
  protected groupsOf(p: BookingDetails['packages'][number]) {
    const groups = this.options()?.packages.find((o) => o.id === p.packageId)?.groups;
    if (!groups) return [{ name: 'Chosen', items: p.choices.map((c) => c.name) }];
    return groups.map((g) => ({ name: g.name, items: p.choices.filter((c) => g.items.some((i) => i.id === c.id)).map((c) => c.name) }));
  }

  protected print() {
    window.print();
  }
}
