import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ReservationStatus } from '../diary/diary-api';

export interface ReportFilter {
  /** Empty for all properties. */
  propertyId: string;
  from: string;
  to: string;
}

interface ReportHeader {
  from: string;
  to: string;
  propertyId: string | null;
  properties: { id: string; name: string }[];
}

export type CellState = 'free' | 'enquiry' | 'provisional' | 'confirmed' | 'blocked';

export interface Forecast extends ReportHeader {
  dates: string[];
  halls: {
    hallId: string;
    hallName: string;
    propertyId: string;
    capacity: number;
    days: { date: string; state: CellState; heldHours: number; bookings: string[] }[];
  }[];
  days: { date: string; functions: number; guaranteedPax: number; expectedMaxPax: number; tentativePax: number; hallsAvailable: number; hallsTotal: number }[];
  demand: {
    packages: { packageId: string; name: string; bookings: number; pax: number; provisionalPax: number }[];
    dishes: { itemId: string; name: string; pax: number; provisionalPax: number }[];
    extras: { itemId: string; name: string; aType: 'alacarte' | 'services'; qty: number; provisionalQty: number }[];
  };
}

export interface BookingsByStatus extends ReportHeader {
  rows: { status: ReservationStatus; bookings: number; guaranteedPax: number; expectedMaxPax: number }[];
  total: { bookings: number; guaranteedPax: number; expectedMaxPax: number };
}

export interface HallOccupancy extends ReportHeader {
  rows: {
    hallId: string;
    hallName: string;
    propertyId: string;
    functions: number;
    confirmedHours: number;
    provisionalHours: number;
    blockedHours: number;
    daysUsed: number;
    daysInRange: number;
    occupancyPercent: number;
  }[];
}

export interface ConversionCounts {
  received: number;
  converted: number;
  open: number;
  lost: number;
  cancelledBeforeConfirm: number;
  cancelledAfterConfirm: number;
  conversionPercent: number;
  decidedConversionPercent: number;
}

export interface EnquiryConversion extends ReportHeader {
  total: ConversionCounts;
  byFunctionType: (ConversionCounts & { functionTypeId: string; functionType: string })[];
}

export interface FunctionSheets extends ReportHeader {
  rows: {
    reservationId: string;
    number: string;
    status: ReservationStatus;
    propertyId: string;
    date: string;
    start: string;
    end: string;
    hallId: string;
    hall: string;
    hostName: string;
    functionType: string;
    guaranteedPax: number;
    expectedMaxPax: number;
    actualPax: number | null;
  }[];
}

export interface RevenueSum {
  bills: number;
  amount: number;
  discount: number;
  taxable: number;
  taxTotal: number;
  roundOff: number;
  total: number;
  collected: number;
  balance: number;
}

export interface Revenue extends ReportHeader {
  currency: string | null;
  mixedCurrencies: boolean;
  total: RevenueSum | null;
  byProperty: (RevenueSum & { propertyId: string; currency: string })[];
  byAType: { key: string; label: string; taxable: number; tax: number; total: number }[];
  bySource: { key: string; label: string; taxable: number; tax: number; total: number }[];
  taxes: { id: string; name: string; amount: number }[];
  bills: {
    id: string;
    number: string;
    propertyId: string;
    currency: string;
    reservationId: string;
    reservationNumber: string;
    hostName: string;
    functionDate: string;
    status: string;
    total: number;
    collected: number;
    balance: number;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);

  private get<T>(report: string, f: ReportFilter) {
    const params: Record<string, string> = { from: f.from, to: f.to };
    if (f.propertyId) params['propertyId'] = f.propertyId;
    return firstValueFrom(this.http.get<T>(`/api/reports/${report}`, { params }));
  }

  forecast = (f: ReportFilter) => this.get<Forecast>('forecast', f);
  bookingsByStatus = (f: ReportFilter) => this.get<BookingsByStatus>('bookings-by-status', f);
  hallOccupancy = (f: ReportFilter) => this.get<HallOccupancy>('hall-occupancy', f);
  enquiryConversion = (f: ReportFilter) => this.get<EnquiryConversion>('enquiry-conversion', f);
  functionSheets = (f: ReportFilter) => this.get<FunctionSheets>('function-sheets', f);
  revenue = (f: ReportFilter) => this.get<Revenue>('revenue', f);
}
