export const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'support', 'help', 'status', 'docs', 'entp',
]);

/** 3 to 15 characters, lowercase letters and digits, starting with a letter, not reserved. */
export function subdomainProblem(value: string): string | null {
  if (!/^[a-z][a-z0-9]{2,14}$/.test(value)) {
    return 'Domain must be 3 to 15 lowercase letters or digits, starting with a letter.';
  }
  if (RESERVED_SUBDOMAINS.has(value)) return 'This domain is reserved.';
  return null;
}

export const TENANT_STATUS_MESSAGES: Record<string, string> = {
  pending: 'This account is waiting for approval.',
  rejected: 'This account was not approved. Please contact Banquet.ai support.',
  suspended: 'This account is suspended. Please contact your administrator.',
  terminated: 'This account is no longer active.',
};
