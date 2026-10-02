import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
import { readCookie } from '../auth/session-cookie.js';
import { config } from '../config.js';

/**
 * The Banquet.ai console keeps its own login in a separate httpOnly cookie, so it never mixes with a
 * client's session cookie on the same address (localhost in development).
 */
export const CONSOLE_COOKIE = config.secureCookies ? '__Host-bq_console' : 'bq_console';

const OPTIONS = { httpOnly: true, secure: config.secureCookies, sameSite: 'strict' as const, path: '/' };

export const setConsoleCookie = (res: Response, token: string) => res.cookie(CONSOLE_COOKIE, token, OPTIONS);
export const clearConsoleCookie = (res: Response) => res.clearCookie(CONSOLE_COOKIE, OPTIONS);

/** The console token a request carries: an Authorization header (scripts, tests) or the console cookie. */
export function consoleToken(req: Request): { token: string; from: 'header' | 'cookie' } | null {
  const header = req.header('authorization');
  if (header) {
    const token = header.replace(/^Bearer\s+/i, '').trim();
    return token ? { token, from: 'header' } : null;
  }
  const cookie = readCookie(req.header('cookie'), CONSOLE_COOKIE);
  return cookie ? { token: cookie, from: 'cookie' } : null;
}

/** Moves the console `token` from the JSON body into the console cookie. */
@Injectable()
export class ConsoleCookieInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string') {
          const { token, ...rest } = body as { token: string };
          setConsoleCookie(res, token);
          return rest;
        }
        return body;
      }),
    );
  }
}
