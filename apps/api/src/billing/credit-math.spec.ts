import { calculateBill, type BillLineInput, type TaxRate } from './bill-engine.js';
import { creditLine, creditTotals, remainingOnLine } from './credit-math.js';

const cgst: TaxRate = { id: 'cgst', name: 'CGST 9%', type: 'percentage', rate: 9 };
const sgst: TaxRate = { id: 'sgst', name: 'SGST 9%', type: 'percentage', rate: 9 };
const line = (over: Partial<BillLineInput>): BillLineInput => ({
  id: 'a', source: 'running', aType: 'services', label: 'DJ', qty: 1, rate: 1000, taxInclusive: false, taxes: [cgst, sgst], ...over,
});

describe('credit notes', () => {
  const bill = calculateBill({
    roundTotal: true,
    lines: [line({ id: 'dj', rate: 999.99 }), line({ id: 'decor', label: 'Decor', rate: 333.33, taxes: [cgst, sgst] })],
  });

  it('reverses taxes in the proportion they were charged', () => {
    const c = creditLine(bill.lines[0], [], 590);
    expect(c.total).toBe(590);
    expect(c.taxes.map((t) => t.amount)).toEqual([45, 45]);
    expect(c.taxable).toBe(500);
  });

  it('credits exactly what is left, however earlier credits rounded', () => {
    const first = creditLine(bill.lines[0], [], 333.33);
    const rest = creditLine(bill.lines[0], [first], 10_000);
    expect(rest.total).toBe(Math.round((bill.lines[0].total - first.total) * 100) / 100);
    expect(first.taxable + rest.taxable).toBeCloseTo(bill.lines[0].taxable, 6);
    expect(first.taxes[0].amount + rest.taxes[0].amount).toBeCloseTo(bill.lines[0].taxes[0].amount, 6);
    expect(remainingOnLine(bill.lines[0], [first, rest]).total).toBe(0);
  });

  it('a credit for the whole bill comes to the bill total, round-off included', () => {
    const full = creditTotals(bill, [], 0, bill.lines.map((l) => ({ lineId: l.id, amount: l.total })));
    expect(full.total).toBe(bill.total);
    expect(full.roundOff).toBe(bill.roundOff);
    expect(full.taxes).toEqual(bill.taxes);
  });

  it('leaves the round-off on the bill until the last line is credited', () => {
    const part = creditTotals(bill, [], 0, [{ lineId: 'dj', amount: bill.lines[0].total }]);
    expect(part.roundOff).toBe(0);
    const last = creditTotals(bill, part.lines, 0, [{ lineId: 'decor', amount: bill.lines[1].total }]);
    expect(part.total + last.total).toBeCloseTo(bill.total, 6);
  });

  it('keeps fils for a three-decimal currency', () => {
    const kwd = calculateBill({ roundTotal: false, decimals: 3, lines: [line({ rate: 12.345, taxes: [{ id: 'v', name: 'Levy', type: 'percentage', rate: 5 }] })] });
    const c = creditLine(kwd.lines[0], [], 6.481, 3);
    expect(c).toMatchObject({ total: 6.481, taxes: [{ amount: 0.309 }], taxable: 6.172 });
  });
});
