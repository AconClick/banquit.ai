import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionService } from './session.service';
import { TenantService } from './tenant.service';

/**
 * Adds the tenant header (development) and the CSRF header, and sends the user to login on 401.
 * The session itself travels in an httpOnly cookie that this code never sees.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const tenant = inject(TenantService);
  const router = inject(Router);

  let headers = req.headers.set('X-Banquet-Csrf', '1');
  const domain = tenant.headerDomain();
  if (domain) headers = headers.set('X-Tenant', domain);
  // A request that carries its own token (the support console) is not about this app's session.
  const ownToken = req.headers.has('Authorization');

  return next(req.clone({ headers })).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !ownToken && session.loggedIn() && !req.url.endsWith('/auth/login')) {
        session.clear(errorMessage(err));
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};

/** The server's message for a failed request, for showing to the user. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const msg = err.error?.message;
    if (Array.isArray(msg)) return msg.join(' ');
    if (typeof msg === 'string') return msg;
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
