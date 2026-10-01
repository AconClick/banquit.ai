import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const RESERVATION_STATUSES = [
  'enquiry', 'provisional', 'waitlisted', 'confirmed', 'inFunction', 'completed', 'billed', 'cancelled', 'lost',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that hold the hall, so no other booking or block may overlap them. */
export const HOLDING_STATUSES: ReservationStatus[] = ['provisional', 'confirmed', 'inFunction'];

/** A hall held from start to end, in the hotel's local time ("YYYY-MM-DDTHH:mm"). */
@Schema({ _id: false })
export class HallSlot {
  @Prop({ required: true })
  hallId: string;

  @Prop({ required: true })
  start: string;

  @Prop({ required: true })
  end: string;
}

@Schema({ _id: false })
export class StatusChange {
  /** null for the first entry, when the booking was created. */
  @Prop({ type: String, default: null })
  from: ReservationStatus | null;

  @Prop({ type: String, required: true })
  to: ReservationStatus;

  @Prop({ required: true })
  at: Date;

  @Prop({ required: true })
  byUserId: string;

  @Prop()
  reasonId?: string;

  @Prop()
  note?: string;
}

/** A package on the booking, with the menu items the guest chose. Rate is fixed when added. */
@Schema({ _id: false })
export class PackageLine {
  @Prop({ required: true })
  packageId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  pax: number;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  taxInclusive: boolean;

  @Prop({ type: [String], default: [] })
  choices: string[];
}

/** An ala carte item, service or modifier booked in advance. Rate is fixed when added. */
@Schema({ _id: false })
export class ExtraLine {
  @Prop({ type: String, required: true })
  kind: 'menuItem' | 'modifier';

  @Prop({ required: true })
  itemId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, required: true })
  aType: 'alacarte' | 'services';

  @Prop({ required: true })
  qty: number;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  taxInclusive: boolean;

  @Prop({ default: '' })
  note: string;
}

export const SETTLEMENT_MODES = ['cash', 'card', 'upi', 'bankTransfer', 'cheque', 'other'] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];

/** Money received against the booking before the bill (advances). */
@Schema({ _id: false })
export class Receipt {
  @Prop({ required: true })
  number: string;

  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: String, required: true })
  mode: SettlementMode;

  @Prop({ default: '' })
  reference: string;

  @Prop({ required: true })
  byUserId: string;

  @Prop({ required: true })
  at: Date;
}

/** Worked out when the booking is cancelled, from the property's cancellation slabs. */
@Schema({ _id: false })
export class CancellationCharge {
  @Prop({ required: true })
  daysBefore: number;

  @Prop({ required: true })
  percent: number;

  /** Charge from the slab. */
  @Prop({ required: true })
  computed: number;

  /** Charge actually applied (lower when a manager waived part of it). */
  @Prop({ required: true })
  charge: number;

  /** Taken from advances already paid. */
  @Prop({ required: true })
  retained: number;

  @Prop({ required: true })
  refundDue: number;

  @Prop({ required: true })
  balanceDue: number;
}

@Schema({ timestamps: true })
export class Reservation {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  propertyId: string;

  /** Booking number from the tenant's reservation series, e.g. R-000042. */
  @Prop({ required: true })
  number: string;

  @Prop({ type: String, required: true })
  status: ReservationStatus;

  /** Company or individual hosting the event. */
  @Prop({ required: true, trim: true })
  hostName: string;

  @Prop({ default: '', trim: true })
  contactName: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ default: '', trim: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  functionTypeId: string;

  @Prop()
  seatingStyleId?: string;

  @Prop({ required: true })
  guaranteedPax: number;

  @Prop({ required: true })
  expectedMaxPax: number;

  @Prop()
  actualPax?: number;

  @Prop({ type: [HallSlot], required: true })
  slots: HallSlot[];

  /** Provisional bookings: the date by which the guest must confirm. */
  @Prop()
  optionDate?: string;

  @Prop({ default: '', trim: true })
  notes: string;

  @Prop({ type: [PackageLine], default: [] })
  packages: PackageLine[];

  @Prop({ type: [ExtraLine], default: [] })
  extras: ExtraLine[];

  @Prop({ type: [Receipt], default: [] })
  receipts: Receipt[];

  @Prop({ type: CancellationCharge })
  cancellation?: CancellationCharge;

  @Prop({ type: [StatusChange], default: [] })
  history: StatusChange[];
}

export type ReservationDocument = HydratedDocument<Reservation>;
export const ReservationSchema = SchemaFactory.createForClass(Reservation);
ReservationSchema.index({ tenantId: 1, number: 1 }, { unique: true });
// Time-range lookups match one slot with $elemMatch, so both ends of the range bound the index scan.
ReservationSchema.index({ tenantId: 1, 'slots.hallId': 1, 'slots.end': 1, 'slots.start': 1 });
ReservationSchema.index({ tenantId: 1, propertyId: 1, 'slots.end': 1, 'slots.start': 1 });
ReservationSchema.index({ tenantId: 1, propertyId: 1, createdAt: 1 });

/** Hall closed for everyone (maintenance, fumigation, etc.). Not a reservation. */
@Schema({ timestamps: true })
export class HallBlock {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  hallId: string;

  @Prop({ required: true })
  start: string;

  @Prop({ required: true })
  end: string;

  @Prop({ required: true })
  reasonId: string;

  @Prop({ default: '', trim: true })
  notes: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ required: true })
  byUserId: string;
}

export type HallBlockDocument = HydratedDocument<HallBlock>;
export const HallBlockSchema = SchemaFactory.createForClass(HallBlock);
HallBlockSchema.index({ tenantId: 1, hallId: 1, start: 1 });

/** Per-tenant number series (Series Setup will make the prefix configurable). */
@Schema()
export class Counter {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
CounterSchema.index({ tenantId: 1, name: 1 }, { unique: true });

/**
 * A short lease on a hall while a booking or block for it is checked and saved, so two people
 * cannot take the same hall at the same moment, even on different servers.
 */
@Schema()
export class HallLock {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  hallId: string;

  @Prop({ required: true })
  owner: string;

  @Prop({ required: true })
  until: Date;
}

export const HallLockSchema = SchemaFactory.createForClass(HallLock);
HallLockSchema.index({ tenantId: 1, hallId: 1 }, { unique: true });
