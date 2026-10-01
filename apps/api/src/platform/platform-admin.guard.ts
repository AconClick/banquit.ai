import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../config.js';

/**
 * Protects Banquet.ai's own admin endpoints. A shared token for now; replaced by named
 * support-staff logins with OTP when the admin console is built.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(ctx.switchToHttp().getRequest<Request>().header('x-platform-token') ?? '');
    const expected = Buffer.from(config.platformAdminToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Platform admin access only.');
    }
    return true;
  }
}
