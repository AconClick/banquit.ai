import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { AdminClient } from './admin-client';
import { AdminClients } from './admin-clients';
import { AdminDashboard } from './admin-dashboard';
import { AdminPlans } from './admin-plans';
import { AdminStaff } from './admin-staff';
import { ConsoleSessions } from './console-sessions';
import { SupportApi } from './support-api';
import { SupportConsole } from './support-console';

/**
 * Admin pages are for admins only; the API checks the same. Others land on their sessions.
 * When nobody is logged in yet, the console shows its login first.
 */
const adminOnly = async () => {
  const api = inject(SupportApi);
  const router = inject(Router);
  const user = api.user() ?? (await api.me());
  return !user || user.role === 'admin' || router.parseUrl('/support');
};

export const consoleRoutes: Routes = [
  {
    path: '',
    component: SupportConsole,
    children: [
      { path: '', component: ConsoleSessions, title: 'Support sessions · Banquet.ai' },
      {
        path: 'admin',
        canActivateChild: [adminOnly],
        children: [
          { path: '', component: AdminDashboard, title: 'Overview · Banquet.ai console' },
          { path: 'clients', component: AdminClients, title: 'Clients · Banquet.ai console' },
          { path: 'clients/:subdomain', component: AdminClient, title: 'Client · Banquet.ai console' },
          { path: 'plans', component: AdminPlans, title: 'Plans · Banquet.ai console' },
          { path: 'staff', component: AdminStaff, title: 'Staff · Banquet.ai console' },
        ],
      },
    ],
  },
];
