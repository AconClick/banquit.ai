import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, RoleDocument } from './role.schema.js';
import { ALL_PERMISSIONS, BUILT_IN_ROLES } from './permissions.js';

@Injectable()
export class RolesService implements OnApplicationBootstrap {
  constructor(@InjectModel(Role.name) private readonly roles: Model<Role>) {}

  /** Built-in roles always hold every permission, including ones added by later releases. */
  async onApplicationBootstrap() {
    await this.roles.updateMany({ builtIn: true }, { $set: { permissions: ALL_PERMISSIONS } });
  }

  /** Creates the built-in Enterprise Admin and Implementation roles; safe to call twice. */
  async ensureBuiltIns(tenantId: Types.ObjectId) {
    const result: Record<keyof typeof BUILT_IN_ROLES, RoleDocument> = {} as never;
    for (const [key, name] of Object.entries(BUILT_IN_ROLES) as [keyof typeof BUILT_IN_ROLES, string][]) {
      result[key] = await this.roles.findOneAndUpdate(
        { tenantId, nameKey: name.toLowerCase() },
        { $set: { name, permissions: ALL_PERMISSIONS, builtIn: true } },
        { upsert: true, returnDocument: 'after' },
      );
    }
    return result;
  }

  list(tenantId: Types.ObjectId) {
    return this.roles.find({ tenantId }).sort({ builtIn: -1, name: 1 });
  }

  async get(tenantId: Types.ObjectId, id: string): Promise<RoleDocument> {
    const role = Types.ObjectId.isValid(id) ? await this.roles.findOne({ tenantId, _id: id }) : null;
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  async create(tenantId: Types.ObjectId, name: string, permissions: string[]) {
    this.checkPermissions(permissions);
    if (await this.nameTaken(tenantId, name)) throw new ConflictException('A role with this name already exists.');
    return this.roles.create({ tenantId, name: name.trim(), permissions, builtIn: false });
  }

  async update(tenantId: Types.ObjectId, id: string, name: string, permissions: string[]) {
    const role = await this.get(tenantId, id);
    if (role.builtIn) throw new BadRequestException('Built-in roles cannot be changed.');
    this.checkPermissions(permissions);
    if (await this.nameTaken(tenantId, name, role._id)) throw new ConflictException('A role with this name already exists.');
    role.name = name.trim();
    role.permissions = permissions;
    return role.save();
  }

  private checkPermissions(permissions: string[]) {
    const unknown = permissions.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
  }

  private async nameTaken(tenantId: Types.ObjectId, name: string, exceptId?: Types.ObjectId) {
    const filter: Record<string, unknown> = { tenantId, nameKey: name.trim().toLowerCase() };
    if (exceptId) filter._id = { $ne: exceptId };
    return !!(await this.roles.exists(filter));
  }
}
