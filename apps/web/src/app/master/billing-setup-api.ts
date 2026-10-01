import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type SeriesDocument = 'bill' | 'creditNote';

export interface Series {
  prefix: string;
  digits: number;
  resetYearly: boolean;
}

export interface BillingSetup {
  propertyId: string;
  fyStartMonth: number;
  series: Record<SeriesDocument, Series>;
  /** This financial year at the property, e.g. 2026-27. */
  financialYear: string;
  next: Record<SeriesDocument, { seq: number; number: string }>;
  currency: string;
  decimals: number;
}

export interface BillingSetupInput {
  fyStartMonth: number;
  series: Record<SeriesDocument, Series>;
  nextNumbers?: Partial<Record<SeriesDocument, number>>;
}

export const SERIES_LABELS: Record<SeriesDocument, string> = { bill: 'Bills (tax invoices)', creditNote: 'Credit notes' };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** {FY} → 2026-27 and {FYSHORT} → 26-27, as the server builds numbers (billing/series.ts). */
export function previewNumber(s: Series, fy: string, seq: number) {
  const short = fy.includes('-') ? `${fy.slice(2, 4)}-${fy.slice(5)}` : fy.slice(2);
  const digits = Number.isInteger(s.digits) && s.digits > 0 && s.digits <= 10 ? s.digits : 1;
  return `${(s.prefix ?? '').replaceAll('{FYSHORT}', short).replaceAll('{FY}', fy)}${String(seq).padStart(digits, '0')}`;
}

@Injectable({ providedIn: 'root' })
export class BillingSetupApi {
  private readonly http = inject(HttpClient);
  get = (propertyId: string) => firstValueFrom(this.http.get<BillingSetup>(`/api/billing/setup/${propertyId}`));
  save = (propertyId: string, input: BillingSetupInput) => firstValueFrom(this.http.put<BillingSetup>(`/api/billing/setup/${propertyId}`, input));
}
