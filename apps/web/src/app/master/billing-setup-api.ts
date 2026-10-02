import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type SeriesDocument = 'bill' | 'creditNote';

export interface Series {
  prefix: string;
  digits: number;
  resetYearly: boolean;
}

/** Print Setup (billing/print-setup.ts on the server). */
export interface PrintSetup {
  logo: string;
  legalName: string;
  headerLines: string;
  registration: string;
  billTitle: string;
  proformaTitle: string;
  creditNoteTitle: string;
  proformaNote: string;
  bankDetails: string;
  terms: string;
  footer: string;
  signatureLabel: string;
  showDiscountColumn: boolean;
  showTaxColumn: boolean;
  paperSize: 'A4' | 'Letter';
}

export interface BillingSetup {
  propertyId: string;
  fyStartMonth: number;
  series: Record<SeriesDocument, Series>;
  print: PrintSetup;
  /** This financial year at the property, e.g. 2026-27. */
  financialYear: string;
  next: Record<SeriesDocument, { seq: number; number: string }>;
  currency: string;
  decimals: number;
}

export interface BillingSetupInput {
  fyStartMonth: number;
  series: Record<SeriesDocument, Series>;
  print: PrintSetup;
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

/** Shrinks an image file to fit 600 × 200 and returns it as a PNG (or JPEG, if smaller) data URL. */
export async function shrinkLogo(file: File, maxW = 600, maxH = 200): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image we can read.'));
      i.src = url;
    });
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    const jpeg = canvas.toDataURL('image/jpeg', 0.85);
    return png.length <= jpeg.length * 1.5 ? png : jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

@Injectable({ providedIn: 'root' })
export class BillingSetupApi {
  private readonly http = inject(HttpClient);
  get = (propertyId: string) => firstValueFrom(this.http.get<BillingSetup>(`/api/billing/setup/${propertyId}`));
  save = (propertyId: string, input: BillingSetupInput) => firstValueFrom(this.http.put<BillingSetup>(`/api/billing/setup/${propertyId}`, input));
}
