import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BillSchema } from '../billing/bill.schema.js';
import { ReservationSchema } from '../reservations/reservation.schema.js';
import type { SummaryKind } from './report-summary.js';

/** One property's report figures for one month (see report-summary.ts). Rebuilt, never edited. */
@Schema({ minimize: false })
export class ReportSummary {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ type: String, required: true })
  kind: SummaryKind;

  @Prop({ required: true })
  propertyId: string;

  /** YYYY-MM. */
  @Prop({ required: true })
  month: string;

  @Prop({ required: true })
  builtAt: Date;

  /**
   * Every booking or bill the build read, with the version read (its updatedAt), so a later
   * change to any of them finds this summary and shows whether it was already counted.
   */
  @Prop({ type: [{ _id: { type: Types.ObjectId, required: true }, at: Date }], default: [] })
  sources: { _id: Types.ObjectId; at: Date | null }[];

  /** Figures by day, read when a range starts or ends inside the month. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  days: Record<string, unknown>;

  /** The whole month's figures, read when a range covers all of it. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  total: Record<string, unknown>;
}

export const ReportSummarySchema = SchemaFactory.createForClass(ReportSummary);
ReportSummarySchema.index({ tenantId: 1, kind: 1, propertyId: 1, month: 1 }, { unique: true });
ReportSummarySchema.index({ tenantId: 1, 'sources._id': 1 });

/** Per tenant: up to when changes to bookings and bills have been applied to the summaries. */
@Schema()
export class ReportWatermark {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  checkedAt: Date;
}

export const ReportWatermarkSchema = SchemaFactory.createForClass(ReportWatermark);

// Before each report the cache reads the bookings and bills changed since its last check
// (report-cache.service.ts). Declared here, beside the reader, so their modules stay untouched.
ReservationSchema.index({ tenantId: 1, updatedAt: 1 });
BillSchema.index({ tenantId: 1, updatedAt: 1 });
