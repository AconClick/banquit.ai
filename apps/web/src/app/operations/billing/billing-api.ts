import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { formatMoney } from '../../core/money';
import type { PrintSetup } from '../../master/billing-setup-api';
import type { AType, Proforma, TaxAmount } from '../booking/booking-api';

export type BillStatus = 'draft' | 'finalised' | 'partiallySettled' | 'settled' | 'void';
export type LineSource = 'package' | 'extra' | 'running' | 'hallHire' | 'liquorLicence';
export type PaymentMode = 'cash' | 'card' | 'upi' | 'bankTransfer' | 'cheque' | 'cityLedger' | 'other';

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  draft: 'Draft', finalised: 'Final', partiallySettled: 'Partly settled', settled: 'Settled', void: 'Void',
};
export const PAYMENT_MODES: Record<PaymentMode, string> = {
  cash: 'Cash', card: 'Card', upi: 'UPI', bankTransfer: 'Bank transfer', cheque: 'Cheque', cityLedger: 'Company account (city ledger)', other: 'Other',
};
export const SOURCE_LABELS: Record<LineSource, string> = {
  package: 'Package', extra: 'Booked', running: 'Running', hallHire: 'Hall hire', liquorLicence: 'Licence',
};

export interface Discount {
  type: 'percent' | 'amount';
  value: number;
  reason: string;
}

export interface BillLine {
  id: string;
  source: LineSource;
  aType: AType;
  label: string;
  kind: string | null;
  itemId: string | null;
  hallId: string | null;
  guaranteedPax: number | null;
  actualPax: number | null;
  qty: number;
  rate: number;
  taxInclusive: boolean;
  amount: number;
  discount: number;
  lineDiscount: Discount | null;
  taxable: number;
  taxIds: string[];
  taxes: TaxAmount[];
  total: number;
  remark: string;
}

export interface Bill {
  id: string;
  number: string | null;
  status: BillStatus;
  reservationId: string;
  reservationNumber: string;
  propertyId: string;
  hostName: string;
  functionDate: string;
  roundTotal: boolean;
  /** The property's currency when the bill was drafted, and its decimals (3 for KWD). */
  currency: string | null;
  decimals: number;
  billDiscount: Discount | null;
  finalisedAt: string | null;
  voidReason: string | null;
  advanceReceipts: { number: string; date: string; amount: number; mode: string }[];
  payments: { number: string; kind: 'payment' | 'refund'; date: string; amount: number; mode: PaymentMode; reference: string }[];
  history: { action: string; at: string; byUserId: string; note: string | null }[];
  /** Date of the final bill at the property. */
  date: string | null;
  /** Credit notes issued (not cancelled), already taken off the balance. */
  credited: number;
  creditNotes: { id: string; number: string | null; date: string; total: number; status: 'issued' | 'cancelled' }[];
  lines: BillLine[];
  amount: number;
  discount: number;
  taxable: number;
  taxes: TaxAmount[];
  taxTotal: number;
  roundOff: number;
  total: number;
  advances: number;
  paid: number;
  balance: number;
  warnings: string[];
}

export interface BillingBooking {
  id: string;
  number: string;
  status: string;
  propertyId: string;
  hostName: string;
  contactName: string;
  phone: string;
  email: string;
  functionDate: string;
  guaranteedPax: number;
  expectedMaxPax: number;
  halls: { hallId: string; start: string; end: string; hours: number }[];
}

export interface BillingView {
  booking: BillingBooking;
  currency: string;
  decimals: number;
  print: PrintSetup;
  proforma: Proforma & { advances: number };
  bill: Bill | null;
  voided: { id: string; number: string | null; voidReason: string }[];
}

export interface BillListRow {
  id: string;
  number: string | null;
  status: BillStatus;
  reservationId: string;
  reservationNumber: string;
  hostName: string;
  functionDate: string;
  propertyId: string;
  total: number | null;
  balance: number | null;
  currency: string | null;
}

export interface CreditNote {
  id: string;
  number: string;
  date: string;
  status: 'issued' | 'cancelled';
  reason: string;
  cancelReason: string | null;
  billId: string;
  billNumber: string;
  billDate: string;
  reservationId: string;
  reservationNumber: string;
  hostName: string;
  propertyId: string;
  currency: string;
  decimals: number;
  lines: { billLineId: string; label: string; aType: AType; taxable: number; taxes: TaxAmount[]; total: number }[];
  taxable: number;
  taxes: TaxAmount[];
  taxTotal: number;
  roundOff: number;
  total: number;
  /** Included when one credit note is fetched, for printing. */
  print?: PrintSetup;
}

/** Per bill line: charged, credited so far, and still open to credit. */
export interface CreditableLine {
  lineId: string;
  label: string;
  total: number;
  credited: number;
  open: number;
}

/** A line as sent to the server when saving a draft. */
export interface LineInput {
  id?: string;
  source: LineSource;
  label?: string;
  aType?: 'alacarte' | 'services';
  kind?: string;
  itemId?: string;
  hallId?: string;
  actualPax?: number | null;
  qty?: number;
  rate?: number;
  taxInclusive?: boolean;
  taxIds?: string[];
  discount?: Discount | null;
  remark?: string;
}

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);

  forReservation = (reservationId: string) => firstValueFrom(this.http.get<BillingView>(`/api/billing/reservations/${reservationId}`));
  list = (filter: { propertyId?: string; status?: string; from?: string; to?: string }) => {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => !!v)) as Record<string, string>;
    return firstValueFrom(this.http.get<BillListRow[]>('/api/billing/bills', { params }));
  };
  draft = (reservationId: string) => firstValueFrom(this.http.post<Bill>(`/api/billing/reservations/${reservationId}/draft`, {}));
  save = (id: string, lines: LineInput[], billDiscount: Discount | null) =>
    firstValueFrom(this.http.put<Bill>(`/api/billing/bills/${id}`, { lines, billDiscount }));
  refresh = (id: string) => firstValueFrom(this.http.post<Bill>(`/api/billing/bills/${id}/refresh`, {}));
  finalise = (id: string) => firstValueFrom(this.http.post<Bill>(`/api/billing/bills/${id}/finalise`, {}));
  pay = (id: string, input: { kind: 'payment' | 'refund'; amount: number; mode: PaymentMode; date?: string; reference?: string }) =>
    firstValueFrom(this.http.post<Bill>(`/api/billing/bills/${id}/payments`, input));
  void = (id: string, reason: string) => firstValueFrom(this.http.post<Bill>(`/api/billing/bills/${id}/void`, { reason }));
  creditable = (billId: string) =>
    firstValueFrom(this.http.get<{ lines: CreditableLine[]; creditNotes: CreditNote[] }>(`/api/billing/bills/${billId}/credit-notes`));
  issueCredit = (billId: string, input: { reason: string; full?: boolean; lines?: { lineId: string; amount: number }[] }) =>
    firstValueFrom(this.http.post<{ creditNote: CreditNote; bill: Bill }>(`/api/billing/bills/${billId}/credit-notes`, input));
  cancelCredit = (id: string, reason: string) =>
    firstValueFrom(this.http.post<{ creditNote: CreditNote; bill: Bill }>(`/api/billing/credit-notes/${id}/cancel`, { reason }));
  creditNote = (id: string) => firstValueFrom(this.http.get<CreditNote>(`/api/billing/credit-notes/${id}`));
}

/** 12,345.60 style (12,345.600 for a dinar), without a currency sign: the property's currency is shown once. */
export const money = (n: number | null | undefined, decimalsOrCurrency: number | string | null = 2) => formatMoney(n, decimalsOrCurrency);
