import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Reservation } from '../diary/diary-api';
import { formatMoney } from '../../core/money';

export type AType = 'package' | 'alacarte' | 'services';
export type SettlementMode = 'cash' | 'card' | 'upi' | 'bankTransfer' | 'cheque' | 'other';

export const SETTLEMENT_MODES: Record<SettlementMode, string> = {
  cash: 'Cash', card: 'Card', upi: 'UPI', bankTransfer: 'Bank transfer', cheque: 'Cheque', other: 'Other',
};
export const ATYPE_LABELS: Record<AType, string> = { package: 'Package', alacarte: 'Ala carte', services: 'Service' };

export interface TaxAmount {
  id: string;
  name: string;
  amount: number;
}

export interface Proforma {
  lines: { label: string; aType: AType; qty: number; rate: number; taxInclusive: boolean; amount: number; taxable: number; taxes: TaxAmount[]; total: number }[];
  taxable: number;
  taxes: TaxAmount[];
  taxTotal: number;
  roundOff: number;
  total: number;
}

export interface CancellationFigures {
  daysBefore: number;
  percent: number;
  computed: number;
  charge: number;
  retained: number;
  refundDue: number;
  balanceDue: number;
}

export interface BookingDetails extends Reservation {
  packages: { packageId: string; name: string; pax: number; rate: number; taxInclusive: boolean; choices: { id: string; name: string }[] }[];
  extras: { kind: 'menuItem' | 'modifier'; itemId: string; name: string; aType: AType; qty: number; rate: number; taxInclusive: boolean; note: string }[];
  receipts: { number: string; date: string; amount: number; mode: SettlementMode; reference: string; at: string }[];
  proforma: Proforma;
  /** Decimals of the property's currency: 3 for KWD. */
  decimals: number;
  advance: { percent: number; required: number; paid: number; shortBy: number; secondInstalment: { amount: number; dueDate: string } | null };
  cancellation: CancellationFigures | null;
  cancellationPreview: CancellationFigures | null;
  menuWarnings: string[];
  guaranteeCutoff: string;
}

export interface MenuOptions {
  packages: {
    id: string; code: string; name: string; rate: number; taxInclusive: boolean;
    groups: { subGroupId: string; name: string; min: number; max: number; items: { id: string; name: string }[] }[];
  }[];
  extras: { kind: 'menuItem' | 'modifier'; id: string; code: string; name: string; aType: AType; unit: string | null; rate: number; taxInclusive: boolean }[];
}

export interface MenuInput {
  packages: { packageId: string; pax: number; choices: string[] }[];
  extras: { kind: 'menuItem' | 'modifier'; itemId: string; qty: number; note: string }[];
  amendmentReasonId?: string;
}

@Injectable({ providedIn: 'root' })
export class BookingApi {
  private readonly http = inject(HttpClient);

  details = (id: string) => firstValueFrom(this.http.get<BookingDetails>(`/api/reservations/${id}/details`));
  menuOptions = (id: string) => firstValueFrom(this.http.get<MenuOptions>(`/api/reservations/${id}/menu-options`));
  saveMenu = (id: string, input: MenuInput) => firstValueFrom(this.http.put<BookingDetails>(`/api/reservations/${id}/menu`, input));
  addReceipt = (id: string, input: { amount: number; mode: SettlementMode; date?: string; reference?: string }) =>
    firstValueFrom(this.http.post<BookingDetails>(`/api/reservations/${id}/receipts`, input));
}

/** Money to the currency's decimals (core/money.ts) in the viewer's number format; the currency code is shown separately. */
export const money = (n: number | null | undefined, decimalsOrCurrency: number | string | null = 2) => formatMoney(n ?? 0, decimalsOrCurrency);
