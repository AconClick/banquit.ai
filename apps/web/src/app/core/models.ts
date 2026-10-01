export type Activity = 'master' | 'operations';

export interface User {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  roleId: string;
  kind: 'entp' | 'implementation' | 'standard' | 'support';
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
  user: User;
  activity: Activity | null;
  activities: Activity[];
  mustChangePassword: boolean;
  /** Present when Banquet.ai support is inside the account. */
  support?: SupportSessionInfo;
}

export interface SupportSessionInfo {
  id: string;
  tenant?: { subdomain: string; name: string };
  supportName: string;
  reason: string;
  ticket: string;
  emergency: boolean;
  status: 'pending' | 'denied' | 'active' | 'ended';
  mode: 'read' | 'edit';
  editReason: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  actions: { at: string; method: string; path: string }[];
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
