import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'terminated';

@Schema({ _id: false })
export class CustomDomain {
  @Prop({ required: true, lowercase: true, trim: true })
  domain: string;

  @Prop({ default: false })
  verified: boolean;

  /** Value the client puts in a TXT record at `_banquet-verify.<domain>` to prove they own it. */
  @Prop()
  verifyToken?: string;

  @Prop()
  addedAt?: Date;

  @Prop()
  verifiedAt?: Date;

  @Prop()
  lastCheckedAt?: Date;

  /** Why the last DNS check failed, in plain words. */
  @Prop()
  lastCheckError?: string;
}

/** One change of account status, with who made it and why. */
@Schema({ _id: false })
export class StatusChange {
  @Prop({ type: String })
  from: TenantStatus | null;

  @Prop({ type: String, required: true })
  to: TenantStatus;

  @Prop({ required: true })
  at: Date;

  @Prop({ required: true })
  by: string;

  @Prop({ default: '' })
  reason: string;
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

  /** How Banquet.ai support may enter: at any time (client is told), or only after the client approves. */
  @Prop({ type: String, default: 'allowed' })
  supportAccess: 'allowed' | 'ask';

  // ---- Subscription (managed in the Banquet.ai admin console) ----

  /** Code of the client's plan (see Plan). */
  @Prop()
  planCode?: string;

  /** Free use until this date ("YYYY-MM-DD"), if the client is on a trial. */
  @Prop()
  trialEndsAt?: string;

  /** Paid up to and including this date ("YYYY-MM-DD"). Moves forward as payments are recorded. */
  @Prop()
  paidUntil?: string;

  @Prop({ type: [StatusChange], default: [] })
  statusHistory: StatusChange[];
}

export type TenantDocument = HydratedDocument<Tenant>;
export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ 'customDomains.domain': 1 }, { unique: true, sparse: true });
