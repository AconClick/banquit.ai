import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { FieldDef, MasterDef, MasterRecord, MastersStore, PackageGroup } from './masters-store';
import { PackageGroupsEditor } from './package-groups-editor';

/** One screen for every master in the Master Data Set, driven by its definition from the server. */
@Component({
  selector: 'app-master-page',
  imports: [FormsModule, PackageGroupsEditor],
  template: `
    @if (def(); as d) {
      <div class="page-head">
        <h1>{{ d.label }}</h1>
        <button class="primary" (click)="edit(null)">New {{ d.singular.toLowerCase() }}</button>
      </div>
      @if (error(); as e) {
        <p class="alert error" role="alert">{{ e }}</p>
      }

      @if (editing()) {
        <form class="card form" (ngSubmit)="save()">
          <h2>{{ editingId ? 'Edit' : 'New' }} {{ d.singular.toLowerCase() }}</h2>
          @for (f of d.fields; track f.key) {
            @switch (f.type) {
              @case ('boolean') {
                <label class="check"><input type="checkbox" [name]="f.key" [(ngModel)]="form[f.key]" /> {{ f.label }}</label>
              }
              @case ('enum') {
                <label [for]="'f-' + f.key">{{ label(f) }}</label>
                <select [id]="'f-' + f.key" [name]="f.key" [(ngModel)]="form[f.key]">
                    <option value="" disabled>Choose</option>
                    @for (o of options(f); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                </select>
              }
              @case ('ref') {
                <label [for]="'f-' + f.key">{{ label(f) }}</label>
                <select [id]="'f-' + f.key" [name]="f.key" [(ngModel)]="form[f.key]">
                    <option value="" [disabled]="f.required">{{ f.required ? 'Choose' : 'None' }}</option>
                    @for (r of refOptions(f); track r.id) { <option [value]="r.id">{{ r.name }}</option> }
                </select>
              }
              @case ('refs') {
                <fieldset>
                  <legend>{{ label(f) }}</legend>
                  @for (r of refOptions(f); track r.id) {
                    <label class="check">
                      <input type="checkbox" [checked]="asList(form[f.key]).includes(r.id)" (change)="toggle(f.key, r.id)" /> {{ r.name }}
                    </label>
                  } @empty {
                    <p class="muted">Nothing to choose yet.</p>
                  }
                </fieldset>
              }
              @case ('packageGroups') {
                <fieldset>
                  <legend>{{ label(f) }}</legend>
                  <app-package-groups-editor
                    [(groups)]="packageGroups"
                    [subGroups]="refs()['subGroup'] ?? []"
                    [menuItems]="refs()['menuItem'] ?? []"
                  />
                </fieldset>
              }
              @default {
                <label>{{ label(f) }}
                  <input
                    [name]="f.key"
                    [type]="f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'"
                    [attr.maxlength]="f.maxLength ?? null"
                    [attr.min]="f.min ?? null"
                    [attr.max]="f.max ?? null"
                    [attr.step]="f.type === 'number' ? (f.integer ? 1 : 'any') : null"
                    [placeholder]="f.patternHint ?? ''"
                    [(ngModel)]="form[f.key]"
                  />
                </label>
              }
            }
            @if (f.hint) { <p class="muted hint">{{ f.hint }}</p> }
          }
          <div class="actions">
            <button type="button" (click)="editing.set(false)">Cancel</button>
            <button class="primary" [disabled]="busy()">Save</button>
          </div>
        </form>
      }

      <label class="check show-inactive">
        <input type="checkbox" [ngModel]="showInactive()" (ngModelChange)="showInactive.set($event)" name="inactive" /> Show inactive
      </label>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              @for (f of listFields(); track f.key) { <th>{{ f.label }}</th> }
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (r of visible(); track r.id) {
              <tr [class.inactive]="!r.active">
                @for (f of listFields(); track f.key) { <td>{{ show(f, r[f.key]) }}</td> }
                <td class="right nowrap">
                  @if (r.active) {
                    <button class="link" (click)="edit(r)">Edit</button>
                    <button class="link" (click)="setActive(r, false)">Deactivate</button>
                  } @else {
                    <button class="link" (click)="setActive(r, true)">Activate</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="listFields().length + 1" class="muted">No {{ d.label.toLowerCase() }} yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    } @else if (error(); as e) {
      <p class="alert error" role="alert">{{ e }}</p>
    }
  `,
  styles: `
    .hint { font-size: 0.8rem; margin: -0.6rem 0 0.9rem; }
    .show-inactive { margin: 0 0 0.5rem; font-size: 0.85rem; }
  `,
})
export class MasterPage {
  private readonly store = inject(MastersStore);
  /** Route parameter. */
  readonly kind = input.required<string>();

  protected readonly def = signal<MasterDef | null>(null);
  protected readonly records = signal<MasterRecord[]>([]);
  /** Active records of every master this one refers to, by kind. */
  protected readonly refs = signal<Record<string, MasterRecord[]>>({});
  /** All records (incl. inactive) of referred masters, for showing names in the table. */
  private readonly refNames = signal<Record<string, Map<string, string>>>({});
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showInactive = signal(false);

  protected readonly listFields = computed(() => this.def()?.fields.filter((f) => f.list) ?? []);
  protected readonly visible = computed(() => this.records().filter((r) => r.active || this.showInactive()));

  protected editingId: string | null = null;
  protected form: Record<string, unknown> = {};
  protected packageGroups: PackageGroup[] = [];

  constructor() {
    effect(() => void this.load(this.kind()));
  }

  private async load(kind: string) {
    this.editing.set(false);
    this.error.set(null);
    this.def.set(null);
    try {
      const def = (await this.store.defs()).find((d) => d.kind === kind);
      if (!def) throw new Error('This screen does not exist.');
      const refKinds = new Set<string>();
      for (const f of def.fields) {
        if (f.refKind) refKinds.add(f.refKind);
        if (f.type === 'packageGroups') ['subGroup', 'menuItem'].forEach((k) => refKinds.add(k));
      }
      const [records, ...refLists] = await Promise.all([
        this.store.list(kind, true),
        ...[...refKinds].map((k) => this.store.list(k, true)),
      ]);
      const defs = this.store.definitions();
      const refs: Record<string, MasterRecord[]> = {};
      const names: Record<string, Map<string, string>> = {};
      [...refKinds].forEach((k, i) => {
        const display = defs.find((d) => d.kind === k)?.display ?? 'description';
        refs[k] = refLists[i].filter((r) => r.active);
        names[k] = new Map(refLists[i].map((r) => [r.id, String(r[display] ?? '')]));
      });
      this.refs.set(refs);
      this.refNames.set(names);
      this.records.set(records);
      this.def.set(def);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected label(f: FieldDef) {
    return f.required ? f.label : `${f.label} (optional)`;
  }

  protected options(f: FieldDef) {
    return Object.entries(f.options ?? {}).map(([value, label]) => ({ value, label }));
  }

  protected refOptions(f: FieldDef) {
    const names = this.refNames()[f.refKind!];
    return (this.refs()[f.refKind!] ?? []).map((r) => ({ id: r.id, name: names?.get(r.id) ?? r.id }));
  }

  protected asList(v: unknown): string[] {
    return Array.isArray(v) ? (v as string[]) : [];
  }

  protected toggle(key: string, id: string) {
    const list = this.asList(this.form[key]);
    this.form[key] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  protected show(f: FieldDef, value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    switch (f.type) {
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'enum':
        return f.options?.[value as string] ?? String(value);
      case 'ref':
        return this.refNames()[f.refKind!]?.get(value as string) ?? '';
      case 'refs':
        return this.asList(value).map((id) => this.refNames()[f.refKind!]?.get(id) ?? '').join(', ');
      case 'number':
        return (value as number).toLocaleString(undefined, { maximumFractionDigits: 4 });
      default:
        return String(value);
    }
  }

  protected edit(record: MasterRecord | null) {
    const def = this.def()!;
    this.editingId = record?.id ?? null;
    this.form = {};
    for (const f of def.fields) {
      // Records saved before a field existed get its default too (e.g. a property's time zone).
      const v = record ? (record[f.key] ?? f.default) : f.default;
      this.form[f.key] = v ?? (f.type === 'refs' ? [] : f.type === 'boolean' ? false : '');
    }
    this.packageGroups = structuredClone((record?.['groups'] as PackageGroup[] | undefined) ?? []);
    this.error.set(null);
    this.editing.set(true);
  }

  protected async save() {
    const def = this.def()!;
    const values: Record<string, unknown> = { ...this.form };
    for (const f of def.fields) {
      if (f.type === 'packageGroups') values[f.key] = this.packageGroups;
      if (values[f.key] === '') values[f.key] = null;
    }
    await this.act(() =>
      this.editingId ? this.store.update(def.kind, this.editingId, values) : this.store.create(def.kind, values),
    );
    if (!this.error()) this.editing.set(false);
  }

  protected setActive(record: MasterRecord, active: boolean) {
    return this.act(() => this.store.setActive(this.def()!.kind, record.id, active));
  }

  private async act(work: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
      this.records.set(await this.store.list(this.def()!.kind, true));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
