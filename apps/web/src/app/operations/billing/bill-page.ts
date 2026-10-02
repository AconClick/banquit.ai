import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { ATYPE_LABELS } from '../booking/booking-api';
import { STATUS_LABELS, type ReservationStatus } from '../diary/diary-api';
import {
  BILL_STATUS_LABELS,
  Bill,
  BillLine,
  BillingApi,
  BillingView,
  CreditableLine,
  Discount,
  LineInput,
  LineSource,
  PAYMENT_MODES,
  PaymentMode,
  SOURCE_LABELS,
  money,
} from './billing-api';

/** A bill line being edited. taxIds null means "the item's default taxes" (worked out on save). */
interface Row {
  id?: string;
  source: LineSource;
  aType: 'package' | 'alacarte' | 'services';
  label: string;
  kind?: string;
  itemId?: string;
  hallId?: string;
  guaranteedPax: number | null;
  actualPax: number | null;
  qty: number | null;
  rate: number | null;
  taxInclusive: boolean;
  taxIds: string[] | null;
  discountType: 'percent' | 'amount';
  discountValue: number | null;
  discountReason: string;
  remark: string;
  priced: BillLine | null;
  open: boolean;
}

const ADDED: LineSource[] = ['running', 'hallHire', 'liquorLicence'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The bill for one booking (docs/workflows/billing-stages.md): proforma until a draft is started,
 * then the draft (actual pax, running charges, hall hire, licence, discounts), the final bill,
 * and settlement.
 */
@Component({
  selector: 'app-bill-page',
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './bill-page.html',
  styleUrl: './bill-page.css',
})
export class BillPage implements OnInit {
  private readonly api = inject(BillingApi);
  private readonly store = inject(MastersStore);
  /** The reservation id, from the route. */
  readonly id = input.required<string>();

  protected readonly view = signal<BillingView | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly lookups = signal<Record<string, MasterRecord[]>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dirty = signal(false);

  protected readonly statusLabels = BILL_STATUS_LABELS;
  protected readonly bookingLabels = STATUS_LABELS as Record<string, string>;
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly aTypes = ATYPE_LABELS;
  protected readonly modes = Object.entries(PAYMENT_MODES) as [PaymentMode, string][];
  protected readonly modeLabels = PAYMENT_MODES as Record<string, string>;

  protected billDiscount: { type: 'percent' | 'amount'; value: number | null; reason: string } = { type: 'percent', value: null, reason: '' };
  protected addItemId = '';
  protected payment = { kind: 'payment' as 'payment' | 'refund', amount: null as number | null, mode: 'cash' as PaymentMode, reference: '', date: today() };
  protected voidReason = '';
  protected confirmingVoid = false;
  /** The issue-a-credit-note form: open lines while it is shown. */
  protected readonly crediting = signal<CreditableLine[] | null>(null);
  protected credit = { reason: '', full: false, amounts: {} as Record<string, number | null> };
  protected cancellingCredit: string | null = null;
  protected cancelCreditReason = '';

  protected readonly bill = computed(() => this.view()?.bill ?? null);
  protected readonly isDraft = computed(() => this.bill()?.status === 'draft');
  protected readonly canPay = computed(() => ['finalised', 'partiallySettled'].includes(this.bill()?.status ?? ''));
  protected readonly property = computed(() => this.lookups()['property']?.find((p) => p.id === this.view()?.booking.propertyId));
  protected readonly currency = computed(() => this.bill()?.currency ?? this.view()?.currency ?? String(this.property()?.['currency'] ?? ''));
  /** Amounts to the bill's currency decimals: 3 for KWD, BHD and OMR. */
  protected readonly decimals = computed(() => this.bill()?.decimals ?? this.view()?.decimals ?? 2);
  protected readonly money = (n: number | null | undefined) => money(n, this.decimals());
  /** Taxes set up for this booking's property. */
  protected readonly taxes = computed(() => {
    const pid = this.view()?.booking.propertyId;
    return (this.lookups()['tax'] ?? []).filter((t) => (t['propertyIds'] as string[] | undefined)?.includes(pid ?? ''));
  });
  /** Items that can be added as running charges: ala-carte and service menu items, and modifiers. */
  protected readonly addable = computed(() => [
    ...(this.lookups()['menuItem'] ?? []).filter((i) => i['aType'] !== 'package').map((i) => ({
      key: `menuItem:${i.id}`, name: String(i['description']), aType: i['aType'] as 'alacarte' | 'services', rate: i['defaultRate'] as number,
    })),
    ...(this.lookups()['modifier'] ?? []).map((i) => ({ key: `modifier:${i.id}`, name: String(i['description']), aType: 'alacarte' as const, rate: i['rate'] as number })),
  ]);

  async ngOnInit() {
    try {
      const lists = await Promise.all(['property', 'hall', 'tax', 'menuItem', 'modifier'].map((k) => this.store.list(k, k === 'property' || k === 'hall' || k === 'tax')));
      this.lookups.set({ property: lists[0], hall: lists[1], tax: lists[2], menuItem: lists[3], modifier: lists[4] });
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private async load() {
    const v = await this.api.forReservation(this.id());
    this.view.set(v);
    this.fromBill(v.bill);
  }

  private fromBill(bill: Bill | null) {
    this.dirty.set(false);
    if (!bill) {
      this.rows.set([]);
      return;
    }
    this.rows.set(bill.lines.map((l) => ({
      id: l.id, source: l.source, aType: l.aType, label: l.label, kind: l.kind ?? undefined, itemId: l.itemId ?? undefined,
      hallId: l.hallId ?? undefined, guaranteedPax: l.guaranteedPax, actualPax: l.actualPax, qty: l.qty, rate: l.rate,
      taxInclusive: l.taxInclusive, taxIds: [...l.taxIds], discountType: l.lineDiscount?.type ?? 'percent',
      discountValue: l.lineDiscount?.value ?? null, discountReason: l.lineDiscount?.reason ?? '', remark: l.remark, priced: l, open: false,
    })));
    if (!this.payment.amount) this.payment.kind = bill.balance < 0 ? 'refund' : 'payment';
    this.billDiscount = { type: bill.billDiscount?.type ?? 'percent', value: bill.billDiscount?.value ?? null, reason: bill.billDiscount?.reason ?? '' };
  }

  private applyBill(bill: Bill) {
    this.view.update((v) => (v ? { ...v, bill } : v));
    this.fromBill(bill);
  }

  protected changed() {
    this.dirty.set(true);
    this.notice.set(null);
  }

  protected isAdded(r: Row) {
    return ADDED.includes(r.source);
  }

  protected hallName(id: string) {
    return String(this.lookups()['hall']?.find((h) => h.id === id)?.['description'] ?? 'Hall');
  }

  protected taxName(id: string) {
    return String(this.lookups()['tax']?.find((t) => t.id === id)?.['description'] ?? '(removed tax)');
  }

  protected toggleTax(r: Row, id: string, on: boolean) {
    const ids = new Set(r.taxIds ?? []);
    if (on) ids.add(id);
    else ids.delete(id);
    r.taxIds = [...ids];
    this.changed();
  }

  protected addItem() {
    const [kind, itemId] = this.addItemId.split(':');
    const item = this.addable().find((i) => i.key === this.addItemId);
    if (!item) return;
    this.push({ source: 'running', aType: item.aType, label: item.name, kind, itemId, qty: 1, rate: item.rate, taxIds: null });
    this.addItemId = '';
  }

  protected addCharge() {
    this.push({ source: 'running', aType: 'services', label: '', qty: 1, rate: null, taxIds: null, open: true });
  }

  protected addHallHire(h: { hallId: string; hours: number }) {
    this.push({ source: 'hallHire', aType: 'services', label: `Hall hire: ${this.hallName(h.hallId)}`, hallId: h.hallId, qty: 1, rate: null, taxIds: null, remark: '' });
  }

  protected addLicence() {
    this.push({ source: 'liquorLicence', aType: 'services', label: 'Liquor licence', qty: 1, rate: null, taxIds: null });
  }

  private push(r: Partial<Row> & Pick<Row, 'source' | 'aType' | 'label'>) {
    this.rows.update((rows) => [...rows, {
      guaranteedPax: null, actualPax: null, qty: 1, rate: 0, taxInclusive: false, taxIds: null, discountType: 'percent',
      discountValue: null, discountReason: '', remark: '', priced: null, open: false, ...r,
    }]);
    this.changed();
  }

  protected remove(r: Row) {
    this.rows.update((rows) => rows.filter((x) => x !== r));
    this.changed();
  }

  private lineInput(r: Row): LineInput {
    const discount: Discount | null = r.discountValue ? { type: r.discountType, value: r.discountValue, reason: r.discountReason } : null;
    const base: LineInput = { source: r.source, discount, remark: r.remark };
    if (r.taxIds) base.taxIds = r.taxIds;
    if (r.id) base.id = r.id;
    if (r.source === 'package') return { ...base, actualPax: r.actualPax ?? null };
    if (r.source === 'extra') return { ...base, qty: r.qty ?? 0 };
    return {
      ...base, qty: r.qty ?? 0, rate: r.rate ?? undefined, taxInclusive: r.taxInclusive,
      ...(r.id ? {} : { kind: r.kind, itemId: r.itemId, hallId: r.hallId }),
      ...(r.source === 'running' && !r.itemId ? { label: r.label, aType: r.aType as 'alacarte' | 'services' } : {}),
      ...(r.source === 'liquorLicence' ? { label: r.label } : {}),
    };
  }

  private async run(action: () => Promise<Bill | void>, done?: string) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const bill = await action();
      if (bill) this.applyBill(bill);
      if (done) this.notice.set(done);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected startDraft() {
    return this.run(() => this.api.draft(this.id()), 'Draft bill started from the booking.');
  }

  protected save() {
    const bill = this.bill();
    if (!bill) return;
    const d = this.billDiscount;
    const billDiscount = d.value ? { type: d.type, value: d.value, reason: d.reason } : null;
    return this.run(() => this.api.save(bill.id, this.rows().map((r) => this.lineInput(r)), billDiscount), 'Saved and recalculated.');
  }

  protected refresh() {
    const bill = this.bill();
    if (bill) return this.run(() => this.api.refresh(bill.id), 'Packages and booked items re-read from the booking.');
    return undefined;
  }

  protected finalise() {
    const bill = this.bill();
    if (!bill) return;
    return this.run(async () => {
      if (this.dirty()) await this.api.save(bill.id, this.rows().map((r) => this.lineInput(r)), this.billDiscount.value ? { ...this.billDiscount, value: this.billDiscount.value } : null);
      return this.api.finalise(bill.id);
    }, 'Bill finalised.');
  }

  protected pay() {
    const bill = this.bill();
    const p = this.payment;
    if (!bill || !p.amount) return;
    return this.run(async () => {
      const after = await this.api.pay(bill.id, { kind: p.kind, amount: p.amount!, mode: p.mode, date: p.date, reference: p.reference });
      this.payment = { kind: after.balance < 0 ? 'refund' : 'payment', amount: null, mode: 'cash', reference: '', date: today() };
      return after;
    }, p.kind === 'refund' ? 'Refund recorded.' : 'Payment recorded.');
  }

  protected fillBalance() {
    const b = this.bill()?.balance ?? 0;
    this.payment.kind = b < 0 ? 'refund' : 'payment';
    this.payment.amount = Math.abs(b);
  }

  protected async voidBill() {
    const bill = this.bill();
    if (!bill) return;
    await this.run(() => this.api.void(bill.id, this.voidReason), 'Bill voided. You can start a new draft.');
    if (!this.error()) {
      this.confirmingVoid = false;
      this.voidReason = '';
      await this.load();
    }
  }

  protected async startCredit() {
    const bill = this.bill();
    if (!bill) return;
    this.error.set(null);
    try {
      const { lines } = await this.api.creditable(bill.id);
      this.credit = { reason: '', full: false, amounts: {} };
      this.crediting.set(lines);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected creditTotal() {
    return Object.values(this.credit.amounts).reduce<number>((s, a) => s + (Number(a) || 0), 0);
  }

  protected issueCredit() {
    const bill = this.bill();
    if (!bill) return;
    const c = this.credit;
    const lines = Object.entries(c.amounts).filter(([, a]) => Number(a) > 0).map(([lineId, a]) => ({ lineId, amount: Number(a) }));
    return this.run(async () => {
      const res = await this.api.issueCredit(bill.id, c.full ? { reason: c.reason, full: true } : { reason: c.reason, lines });
      this.crediting.set(null);
      return res.bill;
    }, 'Credit note issued. Refund the guest from Settlement if money is now due back.');
  }

  protected cancelCredit(id: string) {
    return this.run(async () => {
      const res = await this.api.cancelCredit(id, this.cancelCreditReason);
      this.cancellingCredit = null;
      return res.bill;
    }, 'Credit note cancelled.');
  }

  protected bookingStatus(s: string) {
    return this.bookingLabels[s as ReservationStatus] ?? s;
  }
}
