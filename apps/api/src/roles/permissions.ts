/**
 * Access rights a role can grant. Grouped by the panel (Activity) they belong to.
 * New modules add their permissions here.
 */
export const PERMISSIONS = {
  operations: ['diary.view', 'reservations.manage', 'billing.manage', 'reports.view'],
  master: ['roles.manage', 'users.manage', 'masters.manage', 'settings.manage'],
} as const;

export type Activity = keyof typeof PERMISSIONS;
export const ACTIVITIES = Object.keys(PERMISSIONS) as Activity[];
export type Permission = (typeof PERMISSIONS)[Activity][number];
export const ALL_PERMISSIONS: Permission[] = ACTIVITIES.flatMap((a) => [...PERMISSIONS[a]]);

export function activitiesFor(permissions: readonly string[]): Activity[] {
  return ACTIVITIES.filter((a) => PERMISSIONS[a].some((p) => permissions.includes(p)));
}

/** Built-in roles every tenant gets on approval. They cannot be edited or deleted. */
export const BUILT_IN_ROLES = {
  enterprise: 'Enterprise Admin',
  implementation: 'Implementation',
} as const;
