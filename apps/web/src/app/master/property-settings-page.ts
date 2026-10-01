import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { MasterRecord, MastersStore } from './masters-store';
import { PricingApi, PropertySettings, TAX_GROUP_LABELS, TaxGroup } from './pricing-api';
import { PropertyPicker } from './property-picker';

/** Per-property business rules: option dates, advances, cancellation slabs, rounding and default taxes. */
@Component({
  selector: 'app-property-settings-page',
  imports: [FormsModule, PropertyPicker],
  template: `
    <div class="page-head">
      <h1>Property Settings</h1>
      <app-property-picker [(propertyId)]="propertyId" />
    </div>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (saved()) { <p class="alert ok" role="status">Settings saved.</p> }

    @if (s(); as v) {
      <form class="settings" (ngSubmit)="save()">
        <section class="card">
          <h2>Provisional bookings</h2>
          <label>Option period (days from today) <input type="number" name="optionDays" min="0" step="1" [(ngModel)]="v.optionDays" /></label>
          <label>Latest option date (days before the function) <input type="number" name="optionBefore" min="0" step="1" [(ngModel)]="v.optionBeforeFunctionDays" /></label>
          <label>Menu and guarantee cut-off (hours before the function) <input type="number" name="cutoff" min="0" step="1" [(ngModel)]="v.guaranteeCutoffHours" /></label>
        </section>

        <section class="card">
          <h2>Advances</h2>
          <label>Advance to confirm (% of the proforma) <input type="number" name="advance" min="0" max="100" step="any" [(ngModel)]="v.advancePercent" /></label>
          <p class="muted hint">Set 0 to confirm bookings without an advance.</p>
          <label>Second instalment (total paid, % of the proforma) <input type="number" name="second" min="0" max="100" step="any" [(ngModel)]="v.secondInstalmentPercent" /></label>
          <label>Second instalment due (days before the function) <input type="number" name="secondDays" min="0" step="1" [(ngModel)]="v.secondInstalmentDaysBefore" /></label>
        </section>

        <section class="card">
          <h2>Cancellation charges</h2>
          <p class="muted hint">Charged on the proforma total, taken from advances first.</p>
          <table class="grid slabs">
            <thead><tr><th>Cancelled at least (days before)</th><th>Charge %</th><th></th></tr></thead>
            <tbody>
              @for (slab of v.cancellationSlabs; track $index; let i = $index) {
                <tr>
                  <td><input type="number" [name]="'from' + i" min="0" step="1" [(ngModel)]="slab.fromDays" [attr.aria-label]="'Slab ' + (i + 1) + ' days before'" /></td>
                  <td><input type="number" [name]="'pct' + i" min="0" max="100" step="any" [(ngModel)]="slab.percent" [attr.aria-label]="'Slab ' + (i + 1) + ' charge percent'" /></td>
                  <td><button type="button" class="link" (click)="v.cancellationSlabs.splice(i, 1)">Remove</button></td>
                </tr>
              }
            </tbody>
          </table>
          <button type="button" (click)="v.cancellationSlabs.push({ fromDays: 0, percent: 0 })">Add slab</button>
        </section>

        <section class="card">
          <h2>Bills and taxes</h2>
          <label class="check"><input type="checkbox" name="round" [(ngModel)]="v.roundTotal" /> Round the total to a whole amount (with a round-off line)</label>
          <p class="muted hint">Default taxes for each type of item. An item can have its own taxes in Rate &amp; Tax Mapping.</p>
          @for (g of groups; track g) {
            <fieldset>
              <legend>{{ groupLabels[g] }}</legend>
              @for (t of taxes(); track t.id) {
                <label class="check">
                  <input type="checkbox" [checked]="v.defaultTaxIds[g].includes(t.id)" (change)="toggleTax(g, t.id)" /> {{ t['description'] }}
                </label>
              } @empty { <p class="muted">No taxes set up for this property yet (Money &amp; tax › Taxes).</p> }
            </fieldset>
          }
        </section>

        <div class="actions"><button class="primary" [disabled]="busy()">Save settings</button></div>
      </form>
    }
  `,
  styles: `
    .settings { display: grid; gap: 1rem; max-width: 720px; }
    .settings h2 { margin-top: 0; font-size: 1.05rem; }
    .hint { font-size: 0.8rem; margin: -0.4rem 0 0.8rem; }
    .slabs input { width: 8rem; }
    .actions { justify-content: flex-start; }
  `,
})
export class PropertySettingsPage {
  private readonly api = inject(PricingApi);
  private readonly store = inject(MastersStore);
  protected readonly propertyId = signal('');
  protected readonly s = signal<PropertySettings | null>(null);
  protected readonly taxes = signal<MasterRecord[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly groups: TaxGroup[] = ['package', 'alacarte', 'services'];
  protected readonly groupLabels = TAX_GROUP_LABELS;

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
      const [settings, taxes] = await Promise.all([this.api.settings(id), this.store.list('tax')]);
      this.taxes.set(taxes.filter((t) => (t['propertyIds'] as string[]).includes(id)));
      this.s.set(settings);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected toggleTax(g: TaxGroup, id: string) {
    const list = this.s()!.defaultTaxIds[g];
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
  }

  protected async save() {
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      const v = this.s()!;
      const clean: PropertySettings = {
        ...v,
        optionDays: Number(v.optionDays),
        optionBeforeFunctionDays: Number(v.optionBeforeFunctionDays),
        guaranteeCutoffHours: Number(v.guaranteeCutoffHours),
        advancePercent: Number(v.advancePercent),
        secondInstalmentPercent: Number(v.secondInstalmentPercent),
        secondInstalmentDaysBefore: Number(v.secondInstalmentDaysBefore),
        cancellationSlabs: v.cancellationSlabs.map((x) => ({ fromDays: Number(x.fromDays), percent: Number(x.percent) })),
      };
      this.s.set(await this.api.saveSettings(this.propertyId(), clean));
      this.saved.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
