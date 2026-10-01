import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.interceptor';
import { MasterRecord } from '../../master/masters-store';
import { BookingApi, BookingDetails, money } from '../booking/booking-api';
import {
  DiaryApi,
  HallBlock,
  NEXT_STATUSES,
  Reservation,
  ReservationInput,
  ReservationStatus,
  STATUS_LABELS,
  addDays,
} from './diary-api';

export type PanelRequest =
  | { mode: 'new'; hallId: string; start: string; end: string }
  | { mode: 'view'; reservation: Reservation }
  | { mode: 'block-view'; block: HallBlock };

type Mode = 'new' | 'view' | 'edit' | 'block-view';

interface Form {
  kind: 'booking' | 'block';
  status: ReservationStatus;
  hostName: string;
  contactName: string;
  phone: string;
  email: string;
  functionTypeId: string;
  seatingStyleId: string;
  guaranteedPax: number | null;
  expectedMaxPax: number | null;
  hallId: string;
  date: string;
  from: string;
  to: string;
  optionDate: string;
  notes: string;
  amendmentReasonId: string;
  blockReasonId: string;
}

/** Side panel for taking a booking, viewing and changing it, and blocking a hall. */
@Component({
  selector: 'app-booking-panel',
  imports: [FormsModule, RouterLink],
  templateUrl: './booking-panel.html',
  styleUrl: './booking-panel.css',
})
export class BookingPanel implements OnInit {
  private readonly api = inject(DiaryApi);
  private readonly bookingApi = inject(BookingApi);
  readonly request = input.required<PanelRequest>();
  readonly propertyId = input.required<string>();
  readonly halls = input.required<{ id: string; name: string; capacity: number }[]>();
  readonly lookups = input.required<Record<string, MasterRecord[]>>();
  readonly closed = output<boolean>();

  protected readonly labels = STATUS_LABELS;
  protected readonly createStatuses: ReservationStatus[] = ['enquiry', 'provisional', 'waitlisted', 'confirmed'];
  protected readonly mode = signal<Mode>('new');
  protected readonly reservation = signal<Reservation | null>(null);
  protected readonly block = signal<HallBlock | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Status chosen from the action buttons that needs a reason or date before it is applied. */
  protected readonly pending = signal<ReservationStatus | null>(null);
  protected pendingReasonId = '';
  protected pendingOptionDate = '';
  protected pendingNote = '';
  protected pendingCharge: number | null = null;
  protected pendingActualPax: number | null = null;
  /** Proforma, advance and cancellation figures, loaded when a status change needs them. */
  protected readonly details = signal<BookingDetails | null>(null);
  protected readonly money = (n: number | null | undefined) => money(n, this.details()?.decimals ?? 2);
  private changed = false;
  protected form: Form = this.blank();

  protected readonly nextStatuses = computed(() => NEXT_STATUSES[this.reservation()?.status ?? 'lost'] ?? []);
  protected readonly editable = computed(() =>
    ['enquiry', 'provisional', 'waitlisted', 'confirmed'].includes(this.reservation()?.status ?? ''),
  );

  ngOnInit() {
    const r = this.request();
    if (r.mode === 'new') {
      this.form = { ...this.blank(), hallId: r.hallId, date: r.start.slice(0, 10), from: r.start.slice(11), to: r.end.slice(11) };
      this.mode.set('new');
    } else if (r.mode === 'view') {
      this.reservation.set(r.reservation);
      this.mode.set('view');
    } else {
      this.block.set(r.block);
      this.mode.set('block-view');
    }
  }

  protected name(kind: string, id: string | null | undefined, field = 'description') {
    if (!id) return '';
    const rec = this.lookups()[kind]?.find((r) => r.id === id);
    return rec ? String(rec[field]) : '';
  }

  protected hallName(id: string) {
    return this.halls().find((h) => h.id === id)?.name ?? '';
  }

  protected when(start: string, end: string) {
    const sameDay = start.slice(0, 10) === end.slice(0, 10) || end === `${addDays(start.slice(0, 10), 1)}T00:00`;
    return sameDay ? `${start.slice(0, 10)} ${start.slice(11)}–${end.slice(11)}` : `${start.replace('T', ' ')} – ${end.replace('T', ' ')}`;
  }

  protected close() {
    this.closed.emit(this.changed);
  }

  protected startEdit() {
    const r = this.reservation()!;
    const slot = r.slots[0];
    this.form = {
      ...this.blank(),
      status: r.status,
      hostName: r.hostName,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      functionTypeId: r.functionTypeId,
      seatingStyleId: r.seatingStyleId ?? '',
      guaranteedPax: r.guaranteedPax,
      expectedMaxPax: r.expectedMaxPax,
      hallId: slot.hallId,
      date: slot.start.slice(0, 10),
      from: slot.start.slice(11),
      to: slot.end.slice(11),
      optionDate: r.optionDate ?? '',
      notes: r.notes,
    };
    this.error.set(null);
    this.mode.set('edit');
  }

  protected needsAmendReason() {
    return this.mode() === 'edit' && ['provisional', 'confirmed'].includes(this.reservation()?.status ?? '');
  }

  protected save() {
    const f = this.form;
    if (!f.date || !f.from || !f.to) return this.error.set('Choose the date and the from and to times.');
    const start = `${f.date}T${f.from}`;
    // A "to" time at or before "from" means the function runs past midnight.
    const end = f.to > f.from ? `${f.date}T${f.to}` : `${addDays(f.date, 1)}T${f.to}`;
    this.run(async () => {
      if (f.kind === 'block') {
        await this.api.block({ hallId: f.hallId, start, end, reasonId: f.blockReasonId, notes: f.notes });
        this.changed = true;
        return this.close();
      }
      const existing = this.reservation();
      const slots = existing && this.mode() === 'edit' ? [{ hallId: f.hallId, start, end }, ...existing.slots.slice(1)] : [{ hallId: f.hallId, start, end }];
      const input: ReservationInput = {
        propertyId: this.propertyId(),
        status: f.status,
        hostName: f.hostName,
        contactName: f.contactName,
        phone: f.phone,
        email: f.email,
        functionTypeId: f.functionTypeId,
        seatingStyleId: f.seatingStyleId || undefined,
        guaranteedPax: Number(f.guaranteedPax),
        expectedMaxPax: Number(f.expectedMaxPax),
        slots,
        optionDate: f.status === 'provisional' && f.optionDate ? f.optionDate : undefined,
        notes: f.notes,
        amendmentReasonId: f.amendmentReasonId || undefined,
      };
      const saved = existing && this.mode() === 'edit' ? await this.api.update(existing.id, input) : await this.api.create(input);
      this.changed = true;
      this.reservation.set(saved);
      this.mode.set('view');
    });
  }

  /**
   * Cancel needs a reason and shows the charge; Confirm shows the advance and may take a note;
   * Provisional may take an option date; the rest apply at once.
   */
  protected choose(status: ReservationStatus) {
    this.error.set(null);
    if (status === 'cancelled' || status === 'provisional' || status === 'confirmed' || status === 'completed') {
      this.pending.set(status);
      this.pendingReasonId = '';
      this.pendingOptionDate = '';
      this.pendingNote = '';
      this.pendingCharge = null;
      this.pendingActualPax = null;
      this.details.set(null);
      if (status === 'cancelled' || status === 'confirmed') {
        this.bookingApi.details(this.reservation()!.id).then((d) => {
          this.details.set(d);
          this.pendingCharge = d.cancellationPreview?.computed ?? null;
        }).catch((err) => this.error.set(errorMessage(err)));
      }
      return;
    }
    this.apply(status);
  }

  protected apply(status: ReservationStatus) {
    const note = this.pendingNote.trim() || undefined;
    const preview = this.details()?.cancellationPreview;
    const extra = status === 'cancelled'
      ? {
        reasonId: this.pendingReasonId, note,
        cancellationCharge: preview && this.pendingCharge !== null && Number(this.pendingCharge) !== preview.computed ? Number(this.pendingCharge) : undefined,
      }
      : status === 'confirmed' ? { note }
      : status === 'completed' ? { actualPax: Number(this.pendingActualPax) }
      : status === 'provisional' && this.pendingOptionDate ? { optionDate: this.pendingOptionDate } : {};
    this.run(async () => {
      const saved = await this.api.setStatus(this.reservation()!.id, status, extra);
      this.changed = true;
      this.pending.set(null);
      this.reservation.set(saved);
    });
  }

  protected actionLabel(s: ReservationStatus) {
    const labels: Partial<Record<ReservationStatus, string>> = {
      cancelled: 'Cancel booking', lost: 'Mark lost', inFunction: 'Start function', completed: 'Complete function',
    };
    return labels[s] ?? `Make ${STATUS_LABELS[s].toLowerCase()}`;
  }

  protected removeBlock() {
    this.run(async () => {
      await this.api.unblock(this.block()!.id);
      this.changed = true;
      this.close();
    });
  }

  private run(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    work()
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  private blank(): Form {
    return {
      kind: 'booking', status: 'enquiry', hostName: '', contactName: '', phone: '', email: '', functionTypeId: '',
      seatingStyleId: '', guaranteedPax: null, expectedMaxPax: null, hallId: '', date: '', from: '', to: '',
      optionDate: '', notes: '', amendmentReasonId: '', blockReasonId: '',
    };
  }
}
