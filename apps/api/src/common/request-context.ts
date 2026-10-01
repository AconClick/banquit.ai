import { createParamDecorator, ExecutionContext, ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { TenantDocument } from '../tenants/tenant.schema.js';
import type { UserDocument } from '../users/user.schema.js';
import type { RoleDocument } from '../roles/role.schema.js';
import type { Activity } from '../roles/permissions.js';
import type { SupportSessionDocument } from '../support/support.schema.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TENANT_STATUS_MESSAGES } from '../tenants/subdomain-rules.js';

export interface AuthContext {
  user: UserDocument;
  role: RoleDocument;
  activity?: Activity;
  /** Set when Banquet.ai support is in the tenant; user and role are then stand-ins, never stored. */
  support?: SupportSessionDocument;
}

export interface AppRequest extends Request {
  tenant?: TenantDocument | null;
  auth?: AuthContext;
}

/** Attaches the tenant the request is for (from host name or X-Tenant header), or null. */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantsService) {}

  async use(req: AppRequest, _res: Response, next: NextFunction) {
    try {
      req.tenant = await this.tenants.resolve(req.headers.host, req.header('x-tenant') ?? undefined);
      next();
    } catch (err) {
      next(err);
    }
  }
}

/** The request's tenant. Fails if there is none, or (by default) if it is not active. */
export const CurrentTenant = createParamDecorator((opts: { allowInactive?: boolean } | undefined, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  if (!tenant) throw new NotFoundException('Domain not found.');
  if (tenant.status !== 'active' && !opts?.allowInactive) {
    throw new ForbiddenException(TENANT_STATUS_MESSAGES[tenant.status] ?? 'This account is not active.');
  }
  return tenant;
});

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().auth as AuthContext;
});
