import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
import { config } from '../config.js';

/**
 * The browser keeps the session in an httpOnly cookie that page scripts cannot read, so an injected
 * script cannot steal it. `__Host-` makes the browser keep it to this exact host over HTTPS, so one
 * client's address never sends it to another's.
 */
export const SESSION_COOKIE = config.secureCookies ? '__Host-bq_session' : 'bq_session';

/** Header every state-changing request that authenticates by cookie must carry (blocks cross-site form posts). */
export const CSRF_HEADER = 'x-banquet-csrf';

export function setSessionCookie(res: Response, token: string) {
  // No expiry: the cookie ends with the browser; the token inside still expires on its own.
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/' });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/' });
}

/** The session token a request carries: an Authorization header (API clients) or the session cookie (browser). */
export function requestToken(req: Request): { token: string; from: 'header' | 'cookie' } | null {
  const header = req.header('authorization');
  if (header) {
    const token = header.replace(/^Bearer\s+/i, '').trim();
    return token ? { token, from: 'header' } : null;
  }
  const cookie = readCookie(req.header('cookie'), SESSION_COOKIE);
  return cookie ? { token: cookie, from: 'cookie' } : null;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Put on routes that start or change a session: moves the `token` from the JSON body into the
 * session cookie, so the token never reaches page scripts.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string') {
          const { token, ...rest } = body as { token: string };
          setSessionCookie(res, token);
          return rest;
        }
        return body;
      }),
    );
  }
}
