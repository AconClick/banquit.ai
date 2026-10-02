import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { BillingSetup, BillingSetupApi, MONTHS, SERIES_LABELS, Series, SeriesDocument, previewNumber } from './billing-setup-api';
import { PropertyPicker } from './property-picker';

interface Form {
  fyStartMonth: number;
  series: Record<SeriesDocument, Series>;
  next: Record<SeriesDocument, number | null>;
}

/** Per-property billing setup: the financial year and how bills and credit notes are numbered. */
@Component({
  selector: 'app-billing-setup-page',
  imports: [FormsModule, PropertyPicker],
  template: `
    <div class="page-head">
      <h1>Billing Setup</h1>
      <app-property-picker [(propertyId)]="propertyId" />
    </div>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (saved()) { <p class="alert ok" role="status">Billing setup saved.</p> }

    @if (setup(); as s) {
      <form class="settings" (ngSubmit)="save()">
        <section class="card">
          <h2>Financial year</h2>
          <label>The financial year starts in
            <select name="fy" [(ngModel)]="form.fyStartMonth">
              @for (m of months; track $index) { <option [ngValue]="$index + 1">{{ m }}</option> }
            </select>
          </label>
          <p class="muted hint">India: April. The year in bill numbers follows this, so it is now {{ s.financialYear }} at this property.
            Amounts are kept in {{ s.currency }} to {{ s.decimals }} decimal{{ s.decimals === 1 ? '' : 's' }}.</p>
        </section>

        @for (doc of docs; track doc) {
          <section class="card">
            <h2>{{ labels[doc] }}</h2>
            <div class="row">
              <label>Prefix <input [name]="doc + '-prefix'" maxlength="20" [(ngModel)]="form.series[doc].prefix" /></label>
              <label>Digits <input type="number" [name]="doc + '-digits'" min="1" max="10" step="1" class="short" [(ngModel)]="form.series[doc].digits" /></label>
            </div>
            <label class="check"><input type="checkbox" [name]="doc + '-reset'" [(ngModel)]="form.series[doc].resetYearly" /> Start again from 1 each financial year</label>
            <label>Next number this year
              <input type="number" [name]="doc + '-next'" [min]="s.next[doc].seq" step="1" class="short" [(ngModel)]="form.next[doc]" />
            </label>
            <p class="muted hint">
              Use {{ '{' }}FY{{ '}' }} for {{ s.financialYear }} or {{ '{' }}FYSHORT{{ '}' }} for the short form.
              The next one will be <strong class="preview">{{ preview(doc) }}</strong>.
              Raise the next number when moving from another system mid-year; it cannot go back.
            </p>
          </section>
        }
        <p class="muted hint">If two properties share a GST registration, give each its own prefix so no number is used twice.</p>
        <div class="actions"><button class="primary" [disabled]="busy()">Save billing setup</button></div>
      </form>
    }
  `,
  styles: `
    .settings { display: grid; gap: 1rem; max-width: 720px; }
    .settings h2 { margin-top: 0; font-size: 1.05rem; }
    .hint { font-size: 0.8rem; margin: -0.4rem 0 0.8rem; }
    .row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .row label { flex: 1 1 200px; }
    .short { max-width: 9rem; }
    .preview { font-family: ui-monospace, monospace; color: var(--text); }
    .actions { justify-content: flex-start; }
  `,
})
export class BillingSetupPage {
  private readonly api = inject(BillingSetupApi);
  protected readonly propertyId = signal('');
  protected readonly setup = signal<BillingSetup | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly docs: SeriesDocument[] = ['bill', 'creditNote'];
  protected readonly labels = SERIES_LABELS;
  protected readonly months = MONTHS;
  protected form: Form = { fyStartMonth: 4, series: { bill: { prefix: '', digits: 6, resetYearly: true }, creditNote: { prefix: '', digits: 6, resetYearly: true } }, next: { bill: null, creditNote: null } };

  constructor() {
    effect(() => {
      const id = this.propertyId();
      if (id) void this.load(id);
    });
  }

  private async load(id: string) {
    this.error.set(null);
    this.saved.set(false);
    try {
      this.apply(await this.api.get(id));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private apply(s: BillingSetup) {
    this.form = {
      fyStartMonth: s.fyStartMonth,
      series: { bill: { ...s.series.bill }, creditNote: { ...s.series.creditNote } },
      next: { bill: s.next.bill.seq, creditNote: s.next.creditNote.seq },
    };
    this.setup.set(s);
  }

  protected preview(doc: SeriesDocument) {
    const s = this.setup()!;
    return previewNumber({ ...this.form.series[doc], digits: Number(this.form.series[doc].digits) }, s.financialYear, Number(this.form.next[doc]) || s.next[doc].seq);
  }

  protected async save() {
    const s = this.setup();
    if (!s) return;
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      const series = Object.fromEntries(this.docs.map((d) => [d, { ...this.form.series[d], digits: Number(this.form.series[d].digits) }])) as Record<SeriesDocument, Series>;
      // Only send a next number that was moved forward; the counter itself may have moved since loading.
      const nextNumbers = Object.fromEntries(this.docs.filter((d) => Number(this.form.next[d]) > s.next[d].seq).map((d) => [d, Number(this.form.next[d])]));
      this.apply(await this.api.save(this.propertyId(), { fyStartMonth: Number(this.form.fyStartMonth), series, nextNumbers }));
      this.saved.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
