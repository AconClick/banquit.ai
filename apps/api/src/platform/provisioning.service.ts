import { ConflictException, Injectable } from '@nestjs/common';
import { RolesService } from '../roles/roles.service.js';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { UsersService, type NewUser } from '../users/users.service.js';

@Injectable()
export class ProvisioningService {
  constructor(
    private readonly tenants: TenantsService,
    private readonly roles: RolesService,
    private readonly users: UsersService,
  ) {}

  /**
   * Approves a pending tenant, either automatically when payment is confirmed or manually by a
   * Banquet.ai admin. Creates the built-in roles and the entp master user, whose password is emailed
   * to the client's contact email.
   */
  async approve(tenant: TenantDocument, method: 'payment' | 'manual', reference: string) {
    if (tenant.status !== 'pending') throw new ConflictException(`This account is already ${tenant.status}.`);
    tenant.status = 'active';
    tenant.approval = { method, reference, at: new Date() };
    tenant.statusHistory.push({ from: 'pending', to: 'active', at: new Date(), by: method === 'payment' ? 'Payment confirmed' : reference, reason: method === 'payment' ? `Payment ${reference}` : 'Approved' });
    await tenant.save();

    const builtIns = await this.roles.ensureBuiltIns(tenant._id);
    await this.users.create(
      tenant._id,
      {
        userId: 'entp',
        firstName: tenant.name,
        lastName: '',
        email: tenant.contactEmail,
        mobile: tenant.contactMobile,
        roleId: builtIns.enterprise.id as string,
      },
      'entp',
      this.tenants.loginHost(tenant),
    );
    return tenant;
  }

  /** A named login for a Banquet.ai implementation engineer, with the built-in Implementation role. */
  async addImplementationUser(tenant: TenantDocument, input: Omit<NewUser, 'roleId'>) {
    const builtIns = await this.roles.ensureBuiltIns(tenant._id);
    return this.users.create(
      tenant._id,
      { ...input, roleId: builtIns.implementation.id as string },
      'implementation',
      this.tenants.loginHost(tenant),
    );
  }
}
