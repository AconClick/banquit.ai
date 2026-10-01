import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** A subscription plan Banquet.ai sells. Plans are never deleted, only made unavailable. */
@Schema({ timestamps: true })
export class Plan {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, default: 'INR', uppercase: true, trim: true })
  currency: string;

  @Prop({ required: true, default: 0 })
  monthlyPrice: number;

  @Prop({ required: true, default: 0 })
  yearlyPrice: number;

  /** 0 means no limit. */
  @Prop({ default: 0 })
  maxProperties: number;

  /** 0 means no limit. */
  @Prop({ default: 0 })
  maxUsers: number;

  @Prop({ default: true })
  active: boolean;

  @Prop({ default: '', trim: true })
  notes: string;
}

export type PlanDocument = HydratedDocument<Plan>;
export const PlanSchema = SchemaFactory.createForClass(Plan);

export const PAYMENT_METHODS = ['bank', 'upi', 'card', 'gateway', 'cheque', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A subscription payment from a client to Banquet.ai (not the hotel's own guest payments). */
@Schema({ timestamps: true, collection: 'platformpayments' })
export class PlatformPayment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, uppercase: true })
  currency: string;

  @Prop({ type: String, required: true })
  method: PaymentMethod;

  @Prop({ default: '', trim: true })
  reference: string;

  /** The period this payment covers ("YYYY-MM-DD", inclusive). */
  @Prop({ required: true })
  periodFrom: string;

  @Prop({ required: true })
  periodTo: string;

  @Prop()
  planCode?: string;

  @Prop({ required: true })
  recordedBy: string;

  @Prop({ default: '', trim: true })
  note: string;
}

export type PlatformPaymentDocument = HydratedDocument<PlatformPayment>;
export const PlatformPaymentSchema = SchemaFactory.createForClass(PlatformPayment);

/** What a Banquet.ai admin did in the console, for the record. */
@Schema({ timestamps: { createdAt: 'at', updatedAt: false }, collection: 'adminactions' })
export class AdminAction {
  @Prop({ required: true })
  by: string;

  @Prop({ type: Types.ObjectId, index: true })
  tenantId?: Types.ObjectId;

  @Prop({ required: true })
  action: string;

  @Prop({ default: '' })
  detail: string;

  at: Date;
}

export type AdminActionDocument = HydratedDocument<AdminAction>;
export const AdminActionSchema = SchemaFactory.createForClass(AdminAction);
