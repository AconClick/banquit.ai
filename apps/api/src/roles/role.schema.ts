import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Role {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  /** Lowercase copy of the name, so role names are unique regardless of case. */
  @Prop({ required: true })
  nameKey: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ default: false })
  builtIn: boolean;
}

export type RoleDocument = HydratedDocument<Role>;
export const RoleSchema = SchemaFactory.createForClass(Role);
RoleSchema.index({ tenantId: 1, nameKey: 1 }, { unique: true });
RoleSchema.pre('validate', function () {
  this.nameKey = this.name.trim().toLowerCase();
});
