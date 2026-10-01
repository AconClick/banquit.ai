import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { MasterRecord, MastersStore } from './masters-store';
import { PricedItem, PricingApi, PropertySettings, TAX_GROUP_LABELS } from './pricing-api';
import { PropertyPicker } from './property-picker';

interface Draft {
  offered: boolean;
  /** Empty means the group rate. */
  rate: string | number;
  /** '' means the group setting. */
  taxInclusive: '' | 'yes' | 'no';
  customTaxes: boolean;
  taxIds: string[];
}

const KIND_LABELS = { package: 'Package', menuItem: 'Menu item', modifier: 'Modifier' } as const;

/**
 * Rate & Tax Mapping: what one property sells, at what price, with which taxes. Anything left
 * empty follows the group master, so a single-property venue never has to touch this screen.
 */
@Component({
  selector: 'app-rate-mapping-page',
  imports: [FormsModule, PropertyPicker],
  template: `
    <div class="page-head">
      <h1>Rate &amp; Tax Mapping</h1>
      <app-property-picker [(propertyId)]="propertyId" />
    </div>
    <p class="muted intro">
      Leave a field empty to use the group price or setting. Untick "Offered" to stop selling an item at this property.
      Items without their own taxes use the property's default taxes (Property Settings).
    </p>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }

    <div class="filters">
      <label class="inline">Show
        <select name="kind" [ngModel]="kind()" (ngModelChange)="kind.set($event)">
          <option value="">Everything</option>
          <option value="package">Packages</option>
          <option value="menuItem">Menu items</option>
          <option value="modifier">Modifiers</option>
        </select>
      </label>
      <input type="search" name="q" placeholder="Search code or name" aria-label="Search" [ngModel]="q()" (ngModelChange)="q.set($event)" />
    </div>

    <div class="table-wrap">
      <table class="grid rates">
        <thead>
          <tr>
            <th>Item</th><th>Type</th><th class="num">Group rate</th><th>Rate here</th><th>Includes tax</th><th>Taxes</th><th>Offered</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (i of visible(); track key(i)) {
            @let d = drafts()[key(i)];
            <tr [class.inactive]="!d.offered">
              <td><strong>{{ i.code }}</strong> {{ i.name }}@if (i.unit) { <span class="muted"> / {{ i.unit }}</span> }</td>
              <td>{{ kindLabels[i.kind] }}<br /><span class="muted small">{{ groupLabels[i.aType] }}</span></td>
              <td class="num">{{ i.groupRate.toFixed(2) }}@if (i.groupTaxInclusive) { <span class="muted small"> incl. tax</span> }</td>
              <td><input type="number" min="0" step="any" class="rate" [name]="'rate-' + key(i)" [placeholder]="i.groupRate.toFixed(2)"
                [(ngModel)]="d.rate" [attr.aria-label]="'Rate at this property for ' + i.name" /></td>
              <td>
                <select [name]="'incl-' + key(i)" [(ngModel)]="d.taxInclusive" [attr.aria-label]="'Includes tax for ' + i.name">
                  <option value="">Group ({{ i.groupTaxInclusive ? 'yes' : 'no' }})</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </td>
              <td class="taxes">
                <label class="check"><input type="checkbox" [name]="'custom-' + key(i)" [(ngModel)]="d.customTaxes" /> Own taxes</label>
                @if (d.customTaxes) {
                  @for (t of taxes(); track t.id) {
                    <label class="check"><input type="checkbox" [checked]="d.taxIds.includes(t.id)" (change)="toggle(d, t.id)" /> {{ t['description'] }}</label>
                  }
                } @else {
                  <span class="muted small">{{ defaultTaxNames(i) || 'None' }}</span>
                }
              </td>
              <td><input type="checkbox" [name]="'offered-' + key(i)" [(ngModel)]="d.offered" [attr.aria-label]="'Offered: ' + i.name" /></td>
              <td class="nowrap">
                @if (dirty(i)) { <button class="primary" [disabled]="busy()" (click)="save(i)">Save</button> }
                @else if (i.overridden) { <span class="pill">Changed here</span> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="muted">Nothing to show. Packages appear once ticked for this property; menu items with A-Type Ala Carte or Services and modifiers appear for every property unless limited.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .intro { max-width: 760px; margin: -0.5rem 0 1rem; font-size: 0.9rem; }
    .filters { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.75rem; }
    .filters input { max-width: 240px; }
    .rates input.rate { width: 7.5rem; }
    .rates td { vertical-align: top; }
    .taxes label.check { margin-bottom: 0.2rem; font-size: 0.85rem; }
    .small { font-size: 0.8rem; }
    .nowrap { white-space: nowrap; }
  `,
})
export class RateMappingPage {
  private readonly api = inject(PricingApi);
  private readonly store = inject(MastersStore);
  protected readonly propertyId = signal('');
  protected readonly items = signal<PricedItem[]>([]);
  protected readonly drafts = signal<Record<string, Draft>>({});
  protected readonly taxes = signal<MasterRecord[]>([]);
  protected readonly settings = signal<PropertySettings | null>(null);
  protected readonly kind = signal('');
  protected readonly q = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly kindLabels = KIND_LABELS;
  protected readonly groupLabels = TAX_GROUP_LABELS;

  protected readonly visible = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.items().filter((i) => (!this.kind() || i.kind === this.kind()) && (!q || `${i.code} ${i.name}`.toLowerCase().includes(q)));
  });

  constructor() {
    effect(() => {
      const id = this.propertyId();
      if (id) void this.load(id);
    });
  }

  protected key = (i: PricedItem) => `${i.kind}:${i.id}`;

  private async load(propertyId: string) {
    this.error.set(null);
    try {
      const [items, taxes, settings] = await Promise.all([this.api.rates(propertyId), this.store.list('tax'), this.api.settings(propertyId)]);
      this.taxes.set(taxes.filter((t) => (t['propertyIds'] as string[]).includes(propertyId)));
      this.settings.set(settings);
      this.items.set(items);
      this.drafts.set(Object.fromEntries(items.map((i) => [this.key(i), this.draftOf(i)])));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private draftOf(i: PricedItem): Draft {
    const own = i.overridden;
    return {
      offered: i.offered,
      rate: own && i.rate !== i.groupRate ? i.rate : '',
      taxInclusive: own && i.taxInclusive !== i.groupTaxInclusive ? (i.taxInclusive ? 'yes' : 'no') : '',
      customTaxes: i.taxIds !== null,
      taxIds: [...(i.taxIds ?? [])],
    };
  }

  protected defaultTaxNames(i: PricedItem) {
    const ids = this.settings()?.defaultTaxIds[i.aType] ?? [];
    return this.taxes().filter((t) => ids.includes(t.id)).map((t) => String(t['description'])).join(', ');
  }

  protected toggle(d: Draft, id: string) {
    const at = d.taxIds.indexOf(id);
    if (at >= 0) d.taxIds.splice(at, 1);
    else d.taxIds.push(id);
  }

  protected dirty(i: PricedItem) {
    return JSON.stringify(this.drafts()[this.key(i)]) !== JSON.stringify(this.draftOf(i));
  }

  protected async save(i: PricedItem) {
    const d = this.drafts()[this.key(i)];
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.api.saveRate(this.propertyId(), i.kind, i.id, {
        offered: d.offered,
        rate: d.rate === '' || d.rate === null ? null : Number(d.rate),
        taxInclusive: d.taxInclusive === '' ? null : d.taxInclusive === 'yes',
        taxIds: d.customTaxes ? d.taxIds : null,
      });
      this.items.update((list) => list.map((x) => (this.key(x) === this.key(i) ? saved : x)));
      this.drafts.update((all) => ({ ...all, [this.key(i)]: this.draftOf(saved) }));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
