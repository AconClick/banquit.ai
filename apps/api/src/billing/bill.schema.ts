import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { AType, BillTotals, LineSource, TaxRate } from './bill-engine.js';

/** docs/workflows/billing-stages.md, section 2. Proforma and Running are worked out, not stored. */
export const BILL_STATUSES = ['draft', 'finalised', 'partiallySettled', 'settled', 'void'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** Settlement Setup will make these configurable per property. */
export const PAYMENT_MODES = ['cash', 'card', 'upi', 'bankTransfer', 'cheque', 'cityLedger', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

@Schema({ _id: false })
export class BillDiscount {
  @Prop({ type: String, required: true })
  type: 'percent' | 'amount';

  @Prop({ required: true })
  value: number;

  @Prop({ required: true })
  reason: string;
}

@Schema({ _id: false })
export class BillLine {
  /** Stable within the bill, so the screen can edit a line. */
  @Prop({ required: true })
  id: string;

  @Prop({ type: String, required: true })
  source: LineSource;

  @Prop({ type: String, required: true })
  aType: AType;

  @Prop({ required: true })
  label: string;

  /** The package, menu item or modifier the line is for, when there is one. */
  @Prop()
  kind?: string;

  @Prop()
  itemId?: string;

  @Prop()
  hallId?: string;

  @Prop()
  guaranteedPax?: number;

  @Prop({ type: Number, default: null })
  actualPax: number | null;

  @Prop({ required: true })
  qty: number;

  @Prop({ required: true })
  rate: number;

  @Prop({ required: true })
  taxInclusive: boolean;

  @Prop({ type: [String], default: [] })
  taxIds: string[];

  @Prop({ type: BillDiscount, default: null })
  discount: BillDiscount | null;

  @Prop({ default: '' })
  remark: string;
}

/** Money received against the bill. Refunds (of excess advances) are stored with kind "refund". */
@Schema({ _id: false })
export class BillPayment {
  @Prop({ required: true })
  number: string;

  @Prop({ type: String, required: true })
  kind: 'payment' | 'refund';

  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: String, required: true })
  mode: PaymentMode;

  @Prop({ default: '' })
  reference: string;

  @Prop({ required: true })
  byUserId: string;

  @Prop({ required: true })
  at: Date;
}

/** Advances from the booking, copied onto the bill when it is finalised. */
@Schema({ _id: false })
export class AppliedAdvance {
  @Prop({ required: true })
  number: string;

  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  mode: string;
}

@Schema({ _id: false })
export class BillEvent {
  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  at: Date;

  @Prop({ required: true })
  byUserId: string;

  @Prop()
  note?: string;
}

@Schema({ timestamps: true })
export class Bill {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  propertyId: string;

  @Prop({ required: true })
  reservationId: string;

  @Prop({ required: true })
  reservationNumber: string;

  @Prop({ required: true })
  hostName: string;

  @Prop({ required: true })
  functionDate: string;

  @Prop({ type: String, required: true })
  status: BillStatus;

  /** The booking id while the bill is not void; a unique index keeps one open bill per booking. */
  @Prop()
  openFor?: string;

  /** The property's currency when the bill was drafted, and its decimals (3 for KWD). Older bills: INR, 2. */
  @Prop()
  currency?: string;

  @Prop()
  decimals?: number;

  /** From the bill series when finalised, e.g. B/2026-27/000001. */
  @Prop()
  number?: string;

  @Prop({ type: [BillLine], default: [] })
  lines: BillLine[];

  @Prop({ type: BillDiscount, default: null })
  billDiscount: BillDiscount | null;

  @Prop({ required: true })
  roundTotal: boolean;

  /** Tax rates fixed when the bill is finalised, so later Tax Master changes never alter it. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  taxRates: Record<string, TaxRate> | null;

  @Prop({ type: [AppliedAdvance], default: [] })
  advances: AppliedAdvance[];

  @Prop({ type: [BillPayment], default: [] })
  payments: BillPayment[];

  /** Totals as printed, stored when finalised. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  totals: Omit<BillTotals, 'advances' | 'paid' | 'balance' | 'warnings'> | null;

  @Prop()
  finalisedAt?: Date;

  @Prop()
  voidReason?: string;

  @Prop({ type: [BillEvent], default: [] })
  history: BillEvent[];
}

export type BillDocument = HydratedDocument<Bill>;
export const BillSchema = SchemaFactory.createForClass(Bill);
BillSchema.index({ tenantId: 1, reservationId: 1 });
BillSchema.index({ tenantId: 1, openFor: 1 }, { unique: true, partialFilterExpression: { openFor: { $exists: true } } });
BillSchema.index({ tenantId: 1, propertyId: 1, status: 1, functionDate: 1 });
