import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Banquet.ai's own support staff (docs/workflows/login-and-tenancy.md, section 6). They live
 * outside every tenant, never appear in a tenant's user list and always log in with an OTP.
 */
@Schema({ timestamps: true })
export class SupportUser {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '', trim: true })
  mobile: string;

  /** Managers may use the emergency override when a client asks to approve each session. */
  @Prop({ type: String, required: true, default: 'agent' })
  role: 'agent' | 'manager';

  @Prop({ default: true })
  active: boolean;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ default: true })
  mustChangePassword: boolean;

  @Prop({ default: 0 })
  failedLogins: number;

  @Prop()
  lockedUntil?: Date;

  /** One console session at a time, as for tenant users. */
  @Prop({ select: false })
  sessionId?: string;

  @Prop()
  lastSeenAt?: Date;

  @Prop({ select: false })
  otpHash?: string;

  @Prop()
  otpExpiresAt?: Date;

  @Prop({ default: 0 })
  otpAttempts: number;
}

export type SupportUserDocument = HydratedDocument<SupportUser>;
export const SupportUserSchema = SchemaFactory.createForClass(SupportUser);

export type SupportSessionStatus = 'pending' | 'denied' | 'active' | 'ended';

@Schema({ _id: false })
export class SupportAction {
  @Prop({ required: true })
  at: Date;

  @Prop({ required: true })
  method: string;

  @Prop({ required: true })
  path: string;
}

/** One visit by a support person into one tenant, with its reason and everything they changed. */
@Schema({ timestamps: true })
export class SupportSession {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  supportUserId: Types.ObjectId;

  @Prop({ required: true })
  supportName: string;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ default: '', trim: true })
  ticket: string;

  /** A manager entered without the client's approval because the client could not be reached. */
  @Prop({ default: false })
  emergency: boolean;

  @Prop({ type: String, required: true })
  status: SupportSessionStatus;

  /** Read-only until the support person switches to edit mode with a second reason. */
  @Prop({ type: String, default: 'read' })
  mode: 'read' | 'edit';

  @Prop({ default: '' })
  editReason: string;

  @Prop({ required: true })
  requestedAt: Date;

  /** The client user who approved or denied, for "Ask each time". */
  @Prop()
  decidedBy?: string;

  @Prop()
  decidedAt?: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  endsAt?: Date;

  @Prop()
  endedAt?: Date;

  @Prop({ type: [SupportAction], default: [] })
  actions: SupportAction[];

  /** Hash of the one-time approve/decline link emailed to the client (Ask each time). */
  @Prop({ select: false })
  approvalTokenHash?: string;

  @Prop()
  approvalExpiresAt?: Date;
}

export type SupportSessionDocument = HydratedDocument<SupportSession>;
export const SupportSessionSchema = SchemaFactory.createForClass(SupportSession);
SupportSessionSchema.index({ supportUserId: 1, requestedAt: -1 });
SupportSessionSchema.index({ approvalTokenHash: 1 }, { sparse: true });
