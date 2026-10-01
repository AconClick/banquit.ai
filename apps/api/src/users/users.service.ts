import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notifier } from '../notifications/notifier.js';
import { generatePassword, hashPassword } from '../common/passwords.js';
import { RolesService } from '../roles/roles.service.js';
import { User, UserDocument, UserKind } from './user.schema.js';

export interface NewUser {
  userId: string;
  firstName: string;
  lastName?: string;
  email: string;
  mobile?: string;
  roleId: string;
}

export interface UserChanges {
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
  roleId?: string;
}

/** What the API returns for a user; never includes hashes, OTPs or session ids. */
export function publicUser(user: UserDocument) {
  return {
    id: user.id as string,
    userId: user.userId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    mobile: user.mobile,
    roleId: String(user.roleId),
    kind: user.kind,
    active: user.active,
    locked: !!user.lockedUntil && user.lockedUntil > new Date(),
    mustChangePassword: user.mustChangePassword,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly roles: RolesService,
    private readonly notifier: Notifier,
  ) {}

  list(tenantId: Types.ObjectId) {
    return this.users.find({ tenantId }).sort({ userId: 1 });
  }

  async get(tenantId: Types.ObjectId, id: string): Promise<UserDocument> {
    const user = Types.ObjectId.isValid(id) ? await this.users.findOne({ tenantId, _id: id }) : null;
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  /**
   * Creates a user with a random password, emailed to them. They must change it on first login.
   * `kind` is set by the platform for entp and implementation users; tenants create standard users.
   */
  async create(tenantId: Types.ObjectId, input: NewUser, kind: UserKind = 'standard', loginHost?: string) {
    const userId = input.userId.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(userId)) {
      throw new BadRequestException('User id must be 3 to 30 letters, digits, dots, dashes or underscores.');
    }
    if (userId === 'entp' && kind !== 'entp') throw new BadRequestException('The user id entp is reserved.');
    await this.roles.get(tenantId, input.roleId);
    if (await this.users.exists({ tenantId, userId })) throw new ConflictException('This user id already exists.');

    const password = generatePassword();
    const user = await this.users.create({
      ...input,
      tenantId,
      userId,
      kind,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    });
    await this.notifier.send({
      channel: 'email',
      to: user.email,
      subject: 'Your Banquet.ai login',
      body: `Login at ${loginHost ?? 'your Banquet.ai address'} with user id "${userId}" and password ${password}. You will be asked to change the password when you first log in.`,
    });
    return user;
  }

  async update(tenantId: Types.ObjectId, id: string, changes: UserChanges) {
    const user = await this.get(tenantId, id);
    if (changes.roleId !== undefined) {
      if (user.kind !== 'standard') throw new BadRequestException('The role of this user cannot be changed.');
      await this.roles.get(tenantId, changes.roleId);
      user.roleId = new Types.ObjectId(changes.roleId);
    }
    for (const key of ['firstName', 'lastName', 'email', 'mobile'] as const) {
      if (changes[key] !== undefined) user[key] = changes[key];
    }
    return user.save();
  }

  /** entp can never be disabled. Implementation users stay active until the client's admin disables them. */
  async setActive(tenantId: Types.ObjectId, id: string, active: boolean, actingUserId: string) {
    const user = await this.get(tenantId, id);
    if (user.kind === 'entp' && !active) throw new BadRequestException('The entp user cannot be disabled.');
    if (user.id === actingUserId && !active) throw new BadRequestException('You cannot disable yourself.');
    user.active = active;
    if (!active) user.set('sessionId', undefined);
    return user.save();
  }

  async unlock(tenantId: Types.ObjectId, id: string) {
    const user = await this.get(tenantId, id);
    user.failedLogins = 0;
    user.set('lockedUntil', undefined);
    return user.save();
  }
}
