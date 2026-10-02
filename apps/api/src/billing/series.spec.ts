import { counterName, DEFAULT_SERIES, expandPrefix, financialYear, formatNumber, seriesProblems } from './series.js';

describe('series setup', () => {
  it('labels the financial year from the property’s start month', () => {
    expect(financialYear('2026-10-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYear('2026-10-01', 1)).toBe('2026');
    expect(financialYear('2026-06-30', 7)).toBe('2025-26');
    expect(financialYear('2026-07-01', 7)).toBe('2026-27');
    expect(financialYear('1999-12-31', 4)).toBe('1999-00');
  });

  it('builds numbers from the prefix and digits', () => {
    expect(formatNumber(DEFAULT_SERIES.bill, '2026-27', 1)).toBe('B/2026-27/000001');
    expect(formatNumber(DEFAULT_SERIES.creditNote, '2026-27', 42)).toBe('CN/26-27/000042');
    expect(formatNumber({ prefix: 'GOA/{FYSHORT}/', digits: 4, resetYearly: true }, '2026-27', 7)).toBe('GOA/26-27/0007');
    expect(expandPrefix('INV{FYSHORT}-', '2026')).toBe('INV26-');
  });

  it('keeps one counter per year only when the series restarts yearly', () => {
    expect(counterName('bill', 'p1', DEFAULT_SERIES.bill, '2026-27')).toBe('bill:p1:2026-27');
    expect(counterName('creditNote', 'p1', { prefix: 'CN-', digits: 6, resetYearly: false }, '2026-27')).toBe('creditNote:p1');
  });

  it('explains what is wrong with a series', () => {
    expect(seriesProblems('Bills', DEFAULT_SERIES.bill)).toEqual([]);
    expect(seriesProblems('Bills', { prefix: 'B 1/', digits: 6, resetYearly: false })[0]).toMatch(/letters, digits/);
    expect(seriesProblems('Bills', { prefix: 'B/', digits: 6, resetYearly: true })[0]).toMatch(/repeat last year/);
    expect(seriesProblems('Bills', { prefix: 'B/', digits: 0, resetYearly: false })[0]).toMatch(/digits/);
    expect(seriesProblems('Bills', { prefix: 'B/{FY}/ABCDEFGHIJKLMNO', digits: 6, resetYearly: true })[0]).toMatch(/20 characters/);
  });
});
