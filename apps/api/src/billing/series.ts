/**
 * Document numbering (Series Setup): the financial year, and numbers such as B/2026-27/000001.
 * Pure functions; the counters live in the billing setup service.
 */
import type { Series, SeriesDocument } from './billing-setup.schema.js';

/** India's financial year starts in April; each property can choose its own month. */
export const DEFAULT_FY_START_MONTH = 4;

export const DEFAULT_SERIES: Record<SeriesDocument, Series> = {
  bill: { prefix: 'B/{FY}/', digits: 6, resetYearly: true },
  /** CN/26-27/000001: 15 characters, inside GST's 16. */
  creditNote: { prefix: 'CN/{FYSHORT}/', digits: 6, resetYearly: true },
};

export const SERIES_LABELS: Record<SeriesDocument, string> = { bill: 'Bills', creditNote: 'Credit notes' };

/** Financial year label for a date: 2026-27 for 2026-10-01 when the year starts in April, 2026 when it starts in January. */
export function financialYear(date: string, startMonth = DEFAULT_FY_START_MONTH) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (startMonth === 1) return String(y);
  const first = m >= startMonth ? y : y - 1;
  return `${first}-${String((first + 1) % 100).padStart(2, '0')}`;
}

/** {FY} → 2026-27, {FYSHORT} → 26-27 (2026 and 26 for a calendar year). */
export function expandPrefix(prefix: string, fy: string) {
  const short = fy.includes('-') ? `${fy.slice(2, 4)}-${fy.slice(5)}` : fy.slice(2);
  return prefix.replaceAll('{FYSHORT}', short).replaceAll('{FY}', fy);
}

export const formatNumber = (series: Series, fy: string, seq: number) => `${expandPrefix(series.prefix, fy)}${String(seq).padStart(series.digits, '0')}`;

/** Counter key: per property, per document, and per financial year when the series restarts yearly. */
export function counterName(doc: SeriesDocument, propertyId: string, series: Series, fy: string) {
  return series.resetYearly ? `${doc}:${propertyId}:${fy}` : `${doc}:${propertyId}`;
}

/** Problems with a series, in words for the setup screen. */
export function seriesProblems(label: string, s: Partial<Series> | undefined): string[] {
  const problems: string[] = [];
  if (!s || typeof s !== 'object') return [`${label}: choose a prefix and the number of digits.`];
  const prefix = typeof s.prefix === 'string' ? s.prefix : '';
  const bare = prefix.replaceAll('{FYSHORT}', '').replaceAll('{FY}', '');
  if (!/^[A-Za-z0-9/-]*$/.test(bare)) problems.push(`${label}: the prefix can use letters, digits, / and - only, plus {FY} or {FYSHORT}.`);
  if (prefix.length > 20) problems.push(`${label}: keep the prefix to 20 characters.`);
  if (!Number.isInteger(s.digits) || (s.digits as number) < 1 || (s.digits as number) > 10) problems.push(`${label}: digits must be a whole number from 1 to 10.`);
  if (typeof s.resetYearly !== 'boolean') problems.push(`${label}: say whether numbering restarts each financial year.`);
  // Restarting every year without the year in the number would print the same number twice.
  else if (s.resetYearly && bare === prefix) problems.push(`${label}: put {FY} or {FYSHORT} in the prefix, or the restarted numbers repeat last year's.`);
  return problems;
}

/** India GST: an invoice number is at most 16 characters (Rule 46). */
export const GST_NUMBER_MAX = 16;
