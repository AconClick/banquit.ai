import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { TenantService } from '../../core/tenant.service';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { BillingApi, CreditNote, money } from './billing-api';
import { DocLetterhead, DocNotes, DocPageSize } from './doc-parts';

/** Printable credit note: quotes the original bill, and reverses its lines with their taxes. */
@Component({
  selector: 'app-credit-note-print',
  imports: [RouterLink, DocLetterhead, DocNotes, DocPageSize],
  template: `
    @if (note(); as n) {
      <div class="toolbar no-print">
        <a [routerLink]="['/operations/billing', id()]">‹ Back to the bill</a>
        <button class="primary" (click)="print()">Print</button>
      </div>
      <article class="doc" [class.watermark]="n.status === 'cancelled'" data-mark="CANCELLED">
        <app-doc-page-size [size]="n.print?.paperSize" />
        <header>
          <app-doc-letterhead [print]="n.print" [fallbackName]="tenantName()" [fallbackPlace]="place()" />
          <div class="title">
            <h1>{{ n.print?.creditNoteTitle || 'Credit note' }}</h1>
            <p><strong>{{ n.number }}</strong></p>
            <p class="muted">{{ n.date }}</p>
          </div>
        </header>
        <table class="facts">
          <tbody>
            <tr><th>Issued to</th><td>{{ n.hostName }}</td><th>Against bill</th><td>{{ n.billNumber }} of {{ n.billDate }}<br />Booking {{ n.reservationNumber }}</td></tr>
            <tr><th>Reason</th><td colspan="3">{{ n.reason }}</td></tr>
            @if (n.status === 'cancelled') { <tr><th>Cancelled</th><td colspan="3">{{ n.cancelReason }}</td></tr> }
          </tbody>
        </table>
        <table class="list">
          <thead><tr><th>Description</th><th class="num">Taxable</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
          <tbody>
            @for (l of n.lines; track l.billLineId) {
              <tr><td>{{ l.label }}</td><td class="num">{{ m(l.taxable) }}</td><td class="num">{{ m(l.total - l.taxable) }}</td><td class="num">{{ m(l.total) }}</td></tr>
            }
          </tbody>
        </table>
        <div class="sums">
          <dl>
            <dt>Taxable value</dt><dd>{{ m(n.taxable) }}</dd>
            @for (t of n.taxes; track t.id) { <dt>{{ t.name }}</dt><dd>{{ m(t.amount) }}</dd> }
            @if (n.roundOff) { <dt>Round off</dt><dd>{{ m(n.roundOff) }}</dd> }
            <dt class="grand">Credit {{ n.currency }}</dt><dd class="grand">{{ m(n.total) }}</dd>
          </dl>
        </div>
        <app-doc-notes [print]="n.print" />
        <footer><div>{{ n.print?.signatureLabel || 'Authorised signatory' }}, {{ n.print?.legalName || tenantName() }}</div><div>Received by</div></footer>
      </article>
    } @else if (error(); as e) {
      <p class="alert error" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    :host { display: block; padding: 1rem 16px 2rem; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; max-width: 900px; margin: 0 auto 1rem; }
    .toolbar a { color: var(--primary); text-decoration: none; font-size: 0.9rem; }
    .doc { position: relative; max-width: 900px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 2rem; overflow: hidden; }
    .doc.watermark::before { content: attr(data-mark); position: absolute; inset: 0; display: grid; place-items: center; font-size: 6rem; font-weight: 800;
      color: var(--text); opacity: 0.06; transform: rotate(-24deg); pointer-events: none; }
    header { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 2px solid var(--text); padding-bottom: 0.75rem; margin-bottom: 1rem; }
    header p { margin: 0; }
    .title { text-align: right; }
    h1 { margin: 0 0 0.2rem; font-size: 1.3rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    .facts { margin-bottom: 1rem; }
    .facts th { text-align: left; color: var(--muted); font-weight: 500; width: 14%; padding: 0.3rem 0.5rem 0.3rem 0; vertical-align: top; }
    .facts td { padding: 0.3rem 1rem 0.3rem 0; vertical-align: top; }
    .list th, .list td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); }
    .list th { font-weight: 500; color: var(--muted); font-size: 0.8rem; }
    .sums { display: flex; justify-content: flex-end; margin-top: 1rem; }
    .sums dl { display: grid; grid-template-columns: auto auto; gap: 0.2rem 2rem; margin: 0; min-width: 260px; font-variant-numeric: tabular-nums; }
    .sums dt { color: var(--muted); }
    .sums dd { margin: 0; text-align: right; }
    .sums .grand { color: var(--text); font-weight: 700; border-top: 1px solid var(--text); padding-top: 0.2rem; }
    footer { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3rem; margin-top: 3.5rem; }
    footer div { border-top: 1px solid var(--text); padding-top: 0.3rem; font-size: 0.8rem; color: var(--muted); }
    @media print { :host { padding: 0; } .doc { border: none; padding: 0; max-width: none; } }
    @media (max-width: 640px) { .doc { padding: 1rem; } }
  `,
})
export class CreditNotePrint implements OnInit {
  private readonly api = inject(BillingApi);
  private readonly store = inject(MastersStore);
  private readonly tenants = inject(TenantService);
  /** Reservation id and credit note id, from the route. */
  readonly id = input.required<string>();
  readonly cnId = input.required<string>();

  protected readonly note = signal<CreditNote | null>(null);
  protected readonly properties = signal<MasterRecord[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly tenantName = computed(() => this.tenants.tenant()?.name ?? '');
  protected readonly property = computed(() => this.properties().find((p) => p.id === this.note()?.propertyId));
  protected readonly place = computed(() => {
    const p = this.property();
    return p ? `${p['name']} · ${p['city']}, ${p['state']}, ${p['country']}` : '';
  });

  async ngOnInit() {
    try {
      const [note, properties] = await Promise.all([this.api.creditNote(this.cnId()), this.store.list('property', true)]);
      this.properties.set(properties);
      this.note.set(note);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected m(n: number) {
    return money(n, this.note()?.decimals ?? 2);
  }

  protected print() {
    window.print();
  }
}
