import { currencyDecimals, roundTo } from './money.js';
import { proforma } from './proforma.js';

describe('currency decimals', () => {
  it('uses each currency’s minor unit', () => {
    expect(['INR', 'AED', 'USD', 'SAR', 'GBP'].map(currencyDecimals)).toEqual([2, 2, 2, 2, 2]);
    expect(['KWD', 'BHD', 'OMR', 'JOD', 'TND'].map(currencyDecimals)).toEqual([3, 3, 3, 3, 3]);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('kwd')).toBe(3);
  });

  it('falls back to two decimals for unknown or missing codes', () => {
    expect(currencyDecimals('XXQ')).toBe(2);
    expect(currencyDecimals('')).toBe(2);
    expect(currencyDecimals(undefined)).toBe(2);
  });

  it('rounds to the decimals asked for, exactly as round2 does at 2', () => {
    expect(roundTo(1.0005, 3)).toBe(1.001);
    expect(roundTo(2.345, 2)).toBe(2.35);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(1234.5, 0)).toBe(1235);
  });

  it('prices a proforma to three decimals for a dinar property', () => {
    const p = proforma([{ label: 'Set menu', aType: 'package', qty: 7, rate: 4.125, taxInclusive: false, taxes: [{ id: 'v', name: 'VAT', type: 'percentage', rate: 5 }] }], false, 3);
    expect(p).toMatchObject({ taxable: 28.875, taxTotal: 1.444, total: 30.319 });
  });
});
