import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { roundTo } from '../../core/money';
import { TenantService } from '../../core/tenant.service';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { BillingApi, BillingView, PAYMENT_MODES, money } from './billing-api';

interface PrintLine {
  label: string;
  qty: number;
  rate: number;
  amount: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  note: string;
}

/**
 * Printable proforma (a quotation, no number), draft (marked DRAFT) or final bill. A per-property
 * layout from Print Setup will replace this default layout.
 */
@Component({
  selector: 'app-bill-print',
  imports: [RouterLink, DatePipe],
  template: `
    @if (view(); as v) {
      <div class="toolbar no-print">
        <a [routerLink]="['/operations/billing', v.booking.id]">‹ Back to the bill</a>
        <button class="primary" (click)="print()">Print</button>
      </div>
      <article class="doc" [class.watermark]="mark()" [attr.data-mark]="mark()">
        <header>
          <div>
            <p class="org">{{ tenantName() }}</p>
            <p class="muted">{{ property()?.['name'] }} · {{ property()?.['city'] }}, {{ property()?.['state'] }}, {{ property()?.['country'] }}</p>
          </div>
          <div class="title">
            <h1>{{ title() }}</h1>
            @if (v.bill?.number && doc() === 'bill') { <p><strong>{{ v.bill!.number }}</strong></p> }
            <p class="muted">{{ (v.bill?.finalisedAt && doc() === 'bill' ? v.bill!.finalisedAt : printedAt) | date: 'mediumDate' }}</p>
          </div>
        </header>

        <table class="facts">
          <tbody>
            <tr><th>Bill to</th><td>{{ v.booking.hostName }}@if (v.booking.contactName) { <br />{{ v.booking.contactName }} }<br />{{ v.booking.phone }}</td>
              <th>Booking</th><td>{{ v.booking.number }}<br />Function on {{ v.booking.functionDate }}</td></tr>
            <tr><th>Venue</th><td colspan="3">
              @for (h of v.booking.halls; track h.hallId + h.start) { {{ hallName(h.hallId) }}, {{ h.start.replace('T', ' ') }} to {{ h.end.slice(11) }}{{ $last ? '' : '; ' }} }
            </td></tr>
          </tbody>
        </table>

        <table class="list">
          <thead>
            <tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th class="num">Discount</th>
              <th class="num">Taxable</th><th class="num">Tax</th><th class="num">Total</th></tr>
          </thead>
          <tbody>
            @for (l of lines(); track $index) {
              <tr>
                <td>{{ l.label }}@if (l.note) { <br /><span class="muted small">{{ l.note }}</span> }</td>
                <td class="num">{{ l.qty }}</td><td class="num">{{ money(l.rate) }}</td><td class="num">{{ money(l.amount) }}</td>
                <td class="num">{{ l.discount ? money(l.discount) : '' }}</td><td class="num">{{ money(l.taxable) }}</td>
                <td class="num">{{ money(l.tax) }}</td><td class="num">{{ money(l.total) }}</td>
              </tr>
            }
          </tbody>
        </table>

        <div class="sums">
          <dl>
            <dt>Taxable value</dt><dd>{{ money(totals().taxable) }}</dd>
            @for (t of totals().taxes; track t.id) { <dt>{{ t.name }}</dt><dd>{{ money(t.amount) }}</dd> }
            @if (totals().roundOff) { <dt>Round off</dt><dd>{{ money(totals().roundOff) }}</dd> }
            <dt class="grand">Total {{ currency() }}</dt><dd class="grand">{{ money(totals().total) }}</dd>
            @if (totals().advances) { <dt>Less advances</dt><dd>{{ money(totals().advances) }}</dd> }
            @if (totals().paid) { <dt>Less paid</dt><dd>{{ money(totals().paid) }}</dd> }
            @if (doc() !== 'proforma') {
              <dt class="grand">{{ totals().balance < 0 ? 'Due to guest' : 'Balance due' }}</dt>
              <dd class="grand">{{ money(totals().balance < 0 ? -totals().balance : totals().balance) }}</dd>
            }
          </dl>
        </div>

        @if (doc() === 'bill' && v.bill && (v.bill.advanceReceipts.length || v.bill.payments.length)) {
          <h2>Received</h2>
          <table class="list small">
            <tbody>
              @for (a of v.bill.advanceReceipts; track a.number) { <tr><td>{{ a.number }}</td><td>{{ a.date }}</td><td>Advance, {{ modeLabels[a.mode] ?? a.mode }}</td><td class="num">{{ money(a.amount) }}</td></tr> }
              @for (p of v.bill.payments; track p.number) {
                <tr><td>{{ p.number }}</td><td>{{ p.date }}</td><td>{{ p.kind === 'refund' ? 'Refund' : 'Payment' }}, {{ modeLabels[p.mode] ?? p.mode }} {{ p.reference }}</td>
                  <td class="num">{{ p.kind === 'refund' ? '−' : '' }}{{ money(p.amount) }}</td></tr>
              }
            </tbody>
          </table>
        }

        @if (doc() === 'proforma') {
          <p class="muted small">This is an estimate on guaranteed pax, not a tax invoice. The final bill uses the higher of guaranteed and actual guests, and the taxes in force on the function date.</p>
        }
        <footer><div>For {{ tenantName() }}</div><div>Guest signature</div></footer>
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
    .doc.watermark::before { content: attr(data-mark); position: absolute; inset: 0; display: grid; place-items: center; font-size: 7rem; font-weight: 800;
      color: var(--text); opacity: 0.06; transform: rotate(-24deg); pointer-events: none; }
    header { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 2px solid var(--text); padding-bottom: 0.75rem; margin-bottom: 1rem; }
    header p { margin: 0; }
    .org { font-weight: 700; font-size: 1.15rem; }
    .title { text-align: right; }
    h1 { margin: 0 0 0.2rem; font-size: 1.3rem; letter-spacing: 0.02em; }
    h2 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    .facts { margin-bottom: 1rem; }
    .facts th { text-align: left; color: var(--muted); font-weight: 500; width: 12%; padding: 0.3rem 0.5rem 0.3rem 0; vertical-align: top; }
    .facts td { padding: 0.3rem 1rem 0.3rem 0; vertical-align: top; }
    .list th, .list td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    .list th { font-weight: 500; color: var(--muted); font-size: 0.8rem; }
    .small { font-size: 0.8rem; }
    .sums { display: flex; justify-content: flex-end; margin-top: 1rem; }
    .sums dl { display: grid; grid-template-columns: auto auto; gap: 0.2rem 2rem; margin: 0; min-width: 300px; font-variant-numeric: tabular-nums; }
    .sums dt { color: var(--muted); }
    .sums dd { margin: 0; text-align: right; }
    .sums .grand { color: var(--text); font-weight: 700; border-top: 1px solid var(--text); padding-top: 0.2rem; }
    footer { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3rem; margin-top: 3.5rem; }
    footer div { border-top: 1px solid var(--text); padding-top: 0.3rem; font-size: 0.8rem; color: var(--muted); }
    @media print {
      :host { padding: 0; }
      .doc { border: none; padding: 0; max-width: none; }
      .doc.watermark::before { opacity: 0.08; color: #000; }
    }
    @media (max-width: 640px) {
      .doc { padding: 1rem; }
      .list { display: block; overflow-x: auto; }
    }
  `,
})
export class BillPrint implements OnInit {
  private readonly api = inject(BillingApi);
  private readonly store = inject(MastersStore);
  private readonly tenants = inject(TenantService);
  /** Reservation id from the route; ?doc=proforma|bill from the query string. */
  readonly id = input.required<string>();
  readonly docParam = input<string | undefined>(undefined, { alias: 'doc' });

  protected readonly view = signal<BillingView | null>(null);
  protected readonly lookups = signal<Record<string, MasterRecord[]>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly modeLabels = PAYMENT_MODES as Record<string, string>;
  protected readonly printedAt = new Date().toISOString();
  protected readonly tenantName = computed(() => this.tenants.tenant()?.name ?? '');

  /** No bill yet, or asked for: the proforma. */
  protected readonly doc = computed(() => (this.docParam() === 'proforma' || !this.view()?.bill ? 'proforma' : 'bill'));
  protected readonly property = computed(() => this.lookups()['property']?.find((p) => p.id === this.view()?.booking.propertyId));
  protected readonly currency = computed(() => this.view()?.bill?.currency ?? this.view()?.currency ?? String(this.property()?.['currency'] ?? ''));
  protected readonly decimals = computed(() => (this.doc() === 'bill' ? this.view()?.bill?.decimals : undefined) ?? this.view()?.decimals ?? 2);
  protected readonly money = (n: number | null | undefined) => money(n, this.decimals());
  protected readonly title = computed(() => {
    if (this.doc() === 'proforma') return 'Proforma invoice';
    const s = this.view()?.bill?.status;
    return s === 'draft' ? 'Draft bill' : s === 'void' ? 'Bill (void)' : 'Tax invoice';
  });
  protected readonly mark = computed(() => {
    if (this.doc() === 'proforma') return 'ESTIMATE';
    const s = this.view()?.bill?.status;
    return s === 'draft' ? 'DRAFT' : s === 'void' ? 'VOID' : '';
  });

  protected readonly lines = computed<PrintLine[]>(() => {
    const v = this.view();
    if (!v) return [];
    const round2 = (n: number) => roundTo(n, this.decimals());
    if (this.doc() === 'proforma') {
      return v.proforma.lines.map((l) => ({
        label: l.label, qty: l.qty, rate: l.rate, amount: l.amount, discount: 0, taxable: l.taxable, tax: round2(l.total - l.taxable), total: l.total,
        note: l.taxInclusive ? 'Rate includes tax' : '',
      }));
    }
    return v.bill!.lines.map((l) => ({
      label: l.label, qty: l.qty, rate: l.rate, amount: l.amount, discount: l.discount, taxable: l.taxable, tax: round2(l.total - l.taxable), total: l.total,
      note: [
        l.guaranteedPax !== null ? `Guaranteed ${l.guaranteedPax}, actual ${l.actualPax ?? 'not entered'}` : '',
        l.taxInclusive ? 'Rate includes tax' : '',
        l.remark,
      ].filter(Boolean).join(' · '),
    }));
  });

  protected readonly totals = computed(() => {
    const v = this.view()!;
    const round2 = (n: number) => roundTo(n, this.decimals());
    if (this.doc() === 'proforma') {
      const p = v.proforma;
      return { taxable: p.taxable, taxes: p.taxes, roundOff: p.roundOff, total: p.total, advances: p.advances, paid: 0, balance: round2(p.total - p.advances) };
    }
    return v.bill!;
  });

  async ngOnInit() {
    try {
      const [view, properties, halls] = await Promise.all([
        this.api.forReservation(this.id()), this.store.list('property', true), this.store.list('hall', true),
      ]);
      this.lookups.set({ property: properties, hall: halls });
      this.view.set(view);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected hallName(id: string) {
    return String(this.lookups()['hall']?.find((h) => h.id === id)?.['description'] ?? 'Hall');
  }

  protected print() {
    window.print();
  }
}
