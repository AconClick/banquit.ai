export type Activity = 'master' | 'operations';

export interface User {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  roleId: string;
  kind: 'entp' | 'implementation' | 'standard';
  active: boolean;
  locked: boolean;
  mustChangePassword: boolean;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  builtIn: boolean;
}

export interface SessionResponse {
  token: string;
  user: User;
  activity: Activity | null;
  activities: Activity[];
  mustChangePassword: boolean;
}

export interface TenantInfo {
  subdomain: string;
  name: string;
  active: boolean;
  message: string | null;
}

export const ACTIVITY_LABELS: Record<Activity, string> = {
  operations: 'Operations',
  master: 'Master',
};
