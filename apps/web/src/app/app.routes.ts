import { Routes } from '@angular/router';
import { activityGuard } from './core/guards';
import { Login } from './login/login';
import { PasswordReset } from './login/password-reset';
import { MasterPage } from './master/master-page';
import { PropertySettingsPage } from './master/property-settings-page';
import { RateMappingPage } from './master/rate-mapping-page';
import { RolesPage } from './master/roles-page';
import { UsersPage } from './master/users-page';
import { BookingPage } from './operations/booking/booking-page';
import { FunctionSheet } from './operations/booking/function-sheet';
import { Diary } from './operations/diary/diary';
import { Shell } from './shell';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Log in · Banquet.ai' },
  { path: 'forgot-password', component: PasswordReset, title: 'Forgot password · Banquet.ai' },
  { path: 'reset-password', component: PasswordReset, title: 'Reset password · Banquet.ai' },
  // The Banquet.ai console loads on first use; client users never download it.
  { path: 'support', loadChildren: () => import('./support/console.routes').then((m) => m.consoleRoutes) },
  { path: 'support-approval', loadComponent: () => import('./support/support-approval').then((m) => m.SupportApproval), title: 'Support request · Banquet.ai' },
  { path: 'support-enter', loadComponent: () => import('./support/support-enter').then((m) => m.SupportEnter), title: 'Support session · Banquet.ai' },
  {
    path: 'operations',
    component: Shell,
    canActivate: [activityGuard('operations')],
    children: [
      { path: '', component: Diary, title: 'Reservation Diary · Banquet.ai' },
      { path: 'bookings/:id', component: BookingPage, title: 'Booking · Banquet.ai' },
      { path: 'bookings/:id/sheet', component: FunctionSheet, title: 'Function sheet · Banquet.ai' },
      { path: 'reports', loadComponent: () => import('./operations/reports/reports').then((m) => m.Reports), title: 'Reports · Banquet.ai' },
      // Billing loads on first use, keeping the first page small.
      { path: 'billing', loadComponent: () => import('./operations/billing/bills-page').then((m) => m.BillsPage), title: 'Bills · Banquet.ai' },
      { path: 'billing/:id', loadComponent: () => import('./operations/billing/bill-page').then((m) => m.BillPage), title: 'Bill · Banquet.ai' },
      { path: 'billing/:id/credit-notes/:cnId', loadComponent: () => import('./operations/billing/credit-note-print').then((m) => m.CreditNotePrint), title: 'Credit note · Banquet.ai' },
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
      { path: 'billing-setup', loadComponent: () => import('./master/billing-setup-page').then((m) => m.BillingSetupPage), title: 'Billing Setup · Banquet.ai' },
      { path: 'support-access', loadComponent: () => import('./master/support-access-page').then((m) => m.SupportAccessPage), title: 'Support Access · Banquet.ai' },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
