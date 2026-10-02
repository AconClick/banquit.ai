/**
 * Amounts in a property's currency, to that currency's decimals: 2 for INR or AED, 3 for KWD, BHD
 * and OMR, 0 for JPY. The currency code itself is shown once, beside the figures.
 */
const cache = new Map<string, number>();

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

/** 12,345.60 (or 12,345.600 for a dinar) in the viewer's number format. Takes the decimals or the currency code. */
export function formatMoney(n: number | null | undefined, decimalsOrCurrency: number | string | null | undefined = 2) {
  if (n === null || n === undefined) return '';
  const dp = typeof decimalsOrCurrency === 'number' ? decimalsOrCurrency : currencyDecimals(decimalsOrCurrency);
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export const roundTo = (n: number, decimals = 2) => Math.round((n + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
