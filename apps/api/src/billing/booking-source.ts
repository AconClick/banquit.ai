import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PricingService } from '../pricing/pricing.service.js';
import type { Proforma, TaxRate } from '../pricing/proforma.js';
import { BookingDetailsService, functionDate } from '../reservations/booking-details.service.js';
import { Reservation } from '../reservations/reservation.schema.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import type { AType } from './bill-engine.js';

/**
 * What billing needs from a booking. Billing reads bookings, rates and settings only through this
 * interface, so the booking screens can change how they store things without touching billing.
 */
export interface BillingBooking {
  id: string;
  number: string;
  status: string;
  propertyId: string;
  hostName: string;
  contactName: string;
  phone: string;
  email: string;
  /** First day of the function (YYYY-MM-DD): taxes valid on this date apply. */
  functionDate: string;
  slots: { hallId: string; start: string; end: string }[];
  guaranteedPax: number;
  expectedMaxPax: number;
  /** Entered when the function is completed; null before. */
  actualPax: number | null;
  /** Package lines, each with its own guaranteed pax and agreed rate. */
  packages: { packageId: string; name: string; pax: number; rate: number; taxInclusive: boolean }[];
  /** Ala-carte items and services booked in advance, at agreed rates. */
  extras: { kind: string; itemId: string; name: string; aType: Exclude<AType, 'package'>; qty: number; rate: number; taxInclusive: boolean }[];
  /** Advances received against the booking. */
  receipts: { number: string; date: string; amount: number; mode: string }[];
}

export interface TaxQuery {
  aType: AType;
  /** The priced item (package, menuItem or modifier), when the line is for one. */
  kind?: string;
  itemId?: string;
}

export interface BookingSource {
  booking(tenantId: Types.ObjectId, reservationId: string): Promise<BillingBooking | null>;
  /** The booking's proforma on guaranteed pax, exactly as the booking screen shows it. */
  proforma(tenantId: Types.ObjectId, reservationId: string): Promise<Proforma>;
  /** Default taxes for items at a property: Rate & Tax Mapping first, else the property default for the A-Type. */
  taxDefaults(tenantId: Types.ObjectId, propertyId: string): Promise<(item: TaxQuery) => string[]>;
  /** Rates of the given taxes that are active and valid on the date. */
  taxRates(tenantId: Types.ObjectId, propertyId: string, taxIds: string[], onDate: string): Promise<TaxRate[]>;
  /** Property setting: round the bill total to a whole currency unit. */
  roundTotal(tenantId: Types.ObjectId, propertyId: string): Promise<boolean>;
  /** The bill is settled: the completed booking moves to Billed. */
  markBilled(tenantId: Types.ObjectId, reservationId: string, userId: string, billNumber: string): Promise<void>;
}

export const BOOKING_SOURCE = Symbol('BOOKING_SOURCE');

/** BookingSource over the reservation, pricing and booking-details modules. */
@Injectable()
export class ReservationBookingSource implements BookingSource {
  constructor(
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    private readonly pricing: PricingService,
    private readonly details: BookingDetailsService,
    private readonly reservationsService: ReservationsService,
  ) {}

  private async find(tenantId: Types.ObjectId, id: string) {
    return Types.ObjectId.isValid(id) ? this.reservations.findOne({ tenantId, _id: id }) : null;
  }

  async booking(tenantId: Types.ObjectId, reservationId: string): Promise<BillingBooking | null> {
    const r = await this.find(tenantId, reservationId);
    if (!r) return null;
    return {
      id: r.id as string,
      number: r.number,
      status: r.status,
      propertyId: r.propertyId,
      hostName: r.hostName,
      contactName: r.contactName,
      phone: r.phone,
      email: r.email,
      functionDate: functionDate(r),
      slots: r.slots.map((s) => ({ hallId: s.hallId, start: s.start, end: s.end })),
      guaranteedPax: r.guaranteedPax,
      expectedMaxPax: r.expectedMaxPax,
      actualPax: r.actualPax ?? null,
      packages: r.packages.map((p) => ({ packageId: p.packageId, name: p.name, pax: p.pax, rate: p.rate, taxInclusive: p.taxInclusive })),
      extras: r.extras.map((e) => ({ kind: e.kind, itemId: e.itemId, name: e.name, aType: e.aType, qty: e.qty, rate: e.rate, taxInclusive: e.taxInclusive })),
      receipts: r.receipts.map((x) => ({ number: x.number, date: x.date, amount: x.amount, mode: x.mode })),
    };
  }

  async proforma(tenantId: Types.ObjectId, reservationId: string) {
    const r = await this.find(tenantId, reservationId);
    if (!r) throw new NotFoundException('Reservation not found.');
    return (await this.details.quote(tenantId, r)).proforma;
  }

  async taxDefaults(tenantId: Types.ObjectId, propertyId: string) {
    const [settings, sheet] = await Promise.all([this.pricing.settings(tenantId, propertyId), this.pricing.rateSheet(tenantId, propertyId)]);
    return (item: TaxQuery) => {
      const mapped = item.kind && item.itemId ? sheet.find((i) => i.kind === item.kind && i.id === item.itemId)?.taxIds : null;
      return [...(mapped ?? settings.defaultTaxIds[item.aType] ?? [])];
    };
  }

  async taxRates(tenantId: Types.ObjectId, propertyId: string, taxIds: string[], onDate: string) {
    if (!taxIds.length) return [];
    // With taxIds given, taxesFor only checks each tax is active and valid on the date.
    return this.pricing.taxesFor(tenantId, propertyId, { aType: 'package', taxIds }, onDate);
  }

  async roundTotal(tenantId: Types.ObjectId, propertyId: string) {
    return (await this.pricing.settings(tenantId, propertyId)).roundTotal;
  }

  async markBilled(tenantId: Types.ObjectId, reservationId: string, userId: string, billNumber: string) {
    await this.reservationsService.markBilled(tenantId, userId, reservationId, billNumber);
  }
}
