import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'terminated';

@Schema({ _id: false })
export class CustomDomain {
  @Prop({ required: true, lowercase: true, trim: true })
  domain: string;

  @Prop({ default: false })
  verified: boolean;
}

@Schema({ _id: false })
export class Approval {
  @Prop({ type: String, required: true, enum: ['payment', 'manual'] })
  method: 'payment' | 'manual';

  /** Payment reference, or the name of the Banquet.ai admin who approved. */
  @Prop({ required: true })
  reference: string;

  @Prop({ required: true })
  at: Date;
}

@Schema({ timestamps: true })
export class Tenant {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  subdomain: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  contactName: string;

  @Prop({ required: true, lowercase: true, trim: true })
  contactEmail: string;

  @Prop({ required: true, trim: true })
  contactMobile: string;

  @Prop({ type: String, required: true, default: 'pending' })
  status: TenantStatus;

  @Prop({ type: Approval })
  approval?: Approval;

  @Prop({ type: [CustomDomain], default: [] })
  customDomains: CustomDomain[];
}

export type TenantDocument = HydratedDocument<Tenant>;
export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ 'customDomains.domain': 1 }, { unique: true, sparse: true });
