import { Component, OnInit, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MasterRecord, MastersStore } from './masters-store';

const KEY = 'banquet.master.property';

/** Property chooser for per-property screens; remembers the last choice. */
@Component({
  selector: 'app-property-picker',
  imports: [FormsModule],
  template: `
    <label class="inline">Property
      <select name="property" [ngModel]="propertyId()" (ngModelChange)="pick($event)">
        @for (p of properties(); track p.id) { <option [value]="p.id">{{ p['name'] }}</option> }
      </select>
    </label>
    @if (loaded() && !properties().length) { <p class="muted">Add a property first (Organisation › Properties).</p> }
  `,
})
export class PropertyPicker implements OnInit {
  private readonly store = inject(MastersStore);
  readonly propertyId = model('');
  protected readonly properties = signal<MasterRecord[]>([]);
  protected readonly loaded = signal(false);

  async ngOnInit() {
    const list = await this.store.list('property');
    this.properties.set(list);
    this.loaded.set(true);
    let saved = '';
    try { saved = localStorage.getItem(KEY) ?? ''; } catch { /* storage may be blocked */ }
    const first = list.find((p) => p.id === saved) ?? list[0];
    if (first) this.propertyId.set(first.id);
  }

  protected pick(id: string) {
    this.propertyId.set(id);
    try { localStorage.setItem(KEY, id); } catch { /* storage may be blocked */ }
  }
}
