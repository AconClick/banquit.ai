import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Activity } from './models';
import { SessionService } from './session.service';

/** The route needs a logged-in session that has opened the given panel. */
export const activityGuard =
  (activity: Activity): CanActivateFn =>
  () => {
    const session = inject(SessionService);
    return session.activity() === activity ? true : inject(Router).createUrlTree(['/login']);
  };
