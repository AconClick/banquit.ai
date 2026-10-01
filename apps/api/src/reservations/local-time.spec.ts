import { financialYear } from '../billing/billing.service.js';
import { isTimeZone, todayIn } from './local-time.js';

describe('the date at the hotel', () => {
  it('is the hotel date, not the server date, around midnight', () => {
    // 20:00 UTC on 31 March is 01:30 on 1 April in India, and still 31 March in London.
    const now = new Date('2027-03-31T20:00:00Z');
    expect(todayIn('Asia/Kolkata', now)).toBe('2027-04-01');
    expect(todayIn('Europe/London', now)).toBe('2027-03-31');
    expect(todayIn('America/New_York', new Date('2026-10-02T02:00:00Z'))).toBe('2026-10-01');
    // So a bill finalised then in India belongs to the new financial year.
    expect(financialYear(todayIn('Asia/Kolkata', now))).toBe('2027-28');
  });

  it('falls back to India time for properties saved without a time zone', () => {
    expect(todayIn(undefined, new Date('2026-10-01T19:00:00Z'))).toBe('2026-10-02');
    expect(todayIn('Not/AZone', new Date('2026-10-01T19:00:00Z'))).toBe('2026-10-02');
  });

  it('accepts time zone names, old and new', () => {
    expect(['Asia/Kolkata', 'Asia/Calcutta', 'Asia/Dubai', 'UTC', 'Europe/London'].every(isTimeZone)).toBe(true);
    expect(['', 'IST', 'Mars/Olympus', 42].some(isTimeZone)).toBe(false);
  });
});
