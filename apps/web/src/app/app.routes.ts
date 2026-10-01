import { Routes } from '@angular/router';
import { activityGuard } from './core/guards';
import { Login } from './login/login';
import { PasswordReset } from './login/password-reset';
import { MasterPage } from './master/master-page';
import { PropertySettingsPage } from './master/property-settings-page';
import { RateMappingPage } from './master/rate-mapping-page';
import { RolesPage } from './master/roles-page';
import { SupportAccessPage } from './master/support-access-page';
import { UsersPage } from './master/users-page';
import { BookingPage } from './operations/booking/booking-page';
import { FunctionSheet } from './operations/booking/function-sheet';
import { Diary } from './operations/diary/diary';
import { Reports } from './operations/reports/reports';
import { Shell } from './shell';
import { SupportConsole } from './support/support-console';
import { SupportEnter } from './support/support-enter';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Log in · Banquet.ai' },
  { path: 'forgot-password', component: PasswordReset, title: 'Forgot password · Banquet.ai' },
  { path: 'reset-password', component: PasswordReset, title: 'Reset password · Banquet.ai' },
  { path: 'support', component: SupportConsole, title: 'Support console · Banquet.ai' },
  { path: 'support-enter', component: SupportEnter, title: 'Support session · Banquet.ai' },
  {
    path: 'operations',
    component: Shell,
    canActivate: [activityGuard('operations')],
    children: [
      { path: '', component: Diary, title: 'Reservation Diary · Banquet.ai' },
      { path: 'bookings/:id', component: BookingPage, title: 'Booking · Banquet.ai' },
      { path: 'bookings/:id/sheet', component: FunctionSheet, title: 'Function sheet · Banquet.ai' },
      { path: 'reports', component: Reports, title: 'Reports · Banquet.ai' },
      // Billing loads on first use, keeping the first page small.
      { path: 'billing', loadComponent: () => import('./operations/billing/bills-page').then((m) => m.BillsPage), title: 'Bills · Banquet.ai' },
      { path: 'billing/:id', loadComponent: () => import('./operations/billing/bill-page').then((m) => m.BillPage), title: 'Bill · Banquet.ai' },
      { path: 'billing/:id/print', loadComponent: () => import('./operations/billing/bill-print').then((m) => m.BillPrint), title: 'Print bill · Banquet.ai' },
    ],
  },
  {
    path: 'master',
    component: Shell,
    canActivate: [activityGuard('master')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      { path: 'users', component: UsersPage, title: 'Users · Banquet.ai' },
      { path: 'roles', component: RolesPage, title: 'Roles · Banquet.ai' },
      { path: 'data/:kind', component: MasterPage, title: 'Master setup · Banquet.ai' },
      { path: 'rates', component: RateMappingPage, title: 'Rate & Tax Mapping · Banquet.ai' },
      { path: 'property-settings', component: PropertySettingsPage, title: 'Property Settings · Banquet.ai' },
      { path: 'support-access', component: SupportAccessPage, title: 'Support Access · Banquet.ai' },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
