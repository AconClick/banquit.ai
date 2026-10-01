import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.interceptor';
import { MasterRecord, MastersStore } from '../../master/masters-store';
import { STATUS_LABELS, addDays, parseDate, toDate } from '../diary/diary-api';
import {
  BookingsByStatus,
  CellState,
  EnquiryConversion,
  Forecast,
  FunctionSheets,
  HallOccupancy,
  ReportFilter,
  ReportsApi,
  Revenue,
} from './reports-api';

export type ReportKind = 'forecast' | 'status' | 'occupancy' | 'conversion' | 'sheets' | 'revenue';

const FORECAST_DAYS = 14;
const PROPERTY_KEY = 'banquet.reports.property';

const monthStart = (date: string) => `${date.slice(0, 8)}01`;
const monthEnd = (date: string) => {
  const d = parseDate(monthStart(date));
  d.setMonth(d.getMonth() + 1, 0);
  return toDate(d);
};

/**
 * Reports for the Operations panel: the availability forecast and the booking reports,
 * for one property or all of them, over a date range.
 */
@Component({
  selector: 'app-reports',
  imports: [FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class Reports implements OnInit {
  private readonly api = inject(ReportsApi);
  private readonly masters = inject(MastersStore);

  protected readonly tabs: { kind: ReportKind; label: string }[] = [
    { kind: 'forecast', label: 'Availability forecast' },
    { kind: 'status', label: 'Bookings by status' },
    { kind: 'occupancy', label: 'Hall occupancy' },
    { kind: 'conversion', label: 'Enquiry conversion' },
    { kind: 'sheets', label: 'Function sheets' },
    { kind: 'revenue', label: 'Revenue' },
  ];
  protected readonly legend: { state: CellState; label: string }[] = [
    { state: 'free', label: 'Free' },
    { state: 'enquiry', label: 'Enquiry only' },
    { state: 'provisional', label: 'Provisional' },
    { state: 'confirmed', label: 'Confirmed' },
    { state: 'blocked', label: 'Blocked' },
  ];
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly today = toDate(new Date());

  protected readonly properties = signal<MasterRecord[]>([]);
  protected readonly tab = signal<ReportKind>('forecast');
  protected readonly propertyId = signal('');
  protected readonly from = signal(this.today);
  protected readonly to = signal(addDays(this.today, FORECAST_DAYS - 1));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly forecast = signal<Forecast | null>(null);
  protected readonly status = signal<BookingsByStatus | null>(null);
  protected readonly occupancy = signal<HallOccupancy | null>(null);
  protected readonly conversion = signal<EnquiryConversion | null>(null);
  protected readonly sheets = signal<FunctionSheets | null>(null);
  protected readonly revenue = signal<Revenue | null>(null);

  /** Property names, shown when the report covers more than one property. */
  protected readonly propertyNames = computed(() => new Map(this.properties().map((p) => [p.id, String(p['name'])])));
  protected readonly allProperties = computed(() => !this.propertyId() && this.properties().length > 1);

  async ngOnInit() {
    try {
      const properties = await this.masters.list('property');
      this.properties.set(properties);
      let remembered = '';
      try {
        remembered = localStorage.getItem(PROPERTY_KEY) ?? '';
      } catch {
        // ignore
      }
      // A single-property hotel sees its property; a group starts on all properties.
      if (remembered === '' || properties.some((p) => p.id === remembered)) this.propertyId.set(remembered);
      if (properties.length === 1) this.propertyId.set(properties[0].id);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected selectTab(kind: ReportKind) {
    if (kind === this.tab()) return;
    const wasForecast = this.tab() === 'forecast';
    this.tab.set(kind);
    // The forecast looks ahead from today; the other reports default to this month.
    if (kind === 'forecast') {
      this.from.set(this.today);
      this.to.set(addDays(this.today, FORECAST_DAYS - 1));
    } else if (wasForecast) {
      this.from.set(monthStart(this.today));
      this.to.set(monthEnd(this.today));
    }
    void this.load();
  }

  protected changeProperty(id: string) {
    this.propertyId.set(id);
    try {
      localStorage.setItem(PROPERTY_KEY, id);
    } catch {
      // ignore
    }
    void this.load();
  }

  protected setRange(from: string, to: string) {
    if (!from || !to) return;
    this.from.set(from);
    this.to.set(to < from ? from : to);
    void this.load();
  }

  /** Moves the range forward or back by its own length. */
  protected shift(direction: 1 | -1) {
    const length = Math.round((parseDate(this.to()).getTime() - parseDate(this.from()).getTime()) / 86_400_000) + 1;
    this.setRange(addDays(this.from(), direction * length), addDays(this.to(), direction * length));
  }

  protected async load() {
    const f: ReportFilter = { propertyId: this.propertyId(), from: this.from(), to: this.to() };
    this.loading.set(true);
    this.error.set(null);
    try {
      switch (this.tab()) {
        case 'forecast': this.forecast.set(await this.api.forecast(f)); break;
        case 'status': this.status.set(await this.api.bookingsByStatus(f)); break;
        case 'occupancy': this.occupancy.set(await this.api.hallOccupancy(f)); break;
        case 'conversion': this.conversion.set(await this.api.enquiryConversion(f)); break;
        case 'sheets': this.sheets.set(await this.api.functionSheets(f)); break;
        case 'revenue': this.revenue.set(await this.api.revenue(f)); break;
      }
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected dayLabel(date: string) {
    return parseDate(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  protected cellTitle(hallName: string, cell: Forecast['halls'][number]['days'][number]) {
    const parts = [`${hallName}, ${this.dayLabel(cell.date)}: ${this.legend.find((l) => l.state === cell.state)?.label}`];
    if (cell.heldHours) parts.push(`${cell.heldHours} h held`);
    if (cell.bookings.length) parts.push(cell.bookings.join(', '));
    return parts.join(' · ');
  }

  protected print() {
    window.print();
  }
}
