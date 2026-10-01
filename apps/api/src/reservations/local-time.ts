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

export const toMinutes = (local: string) => Date.parse(`${local}:00Z`) / 60_000;
export const fromMinutes = (minutes: number) => new Date(minutes * 60_000).toISOString().slice(0, 16);
export const addMinutes = (local: string, minutes: number) => fromMinutes(toMinutes(local) + minutes);
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
