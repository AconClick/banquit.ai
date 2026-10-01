import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { EInvoiceRecord } from './bill.schema.js';
import type { CreditedLine, CreditTotals } from './credit-math.js';

export const CREDIT_NOTE_STATUSES = ['issued', 'cancelled'] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

/**
 * A credit note against a final bill (GST: a credit note under section 34). Reports read
 * { tenantId, propertyId, billId, date, status, totals.taxable, totals.total }.
 */
@Schema({ timestamps: true, collection: 'creditNotes' })
export class CreditNote {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  propertyId: string;

  @Prop({ required: true })
  billId: string;

  @Prop({ required: true })
  billNumber: string;

  /** The bill's date, which a GST credit note must quote. */
  @Prop({ required: true })
  billDate: string;

  @Prop({ required: true })
  reservationId: string;

  @Prop({ required: true })
  reservationNumber: string;

  @Prop({ required: true })
  hostName: string;

  /** From the credit-note series, e.g. CN/2026-27/000001. */
  @Prop({ required: true })
  number: string;

  /** Issue date at the property. */
  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  reason: string;

  @Prop({ type: String, required: true })
  status: CreditNoteStatus;

  @Prop({ required: true })
  currency: string;

  @Prop({ required: true })
  decimals: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  totals: CreditTotals;

  @Prop({ required: true })
  byUserId: string;

  @Prop()
  cancelledAt?: Date;

  @Prop()
  cancelReason?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  eInvoice: EInvoiceRecord | null;
}

export type CreditNoteDocument = HydratedDocument<CreditNote>;
export const CreditNoteSchema = SchemaFactory.createForClass(CreditNote);
CreditNoteSchema.index({ tenantId: 1, billId: 1 });
CreditNoteSchema.index({ tenantId: 1, propertyId: 1, date: 1 });

export type { CreditedLine };
