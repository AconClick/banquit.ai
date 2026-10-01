import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { STATUS_LABELS, toDate } from '../diary/diary-api';
import { ATYPE_LABELS, BookingApi, BookingDetails, MenuOptions, money, SETTLEMENT_MODES, SettlementMode } from './booking-api';

interface PackageDraft {
  packageId: string;
  pax: number;
  choices: string[];
}

interface ExtraDraft {
  kind: 'menuItem' | 'modifier';
  itemId: string;
  qty: number;
  note: string;
}

/** Everything about one booking: menu choices, extras, the proforma estimate and advances. */
@Component({
  selector: 'app-booking-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './booking-page.html',
  styleUrl: './booking-page.css',
})
export class BookingPage implements OnInit {
  private readonly api = inject(BookingApi);
  private readonly store = inject(MastersStore);
  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly d = signal<BookingDetails | null>(null);
  protected readonly options = signal<MenuOptions | null>(null);
  protected readonly lookups = signal<Record<string, MasterRecord[]>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly editingMenu = signal(false);
  protected readonly labels = STATUS_LABELS;
  protected readonly aTypes = ATYPE_LABELS;
  protected readonly modes = Object.entries(SETTLEMENT_MODES) as [SettlementMode, string][];
  protected readonly money = money;

  protected packages: PackageDraft[] = [];
  protected extras: ExtraDraft[] = [];
  protected amendmentReasonId = '';
  protected addPackageId = '';
  protected addExtraKey = '';
  protected receipt = { amount: null as number | null, mode: 'cash' as SettlementMode, date: toDate(new Date()), reference: '' };

  protected readonly editable = computed(() => ['enquiry', 'provisional', 'waitlisted', 'confirmed', 'inFunction'].includes(this.d()?.status ?? ''));
  protected readonly needsAmendReason = computed(() => ['provisional', 'confirmed', 'inFunction'].includes(this.d()?.status ?? ''));
  protected readonly currency = computed(() => {
    const p = this.lookups()['property']?.find((x) => x.id === this.d()?.propertyId);
    return p ? String(p['currency'] ?? '') : '';
  });

  async ngOnInit() {
    try {
      const [d, options, ...lists] = await Promise.all([
        this.api.details(this.id()),
        this.api.menuOptions(this.id()),
        ...['property', 'hall', 'functionType', 'seatingStyle', 'amendmentReason'].map((k) => this.store.list(k, true)),
      ]);
      this.lookups.set({ property: lists[0], hall: lists[1], functionType: lists[2], seatingStyle: lists[3], amendmentReason: lists[4] });
      this.options.set(options);
      this.show(d);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected name(kind: string, id: string | null | undefined, field = 'description') {
    const r = id ? this.lookups()[kind]?.find((x) => x.id === id) : undefined;
    return r ? String(r[field]) : '';
  }

  protected option(packageId: string) {
    return this.options()?.packages.find((p) => p.id === packageId);
  }

  protected extraOption(e: { kind: string; itemId: string }) {
    return this.options()?.extras.find((x) => x.kind === e.kind && x.id === e.itemId);
  }

  protected picked(p: PackageDraft, items: { id: string }[]) {
    return p.choices.filter((c) => items.some((i) => i.id === c)).length;
  }

  protected toggleChoice(p: PackageDraft, id: string) {
    const at = p.choices.indexOf(id);
    if (at >= 0) p.choices.splice(at, 1);
    else p.choices.push(id);
  }

  protected addPackage() {
    if (!this.addPackageId || this.packages.some((p) => p.packageId === this.addPackageId)) return;
    this.packages.push({ packageId: this.addPackageId, pax: this.d()!.guaranteedPax, choices: [] });
    this.addPackageId = '';
  }

  protected addExtra() {
    const [kind, itemId] = this.addExtraKey.split(':') as ['menuItem' | 'modifier', string];
    if (!itemId || this.extras.some((e) => e.kind === kind && e.itemId === itemId)) return;
    this.extras.push({ kind, itemId, qty: 1, note: '' });
    this.addExtraKey = '';
  }

  protected startMenu() {
    this.resetDrafts(this.d()!);
    this.amendmentReasonId = '';
    this.editingMenu.set(true);
  }

  protected saveMenu() {
    this.run('Menu saved.', async () => {
      const d = await this.api.saveMenu(this.id(), {
        packages: this.packages.map((p) => ({ packageId: p.packageId, pax: Number(p.pax), choices: p.choices })),
        extras: this.extras.map((e) => ({ kind: e.kind, itemId: e.itemId, qty: Number(e.qty), note: e.note })),
        amendmentReasonId: this.amendmentReasonId || undefined,
      });
      this.editingMenu.set(false);
      this.show(d);
    });
  }

  protected addReceipt() {
    const r = this.receipt;
    this.run('Advance recorded.', async () => {
      this.show(await this.api.addReceipt(this.id(), { amount: Number(r.amount), mode: r.mode, date: r.date, reference: r.reference }));
      this.receipt = { ...this.receipt, amount: null, reference: '' };
    });
  }

  protected chosenNames(p: BookingDetails['packages'][number]) {
    return p.choices.map((c) => c.name).join(', ');
  }

  protected modeLabel(mode: SettlementMode) {
    return SETTLEMENT_MODES[mode] ?? mode;
  }

  private show(d: BookingDetails) {
    this.d.set(d);
    this.resetDrafts(d);
  }

  private resetDrafts(d: BookingDetails) {
    this.packages = d.packages.map((p) => ({ packageId: p.packageId, pax: p.pax, choices: p.choices.map((c) => c.id) }));
    this.extras = d.extras.map((e) => ({ kind: e.kind, itemId: e.itemId, qty: e.qty, note: e.note }));
  }

  private run(done: string, work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    work()
      .then(() => this.notice.set(done))
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }
}
