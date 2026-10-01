/**
 * Booking times are the hotel's local wall-clock time, stored as "YYYY-MM-DDTHH:mm" strings.
 * They compare correctly as strings, and these helpers do minute arithmetic on them without
 * involving the server's time zone.
 */
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL.test(value)) return false;
  const ms = Date.parse(`${value}:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 16) === value;
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Used for properties saved before the time zone was a property field. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export function isTimeZone(value: unknown): value is string {
  // Region/City names only: abbreviations such as IST are ambiguous (India, Ireland, Israel).
  if (typeof value !== 'string' || !(value === 'UTC' || /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(value))) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The date ("YYYY-MM-DD") at the hotel right now, which is not the server's (UTC) date around midnight. */
export function todayIn(timeZone: string | null | undefined, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export const toMinutes = (local: string) => Date.parse(`${local}:00Z`) / 60_000;
export const fromMinutes = (minutes: number) => new Date(minutes * 60_000).toISOString().slice(0, 16);
export const addMinutes = (local: string, minutes: number) => fromMinutes(toMinutes(local) + minutes);
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
