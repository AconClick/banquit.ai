import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/** One record of any master kind. Field values are checked against the kind's definition. */
@Schema({ timestamps: true, collection: 'masters' })
export class MasterRecord {
  @Prop({ type: Types.ObjectId, required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  kind: string;

  /** Lowercase copy of the kind's unique field, so it is unique regardless of case. */
  @Prop({ required: true })
  uniqueKey: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  values: Record<string, unknown>;
}

export type MasterRecordDocument = HydratedDocument<MasterRecord>;
export const MasterRecordSchema = SchemaFactory.createForClass(MasterRecord);
MasterRecordSchema.index({ tenantId: 1, kind: 1, uniqueKey: 1 }, { unique: true });
