import { generateOtp, generatePassword, passwordProblem } from './passwords.js';
import { subdomainProblem } from '../tenants/subdomain-rules.js';
import { activitiesFor } from '../roles/permissions.js';

describe('password rules', () => {
  it('needs 8+ characters with letters and digits', () => {
    expect(passwordProblem('abc123')).toMatch(/at least 8/);
    expect(passwordProblem('abcdefgh')).toMatch(/letters and digits/);
    expect(passwordProblem('12345678')).toMatch(/letters and digits/);
    expect(passwordProblem('Prime2026')).toBeNull();
  });

  it('generates 16-character passwords that pass the policy', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(16);
      expect(passwordProblem(p)).toBeNull();
    }
  });

  it('generates zero-padded 6-digit OTPs', () => {
    for (let i = 0; i < 50; i++) expect(generateOtp(6)).toMatch(/^\d{6}$/);
  });
});

describe('sub-domain rules', () => {
  it.each(['prime', 'abc', 'hotel2026', 'a23456789012345'])('accepts %s', (v) => expect(subdomainProblem(v)).toBeNull());
  it.each(['ab', '1prime', 'prime-res', 'Prime', 'a234567890123456', 'www', 'entp'])('rejects %s', (v) =>
    expect(subdomainProblem(v)).not.toBeNull(),
  );
});

describe('activities from permissions', () => {
  it('opens a panel when the role has any permission in it', () => {
    expect(activitiesFor(['diary.view'])).toEqual(['operations']);
    expect(activitiesFor(['users.manage', 'billing.manage'])).toEqual(['operations', 'master']);
    expect(activitiesFor([])).toEqual([]);
  });
});
