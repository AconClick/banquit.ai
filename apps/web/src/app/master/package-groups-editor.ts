import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MasterRecord, PackageGroup } from './masters-store';

/**
 * Package menu rules: for each sub-group, which Package items the guest can choose from and
 * how many they must pick (e.g. "any 3 of these 10 starters").
 */
@Component({
  selector: 'app-package-groups-editor',
  imports: [FormsModule],
  template: `
    @for (g of groups(); track $index; let i = $index) {
      <div class="rule">
        <div class="row">
          <label class="field">
            <span [id]="'sg-label-' + i">Sub-group</span>
            <select [attr.aria-labelledby]="'sg-label-' + i" [ngModel]="g.subGroupId" (ngModelChange)="setSubGroup(i, $event)" [name]="'sg' + i">
              <option value="" disabled>Choose</option>
              @for (s of subGroups(); track s.id) {
                <option [value]="s.id" [disabled]="isUsed(s.id, i)">{{ s['description'] }}</option>
              }
            </select>
          </label>
          <label class="narrow">Pick at least
            <input type="number" min="0" [ngModel]="g.min" (ngModelChange)="patch(i, { min: +$event })" [name]="'min' + i" />
          </label>
          <label class="narrow">Pick at most
            <input type="number" min="1" [ngModel]="g.max" (ngModelChange)="patch(i, { max: +$event })" [name]="'max' + i" />
          </label>
          <button type="button" class="link remove" (click)="remove(i)">Remove</button>
        </div>
        @if (g.subGroupId) {
          @let choices = itemsFor(g.subGroupId);
          @if (choices.length) {
            <div class="items">
              @for (it of choices; track it.id) {
                <label class="check">
                  <input type="checkbox" [checked]="g.itemIds.includes(it.id)" (change)="toggleItem(i, it.id)" />
                  {{ it['description'] }}
                </label>
              }
            </div>
            <p class="muted small">{{ g.itemIds.length }} of {{ choices.length }} items offered.</p>
          } @else {
            <p class="muted small">This sub-group has no active Package items yet. Add them under Menu Items with A-Type "Package".</p>
          }
        }
      </div>
    } @empty {
      <p class="muted">No rules yet.</p>
    }
    <button type="button" (click)="add()">Add sub-group rule</button>
  `,
  styles: `
    .rule { border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem; }
    .row { flex-wrap: nowrap; align-items: flex-end; }
    .narrow { flex: 0 0 110px; }
    .remove { margin-bottom: 0.9rem; white-space: nowrap; }
    .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0 1rem; }
    .small { font-size: 0.8rem; margin: 0.25rem 0 0; }
  `,
})
export class PackageGroupsEditor {
  readonly groups = model<PackageGroup[]>([]);
  readonly subGroups = input<MasterRecord[]>([]);
  readonly menuItems = input<MasterRecord[]>([]);
  private readonly packageItems = computed(() => this.menuItems().filter((m) => m['aType'] === 'package'));

  protected itemsFor(subGroupId: string) {
    return this.packageItems().filter((m) => m['subGroupId'] === subGroupId);
  }

  protected isUsed(subGroupId: string, except: number) {
    return this.groups().some((g, i) => i !== except && g.subGroupId === subGroupId);
  }

  protected add() {
    this.groups.update((gs) => [...gs, { subGroupId: '', min: 1, max: 1, itemIds: [] }]);
  }

  protected remove(i: number) {
    this.groups.update((gs) => gs.filter((_, j) => j !== i));
  }

  protected patch(i: number, change: Partial<PackageGroup>) {
    this.groups.update((gs) => gs.map((g, j) => (j === i ? { ...g, ...change } : g)));
  }

  protected setSubGroup(i: number, subGroupId: string) {
    // Offer every package item of the sub-group by default; the user can untick some.
    this.patch(i, { subGroupId, itemIds: this.itemsFor(subGroupId).map((m) => m.id) });
  }

  protected toggleItem(i: number, id: string) {
    const g = this.groups()[i];
    this.patch(i, { itemIds: g.itemIds.includes(id) ? g.itemIds.filter((x) => x !== id) : [...g.itemIds, id] });
  }
}
