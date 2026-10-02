import { currencyDecimals, formatMoney, roundTo } from './money';

describe('money', () => {
  it('shows each currency to its own decimals', () => {
    expect(currencyDecimals('INR')).toBe(2);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('OMR')).toBe(3);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals(null)).toBe(2);
    expect(formatMoney(1234.5, 'BHD')).toBe((1234.5).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
    expect(formatMoney(1234.5, 2)).toBe((1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(formatMoney(null, 'KWD')).toBe('');
  });

  it('rounds like the server', () => {
    expect(roundTo(4.32075, 3)).toBe(4.321);
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
});
