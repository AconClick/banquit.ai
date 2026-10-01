import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { PropertySettingsValues } from './settings.js';

/** Things a property can price on its own: packages, menu items (ala carte and services) and modifiers. */
export const PRICED_KINDS = ['package', 'menuItem', 'modifier'] as const;
export type PricedKind = (typeof PRICED_KINDS)[number];

/**
 * Rate & Tax Mapping: one property's changes to a group-wide item. Every field left null
 * falls back to the group value (the master record) or the property's default taxes.
 */
@Schema({ timestamps: true })
export class PropertyRate {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  propertyId: string;

  @Prop({ type: String, required: true })
  kind: PricedKind;

  @Prop({ required: true })
  itemId: string;

  /** false hides the item at this property. */
  @Prop({ default: true })
  offered: boolean;

  @Prop({ type: Number, default: null })
  rate: number | null;

  @Prop({ type: Boolean, default: null })
  taxInclusive: boolean | null;

  /** Taxes for this item at this property; null means the property's default taxes for its A-Type. */
  @Prop({ type: [String], default: null })
  taxIds: string[] | null;
}

export type PropertyRateDocument = HydratedDocument<PropertyRate>;
export const PropertyRateSchema = SchemaFactory.createForClass(PropertyRate);
PropertyRateSchema.index({ tenantId: 1, propertyId: 1, kind: 1, itemId: 1 }, { unique: true });

/** Per-property business rules (Master Settings). Missing values use the defaults in settings.ts. */
@Schema({ timestamps: true })
export class PropertySettings {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  propertyId: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  values: Partial<PropertySettingsValues>;
}

export type PropertySettingsDocument = HydratedDocument<PropertySettings>;
export const PropertySettingsSchema = SchemaFactory.createForClass(PropertySettings);
PropertySettingsSchema.index({ tenantId: 1, propertyId: 1 }, { unique: true });
