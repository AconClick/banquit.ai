import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PrintSetup } from './print-setup.js';

/** Documents that take a number from a series. */
export const SERIES_DOCUMENTS = ['bill', 'creditNote'] as const;
export type SeriesDocument = (typeof SERIES_DOCUMENTS)[number];

/** How one document is numbered: prefix (with {FY} etc.), digits, and whether it restarts each financial year. */
export interface Series {
  prefix: string;
  digits: number;
  resetYearly: boolean;
}

/** Billing setup for one property (Master panel › Billing Setup). Saved only once changed; defaults otherwise. */
@Schema({ timestamps: true })
export class BillingSetup {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  propertyId: string;

  /** Month the financial year starts, 1-12 (India: April = 4). */
  @Prop({ required: true })
  fyStartMonth: number;

  @Prop({ type: Object, required: true })
  series: Record<SeriesDocument, Series>;

  /** Print Setup: logo, header, titles, footer and columns. */
  @Prop({ type: Object })
  print?: Partial<PrintSetup>;
}

export type BillingSetupDocument = HydratedDocument<BillingSetup>;
export const BillingSetupSchema = SchemaFactory.createForClass(BillingSetup);
BillingSetupSchema.index({ tenantId: 1, propertyId: 1 }, { unique: true });
