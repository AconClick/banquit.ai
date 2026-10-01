import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Role, User } from '../core/models';

export type PermissionCatalogue = Record<string, string[]>;

export interface UserInput {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  roleId: string;
}

@Injectable({ providedIn: 'root' })
export class MasterApi {
  private readonly http = inject(HttpClient);

  roles = () => firstValueFrom(this.http.get<Role[]>('/api/roles'));
  permissions = () => firstValueFrom(this.http.get<PermissionCatalogue>('/api/roles/permissions'));
  createRole = (name: string, permissions: string[]) =>
    firstValueFrom(this.http.post<Role>('/api/roles', { name, permissions }));
  updateRole = (id: string, name: string, permissions: string[]) =>
    firstValueFrom(this.http.put<Role>(`/api/roles/${id}`, { name, permissions }));

  users = () => firstValueFrom(this.http.get<User[]>('/api/users'));
  createUser = (input: UserInput) => firstValueFrom(this.http.post<User>('/api/users', input));
  updateUser = (id: string, changes: Partial<UserInput>) =>
    firstValueFrom(this.http.patch<User>(`/api/users/${id}`, changes));
  setActive = (id: string, active: boolean) =>
    firstValueFrom(this.http.post<User>(`/api/users/${id}/active`, { active }));
  unlock = (id: string) => firstValueFrom(this.http.post<User>(`/api/users/${id}/unlock`, {}));
}

/** Readable labels for permission codes. */
export const PERMISSION_LABELS: Record<string, string> = {
  'roles.manage': 'Roles setup',
  'users.manage': 'User management',
  'masters.manage': 'Master data (company, property, halls, menus, taxes)',
  'settings.manage': 'Master settings',
  'diary.view': 'Reservation Diary',
  'reservations.manage': 'Create and change reservations',
  'reservations.confirmWithoutAdvance': 'Confirm bookings without the full advance (with a note)',
  'billing.manage': 'Billing and settlement',
  'billing.approve': 'Finalise and void bills',
};
