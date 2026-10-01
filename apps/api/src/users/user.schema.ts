import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** entp: the client's built-in master account. implementation: a named Banquet.ai engineer. */
export type UserKind = 'entp' | 'implementation' | 'standard';

@Schema({ timestamps: true })
export class User {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  tenantId: Types.ObjectId;

  /** Login id, unique within a tenant, stored lowercase so login is case-insensitive. */
  @Prop({ required: true, lowercase: true, trim: true })
  userId: string;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ default: '', trim: true })
  lastName: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ default: '', trim: true })
  mobile: string;

  @Prop({ type: Types.ObjectId, required: true })
  roleId: Types.ObjectId;

  @Prop({ type: String, required: true, default: 'standard' })
  kind: UserKind;

  @Prop({ default: true })
  active: boolean;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ type: [String], default: [], select: false })
  passwordHistory: string[];

  @Prop({ default: true })
  mustChangePassword: boolean;

  @Prop({ default: 0 })
  failedLogins: number;

  @Prop()
  lockedUntil?: Date;

  /** The one live session. A new login replaces it, which ends the old session. */
  @Prop({ select: false })
  sessionId?: string;

  @Prop()
  lastSeenAt?: Date;

  @Prop({ select: false })
  otpHash?: string;

  @Prop()
  otpExpiresAt?: Date;

  @Prop()
  otpSentAt?: Date;

  @Prop({ default: 0 })
  otpAttempts: number;

  @Prop({ select: false })
  resetTokenHash?: string;

  @Prop()
  resetExpiresAt?: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
