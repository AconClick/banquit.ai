import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.interceptor';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { BookingPanel, PanelRequest } from './booking-panel';
import {
  DiaryApi,
  DiaryData,
  HallBlock,
  Reservation,
  ReservationStatus,
  STATUS_LABELS,
  addDays,
  minutesOfDay,
  parseDate,
  timeOf,
  toDate,
  weekStart,
} from './diary-api';

const HOUR_PX = 40;
const SNAP_MIN = 30;
const DAYS = 7;
const PROPERTY_KEY = 'banquet.diary.property';

interface DiaryEvent {
  key: string;
  kind: 'reservation' | 'block';
  status: ReservationStatus | 'block';
  title: string;
  subtitle: string;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  reservation?: Reservation;
  block?: HallBlock;
}

interface Column {
  date: string;
  hallId: string;
  hallName: string;
  events: DiaryEvent[];
}

/**
 * Reservation Diary: all halls of a property for one week, side by side. Drag down a hall's column
 * to take a booking; click a booking to see and change it.
 */
@Component({
  selector: 'app-diary',
  imports: [FormsModule, BookingPanel],
  templateUrl: './diary.html',
  styleUrl: './diary.css',
})
export class Diary implements OnInit {
  private readonly api = inject(DiaryApi);
  private readonly masters = inject(MastersStore);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly hourPx = HOUR_PX;
  protected readonly hours = Array.from({ length: 24 }, (_, h) => h);
  protected readonly labels = STATUS_LABELS;
  protected readonly legend: { status: ReservationStatus | 'block'; label: string }[] = [
    { status: 'confirmed', label: 'Confirmed' },
    { status: 'provisional', label: 'Provisional' },
    { status: 'waitlisted', label: 'Waitlisted' },
    { status: 'enquiry', label: 'Enquiry' },
    { status: 'cancelled', label: 'Cancelled' },
    { status: 'block', label: 'Area block' },
  ];

  protected readonly properties = signal<MasterRecord[]>([]);
  protected readonly propertyId = signal('');
  protected readonly from = signal(weekStart(toDate(new Date())));
  protected readonly hallFilter = signal('');
  protected readonly showCancelled = signal(false);
  protected readonly data = signal<DiaryData | null>(null);
  protected readonly lookups = signal<Record<string, MasterRecord[]>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly panel = signal<PanelRequest | null>(null);
  /** Cells being dragged over: column key and start / end minutes. */
  protected readonly drag = signal<{ col: string; a: number; b: number } | null>(null);

  protected readonly today = toDate(new Date());
  protected readonly days = computed(() => Array.from({ length: DAYS }, (_, i) => addDays(this.from(), i)));
  protected readonly halls = computed(() => {
    const halls = this.data()?.halls ?? [];
    return this.hallFilter() ? halls.filter((h) => h.id === this.hallFilter()) : halls;
  });
  protected readonly rangeLabel = computed(() => {
    const fmt = (s: string) => parseDate(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmt(this.from())} – ${fmt(addDays(this.from(), DAYS - 1))}`;
  });
  protected readonly columns = computed<Column[]>(() => {
    const data = this.data();
    if (!data) return [];
    const functionNames = new Map((this.lookups()['functionType'] ?? []).map((f) => [f.id, String(f['description'])]));
    const reasonNames = new Map((this.lookups()['hallBlockReason'] ?? []).map((f) => [f.id, String(f['description'])]));
    const cols: Column[] = [];
    for (const date of this.days()) {
      for (const hall of this.halls()) {
        const dayStart = `${date}T00:00`;
        const dayEnd = `${addDays(date, 1)}T00:00`;
        const clip = (start: string, end: string) => {
          const a = start <= dayStart ? 0 : minutesOfDay(start);
          const b = end >= dayEnd ? 1440 : minutesOfDay(end);
          return { top: (a / 60) * HOUR_PX, height: Math.max(((b - a) / 60) * HOUR_PX, 14), a, b };
        };
        const events: (DiaryEvent & { a: number; b: number })[] = [];
        for (const r of data.reservations) {
          if (r.status === 'cancelled' && !this.showCancelled()) continue;
          for (const s of r.slots) {
            if (s.hallId !== hall.id || s.start >= dayEnd || s.end <= dayStart) continue;
            const c = clip(s.start, s.end);
            const fn = functionNames.get(r.functionTypeId);
            events.push({
              key: `${r.id}-${s.start}`, kind: 'reservation', status: r.status, reservation: r, lane: 0, lanes: 1, ...c,
              title: `${r.status === 'confirmed' ? '# ' : ''}${r.hostName}${fn ? ', ' + fn : ''}`,
              subtitle: `${s.start.slice(11)}–${s.end.slice(11)} · ${r.guaranteedPax} pax · ${STATUS_LABELS[r.status]}`,
            });
          }
        }
        for (const b of data.blocks) {
          if (b.hallId !== hall.id || b.start >= dayEnd || b.end <= dayStart) continue;
          const c = clip(b.start, b.end);
          events.push({
            key: b.id, kind: 'block', status: 'block', block: b, lane: 0, lanes: 1, ...c,
            title: `Blocked: ${reasonNames.get(b.reasonId) ?? ''}`,
            subtitle: `${b.start.slice(11)}–${b.end.slice(11)}${b.notes ? ' · ' + b.notes : ''}`,
          });
        }
        cols.push({ date, hallId: hall.id, hallName: hall.name, events: this.layout(events) });
      }
    }
    return cols;
  });

  async ngOnInit() {
    try {
      const [properties, functionType, seatingStyle, cancellationReason, amendmentReason, hallBlockReason] = await Promise.all(
        ['property', 'functionType', 'seatingStyle', 'cancellationReason', 'amendmentReason', 'hallBlockReason'].map((k) =>
          this.masters.list(k),
        ),
      );
      this.properties.set(properties);
      this.lookups.set({ functionType, seatingStyle, cancellationReason, amendmentReason, hallBlockReason });
      let remembered = '';
      try {
        remembered = localStorage.getItem(PROPERTY_KEY) ?? '';
      } catch {
        // ignore
      }
      const first = properties.find((p) => p.id === remembered) ?? properties[0];
      if (!first) {
        this.error.set('No property is set up yet. Add a property and its halls in the Master panel first.');
        return;
      }
      this.propertyId.set(first.id);
      await this.load();
      // Start the view at 08:00, where most functions are.
      this.scroller()?.nativeElement.scrollTo({ top: 8 * HOUR_PX });
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async load() {
    this.error.set(null);
    try {
      this.data.set(await this.api.diary(this.propertyId(), this.from(), DAYS));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected changeProperty(id: string) {
    this.propertyId.set(id);
    this.hallFilter.set('');
    try {
      localStorage.setItem(PROPERTY_KEY, id);
    } catch {
      // ignore
    }
    void this.load();
  }

  protected move(weeks: number) {
    this.from.set(weeks === 0 ? weekStart(this.today) : addDays(this.from(), weeks * DAYS));
    void this.load();
  }

  protected goTo(date: string) {
    if (!date) return;
    this.from.set(weekStart(date));
    void this.load();
  }

  protected colKey(c: Column) {
    return `${c.date}|${c.hallId}`;
  }

  protected dayLabel(date: string) {
    return parseDate(date).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // Drag to select: press in a hall's column, drag down, release to open the booking form.
  protected startDrag(ev: PointerEvent, col: Column) {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('.event')) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const m = this.minuteAt(ev);
    this.drag.set({ col: this.colKey(col), a: m, b: m + SNAP_MIN });
    ev.preventDefault();
  }

  protected moveDrag(ev: PointerEvent) {
    const d = this.drag();
    if (!d) return;
    const m = this.minuteAt(ev);
    this.drag.set({ ...d, b: m >= d.a ? m + SNAP_MIN : m });
  }

  protected endDrag(col: Column) {
    const d = this.drag();
    this.drag.set(null);
    if (!d || d.col !== this.colKey(col)) return;
    const [a, b] = d.b > d.a ? [d.a, d.b] : [d.b, d.a + SNAP_MIN];
    const end = b >= 1440 ? `${addDays(col.date, 1)}T00:00` : `${col.date}T${timeOf(b)}`;
    this.panel.set({ mode: 'new', hallId: col.hallId, start: `${col.date}T${timeOf(a)}`, end });
  }

  protected dragBox(col: Column) {
    const d = this.drag();
    if (!d || d.col !== this.colKey(col)) return null;
    const [a, b] = d.b > d.a ? [d.a, d.b] : [d.b, d.a + SNAP_MIN];
    return { top: (a / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX, label: `${timeOf(a)}–${timeOf(Math.min(b, 1440))}` };
  }

  protected open(e: DiaryEvent) {
    if (e.reservation) this.panel.set({ mode: 'view', reservation: e.reservation });
    else if (e.block) this.panel.set({ mode: 'block-view', block: e.block });
  }

  protected newBooking() {
    const hall = this.halls()[0];
    if (!hall) return;
    const date = this.days().includes(this.today) ? this.today : this.from();
    this.panel.set({ mode: 'new', hallId: hall.id, start: `${date}T12:00`, end: `${date}T16:00` });
  }

  protected async closed(changed: boolean) {
    this.panel.set(null);
    if (changed) await this.load();
  }

  private minuteAt(ev: PointerEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const y = Math.min(Math.max(ev.clientY - rect.top, 0), rect.height - 1);
    return Math.floor(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
  }

  /** Puts overlapping events side by side (enquiries and waitlists may overlap a held booking). */
  private layout(events: (DiaryEvent & { a: number; b: number })[]): DiaryEvent[] {
    events.sort((x, y) => x.a - y.a || y.b - x.b);
    const laneEnds: number[] = [];
    let group: (DiaryEvent & { a: number; b: number })[] = [];
    let groupEnd = -1;
    const flush = () => {
      const lanes = Math.max(...group.map((g) => g.lane)) + 1;
      group.forEach((g) => (g.lanes = lanes));
      group = [];
      laneEnds.length = 0;
    };
    for (const e of events) {
      if (group.length && e.a >= groupEnd) flush();
      let lane = laneEnds.findIndex((end) => end <= e.a);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = e.b;
      e.lane = lane;
      group.push(e);
      groupEnd = Math.max(groupEnd, e.b);
    }
    if (group.length) flush();
    return events;
  }
}
