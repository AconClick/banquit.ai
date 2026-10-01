import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ReservationStatus =
  | 'enquiry' | 'provisional' | 'waitlisted' | 'confirmed' | 'inFunction' | 'completed' | 'billed' | 'cancelled' | 'lost';

export interface HallSlot {
  hallId: string;
  start: string;
  end: string;
}

export interface Reservation {
  id: string;
  number: string;
  status: ReservationStatus;
  propertyId: string;
  hostName: string;
  contactName: string;
  phone: string;
  email: string;
  functionTypeId: string;
  seatingStyleId: string | null;
  guaranteedPax: number;
  expectedMaxPax: number;
  actualPax: number | null;
  slots: HallSlot[];
  optionDate: string | null;
  notes: string;
  history: { from: ReservationStatus | null; to: ReservationStatus; at: string; byUserId: string; reasonId: string | null; note: string | null }[];
  warnings: string[];
}

export interface HallBlock {
  id: string;
  hallId: string;
  start: string;
  end: string;
  reasonId: string;
  notes: string;
}

export interface DiaryData {
  from: string;
  days: number;
  halls: { id: string; name: string; capacity: number }[];
  reservations: Reservation[];
  blocks: HallBlock[];
}

export interface ReservationInput {
  propertyId: string;
  status: ReservationStatus;
  hostName: string;
  contactName: string;
  phone: string;
  email: string;
  functionTypeId: string;
  seatingStyleId?: string;
  guaranteedPax: number;
  expectedMaxPax: number;
  slots: HallSlot[];
  optionDate?: string;
  notes: string;
  amendmentReasonId?: string;
}

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  enquiry: 'Enquiry', provisional: 'Provisional', waitlisted: 'Waitlisted', confirmed: 'Confirmed',
  inFunction: 'In Function', completed: 'Function Completed', billed: 'Billed', cancelled: 'Cancelled', lost: 'Lost',
};

/** Which status can follow which; mirrors the backend rules. */
export const NEXT_STATUSES: Partial<Record<ReservationStatus, ReservationStatus[]>> = {
  enquiry: ['provisional', 'waitlisted', 'confirmed', 'lost', 'cancelled'],
  provisional: ['confirmed', 'lost', 'cancelled'],
  waitlisted: ['provisional', 'confirmed', 'lost', 'cancelled'],
  confirmed: ['cancelled'],
};

@Injectable({ providedIn: 'root' })
export class DiaryApi {
  private readonly http = inject(HttpClient);

  diary = (propertyId: string, from: string, days = 7) =>
    firstValueFrom(this.http.get<DiaryData>('/api/diary', { params: { propertyId, from, days } }));
  create = (input: ReservationInput) => firstValueFrom(this.http.post<Reservation>('/api/reservations', input));
  update = (id: string, input: ReservationInput) => firstValueFrom(this.http.put<Reservation>(`/api/reservations/${id}`, input));
  setStatus = (id: string, status: ReservationStatus, extra: { reasonId?: string; optionDate?: string; note?: string; cancellationCharge?: number } = {}) =>
    firstValueFrom(this.http.post<Reservation>(`/api/reservations/${id}/status`, { status, ...extra }));
  block = (input: { hallId: string; start: string; end: string; reasonId: string; notes: string }) =>
    firstValueFrom(this.http.post<HallBlock>('/api/hall-blocks', input));
  unblock = (id: string) => firstValueFrom(this.http.post<void>(`/api/hall-blocks/${id}/remove`, {}));
}

/** Local calendar helpers. Dates are "YYYY-MM-DD", times "HH:mm", date-times "YYYY-MM-DDTHH:mm". */
export const pad = (n: number) => String(n).padStart(2, '0');
export const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
export const addDays = (s: string, n: number) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDate(d);
};
export const minutesOfDay = (localDateTime: string) => Number(localDateTime.slice(11, 13)) * 60 + Number(localDateTime.slice(14, 16));
export const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/** Monday of the week containing the date. */
export const weekStart = (s: string) => {
  const d = parseDate(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};
