import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { config } from '../config.js';
import { Tenant, TenantDocument } from './tenant.schema.js';
import { subdomainProblem } from './subdomain-rules.js';

export interface SignupInput {
  subdomain: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactMobile: string;
}

/**
 * Full link to a page of a tenant's app: its first verified custom domain, else its sub-domain.
 * On a single shared address (config.singleHost) the link carries the Domain instead, so the page
 * knows which client it is for.
 */
export function tenantUrl(tenant: Pick<Tenant, 'customDomains' | 'subdomain'>, path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  let host = tenant.customDomains.find((d) => d.verified)?.domain ?? `${tenant.subdomain}.${config.baseDomain}`;
  if (config.singleHost) {
    host = config.singleHost;
    query.set('domain', tenant.subdomain);
  }
  const q = query.toString();
  return `https://${host}${path}${q ? `?${q}` : ''}`;
}

@Injectable()
export class TenantsService {
  constructor(@InjectModel(Tenant.name) private readonly tenants: Model<Tenant>) {}

  async signup(input: SignupInput): Promise<TenantDocument> {
    const subdomain = input.subdomain.trim().toLowerCase();
    const problem = subdomainProblem(subdomain);
    if (problem) throw new BadRequestException(problem);
    if (await this.tenants.exists({ subdomain })) throw new ConflictException('This domain is already taken.');
    return this.tenants.create({ ...input, subdomain, status: 'pending' });
  }

  async getBySubdomain(subdomain: string): Promise<TenantDocument> {
    const tenant = await this.tenants.findOne({ subdomain: subdomain.trim().toLowerCase() });
    if (!tenant) throw new NotFoundException('Domain not found.');
    return tenant;
  }

  findById(id: unknown) {
    return this.tenants.findById(id);
  }

  /**
   * Works out which tenant a request is for, from the host name (prime.banquet.ai or a verified
   * custom domain), or from the X-Tenant header on shared hosts when that is allowed.
   */
  async resolve(host: string | undefined, headerDomain: string | undefined): Promise<TenantDocument | null> {
    const hostname = (host ?? '').split(':')[0].toLowerCase();
    const suffix = `.${config.baseDomain}`;
    if (hostname.endsWith(suffix)) {
      const label = hostname.slice(0, -suffix.length);
      if (!label.includes('.') && label !== 'app' && label !== 'www') {
        return this.tenants.findOne({ subdomain: label });
      }
    } else if (hostname && hostname !== config.baseDomain && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      const byDomain = await this.tenants.findOne({ 'customDomains.domain': hostname });
      if (byDomain?.customDomains.some((d) => d.domain === hostname && d.verified)) return byDomain;
    }
    if (config.allowTenantHeader && headerDomain) {
      return this.tenants.findOne({ subdomain: headerDomain.trim().toLowerCase() });
    }
    return null;
  }

  /** Address the login page lives at: the shared host in single-host mode, else the first verified custom domain, else the sub-domain. */
  loginHost(tenant: Tenant): string {
    if (config.singleHost) return config.singleHost;
    return tenant.customDomains.find((d) => d.verified)?.domain ?? `${tenant.subdomain}.${config.baseDomain}`;
  }

  /** Full link to a page of the tenant's app, for emails. */
  loginUrl(tenant: Tenant, path = '/login', params: Record<string, string> = {}): string {
    return tenantUrl(tenant, path, params);
  }

  async addCustomDomain(tenant: TenantDocument, domain: string, verified: boolean) {
    const clean = domain.trim().toLowerCase();
    if (!/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(clean)) throw new BadRequestException('Invalid domain.');
    if (clean.endsWith(`.${config.baseDomain}`) || clean === config.baseDomain) {
      throw new BadRequestException('Use your own domain, not a banquet.ai address.');
    }
    const taken = await this.tenants.exists({ 'customDomains.domain': clean, _id: { $ne: tenant._id } });
    if (taken) throw new ConflictException('This domain is used by another account.');
    const existing = tenant.customDomains.find((d) => d.domain === clean);
    if (existing) existing.verified = verified;
    else tenant.customDomains.push({ domain: clean, verified });
    await tenant.save();
    return tenant;
  }
}
