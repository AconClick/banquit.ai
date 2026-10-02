/**
 * Amounts are kept in the property's currency to that currency's minor unit: 2 decimals for most
 * (INR, AED, USD), 3 for the Gulf dinars and rials (KWD, BHD, OMR), 0 for some (JPY).
 */

const cache = new Map<string, number>();

/** Decimal places for an ISO 4217 currency code, from the runtime's currency data. Unknown codes get 2. */
export function currencyDecimals(code: string | null | undefined): number {
  const c = typeof code === 'string' ? code.toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(c)) return 2;
  let dp = cache.get(c);
  if (dp === undefined) {
    try {
      dp = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      dp = 2;
    }
    cache.set(c, dp);
  }
  return dp;
}

/** Rounds to the given decimals; with 2 it is exactly round2, so two-decimal amounts are unchanged. */
export function roundTo(n: number, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** A rounding function for one currency's decimals. */
export const rounder = (decimals = 2) => (n: number) => roundTo(n, decimals);
