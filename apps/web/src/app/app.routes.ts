import { Routes } from '@angular/router';
import { activityGuard } from './core/guards';
import { Login } from './login/login';
import { PasswordReset } from './login/password-reset';
import { MasterPage } from './master/master-page';
import { RolesPage } from './master/roles-page';
import { UsersPage } from './master/users-page';
import { Diary } from './operations/diary/diary';
import { Shell } from './shell';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Log in · Banquet.ai' },
  { path: 'forgot-password', component: PasswordReset, title: 'Forgot password · Banquet.ai' },
  { path: 'reset-password', component: PasswordReset, title: 'Reset password · Banquet.ai' },
  {
    path: 'operations',
    component: Shell,
    canActivate: [activityGuard('operations')],
    children: [{ path: '', component: Diary, title: 'Reservation Diary · Banquet.ai' }],
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
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
