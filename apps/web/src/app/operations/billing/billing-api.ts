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
  /** GST invoice format: on for the property (drafts) or used when finalised. */
  gstEnabled: boolean;
  buyer: GstBuyer | null;
  gst: GstView | null;
}

/** The guest's GST details. Without a GSTIN the bill is B2C. */
export interface GstBuyer {
  gstin: string;
  legalName: string;
  address: string;
  location: string;
  pincode: string;
  placeOfSupply: string;
}

export interface GstLine {
  slNo: number;
  billLineId: string;
  label: string;
  sac: string;
  qty: number;
  gross: number;
  discount: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cessRate: number;
  cess: number;
  cessFixed: number;
  other: number;
  total: number;
}

export interface GstInvoice {
  intraState: boolean;
  placeOfSupply: string;
  b2b: boolean;
  lines: GstLine[];
  byRate: { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  other: number;
  roundOff: number;
  total: number;
}

export interface EInvoice {
  status: 'generated' | 'cancelled';
  irn: string;
  ackNo: string;
  ackDate: string;
  provider: string;
  /** From the test portal: not a valid IRN. */
  sandbox: boolean;
  cancelDate?: string;
  cancelReason?: string;
  /** QR code image (data URL) while generated. */
  qr: string | null;
}

/** The GST view of a final bill or credit note. */
export interface GstView {
  seller: { gstin: string; legalName: string; tradeName: string; address1: string; address2: string; location: string; pincode: string; stateCode: string };
  eInvoiceOn: boolean;
  invoice: GstInvoice;
  eInvoice: EInvoice | null;
}

/** GST state codes, for the place of supply (billing/gst.ts on the server). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '96': 'Outside India',
};

/** A credit note's GST view also carries the guest's details from its bill. */
export type CreditNoteGst = GstView & { buyer: GstBuyer };

export const EINVOICE_CANCEL_REASONS: Record<'1' | '2' | '3' | '4', string> = {
  '1': 'Duplicate', '2': 'Data entry mistake', '3': 'Order cancelled', '4': 'Other',
};

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
  setBuyer = (billId: string, buyer: Partial<GstBuyer>) => firstValueFrom(this.http.put<Bill>(`/api/billing/bills/${billId}/gst-buyer`, buyer));
  eInvoice = (billId: string) => firstValueFrom(this.http.post<Bill>(`/api/billing/bills/${billId}/einvoice`, {}));
  cancelEInvoice = (billId: string, reasonCode: string, remark: string) =>
    firstValueFrom(this.http.post<Bill>(`/api/billing/bills/${billId}/einvoice/cancel`, { reasonCode, remark }));
  creditNoteGst = (id: string) => firstValueFrom(this.http.get<{ gst: CreditNoteGst | null }>(`/api/billing/credit-notes/${id}/gst`));
  creditNoteEInvoice = (id: string) => firstValueFrom(this.http.post<{ gst: CreditNoteGst | null }>(`/api/billing/credit-notes/${id}/einvoice`, {}));
}

/** 12,345.60 style (12,345.600 for a dinar), without a currency sign: the property's currency is shown once. */
export const money = (n: number | null | undefined, decimalsOrCurrency: number | string | null = 2) => formatMoney(n, decimalsOrCurrency);
