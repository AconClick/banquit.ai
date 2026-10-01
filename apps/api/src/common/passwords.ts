import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';

const ROUNDS = 10;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** At least 8 characters, with at least one letter and one digit. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return 'Password must contain letters and digits.';
  return null;
}

/** Random password for new accounts: 16 characters from an unambiguous alphabet, with a letter and a digit. */
export function generatePassword(length = 16): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export const generateOtp = (digits: number) => String(randomInt(10 ** digits)).padStart(digits, '0');
export const randomToken = () => randomBytes(32).toString('hex');
/** Fast hash for short-lived secrets (OTPs, reset tokens) that are compared once. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
