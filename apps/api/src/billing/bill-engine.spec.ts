import { billablePax, calculateBill, type BillLineInput, type TaxRate } from './bill-engine.js';

const gst5: TaxRate = { id: 'gst5', name: 'GST 5%', type: 'percentage', rate: 5 };
const gst18: TaxRate = { id: 'gst18', name: 'GST 18%', type: 'percentage', rate: 18 };
const cess: TaxRate = { id: 'cess', name: 'Cess', type: 'fixed', rate: 10 };

const pkg = (over: Partial<BillLineInput> = {}): BillLineInput => ({
  id: 'p1', source: 'package', aType: 'package', label: 'Buffet Lunch', guaranteedPax: 100, actualPax: null,
  qty: 0, rate: 1000, taxInclusive: false, taxes: [gst5], ...over,
});
const line = (over: Partial<BillLineInput> = {}): BillLineInput => ({
  id: 'x1', source: 'running', aType: 'alacarte', label: 'Mocktail', qty: 10, rate: 150, taxInclusive: false, taxes: [gst18], ...over,
});

describe('billable pax', () => {
  it('bills the higher of guaranteed and actual (guest-count-rules.md examples)', () => {
    expect(billablePax(100, 80)).toBe(100);
    expect(billablePax(100, 110)).toBe(110);
    expect(billablePax(100, 130)).toBe(130);
    expect(billablePax(100, 100)).toBe(100);
    expect(billablePax(100, null)).toBe(100);
  });

  it('applies the max per package line', () => {
    const bill = calculateBill({
      roundTotal: false,
      lines: [
        pkg({ id: 'veg', label: 'Veg', guaranteedPax: 60, actualPax: 30, rate: 100, taxes: [] }),
        pkg({ id: 'nonveg', label: 'Non-Veg', guaranteedPax: 40, actualPax: 70, rate: 100, taxes: [] }),
      ],
    });
    expect(bill.lines.map((l) => l.qty)).toEqual([60, 70]);
    expect(bill.total).toBe(13000);
  });
});

describe('calculateBill', () => {
  it('adds taxes on exclusive rates and sums them by tax', () => {
    const bill = calculateBill({ roundTotal: false, lines: [pkg({ actualPax: 110 }), line()] });
    expect(bill.lines[0]).toMatchObject({ qty: 110, amount: 110000, taxable: 110000, total: 115500 });
    expect(bill.lines[1]).toMatchObject({ amount: 1500, taxable: 1500, total: 1770 });
    expect(bill.taxes).toEqual([
      { id: 'gst5', name: 'GST 5%', amount: 5500 },
      { id: 'gst18', name: 'GST 18%', amount: 270 },
    ]);
    expect(bill.total).toBe(117270);
  });

  it('back-calculates tax-inclusive packages so the guest pays the agreed price (open-questions.md example)', () => {
    const bill = calculateBill({ roundTotal: false, lines: [pkg({ rate: 950, taxInclusive: true, actualPax: 80 })] });
    expect(bill.lines[0]).toMatchObject({ qty: 100, amount: 95000, taxable: 90476.19, total: 95000 });
    expect(bill.taxes[0].amount).toBe(4523.81);
  });

  it('takes fixed per-unit taxes out before back-calculating', () => {
    const bill = calculateBill({ roundTotal: false, lines: [pkg({ rate: 1060, taxInclusive: true, taxes: [gst5, cess] })] });
    // (1060 − 10) / 1.05 = 1000 taxable per pax; 50 GST and 10 cess per pax.
    expect(bill.lines[0]).toMatchObject({ taxable: 100000, total: 106000 });
    expect(bill.taxes).toEqual([
      { id: 'gst5', name: 'GST 5%', amount: 5000 },
      { id: 'cess', name: 'Cess', amount: 1000 },
    ]);
  });

  it('applies line discounts before tax, and discounts inclusive rates before back-calculating', () => {
    const bill = calculateBill({
      roundTotal: false,
      lines: [
        line({ discount: { type: 'percent', value: 10, reason: 'Regular guest' } }),
        pkg({ rate: 1050, taxInclusive: true, discount: { type: 'amount', value: 5000, reason: 'Goodwill' } }),
      ],
    });
    expect(bill.lines[0]).toMatchObject({ amount: 1500, discount: 150, taxable: 1350, total: 1593 });
    expect(bill.lines[1]).toMatchObject({ amount: 105000, discount: 5000, taxable: 95238.1, total: 100000 });
    expect(bill.discount).toBe(5150);
  });

  it('shares a bill discount across lines in proportion and never discounts below zero', () => {
    const bill = calculateBill({
      roundTotal: false,
      billDiscount: { type: 'amount', value: 1000, reason: 'Corporate rate' },
      lines: [line({ id: 'a', qty: 1, rate: 3000, taxes: [] }), line({ id: 'b', qty: 1, rate: 1000, taxes: [] })],
    });
    expect(bill.lines.map((l) => l.discount)).toEqual([750, 250]);
    expect(bill.total).toBe(3000);
    const capped = calculateBill({ roundTotal: false, billDiscount: { type: 'amount', value: 99999, reason: 'x' }, lines: [line({ taxes: [] })] });
    expect(capped.total).toBe(0);
  });

  it('rounds the total to a whole unit with a round-off line', () => {
    const bill = calculateBill({ roundTotal: true, lines: [line({ qty: 1, rate: 99.9, taxes: [gst18] })] });
    // 99.90 + 17.98 = 117.88, rounded to 118.
    expect(bill.total).toBe(118);
    expect(bill.roundOff).toBe(0.12);
  });

  it('deducts advances and payments, and shows a negative balance when the guest overpaid', () => {
    const due = calculateBill({ roundTotal: true, advances: 25000, paid: 1000, lines: [pkg({ taxes: [] })] });
    expect(due).toMatchObject({ total: 100000, advances: 25000, paid: 1000, balance: 74000 });
    const over = calculateBill({ roundTotal: true, advances: 120000, lines: [pkg({ taxes: [] })] });
    expect(over.balance).toBe(-20000);
  });

  it('warns about missing actual pax and more guests than expected', () => {
    expect(calculateBill({ roundTotal: false, lines: [pkg()] }).warnings[0]).toMatch(/enter the actual pax/);
    const busy = calculateBill({ roundTotal: false, expectedMaxPax: 120, lines: [pkg({ actualPax: 130 })] });
    expect(busy.warnings[0]).toMatch(/130 guests came, more than the expected max of 120/);
  });
});
