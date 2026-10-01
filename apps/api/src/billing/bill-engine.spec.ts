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

  it('keeps the rounding of a shared discount off lines too small to take it (stress test seed 14471)', () => {
    const bill = calculateBill({
      roundTotal: false,
      billDiscount: { type: 'percent', value: 99.99, reason: 'x' },
      lines: [
        line({ id: 'a', qty: 12.25, rate: 1199.99, taxes: [] }),
        line({ id: 'b', qty: 7, rate: 950, taxInclusive: true, taxes: [] }),
        pkg({ id: 'c', guaranteedPax: 1, actualPax: 0, rate: 0.99, taxes: [], discount: { type: 'amount', value: 500, reason: 'x' } }),
        line({ id: 'd', qty: 1, rate: 149.99, taxes: [] }),
        pkg({ id: 'e', guaranteedPax: 100, rate: 9.99, taxes: [], discount: { type: 'amount', value: 10, reason: 'x' } }),
        line({ id: 'f', qty: 12.25, rate: 0.01, taxes: [] }),
      ],
    });
    // The last line is 0.12; it used to take 0.13 of discount and go below zero.
    for (const l of bill.lines) {
      expect(l.discount).toBeLessThanOrEqual(l.amount);
      expect(l.taxable).toBeGreaterThanOrEqual(0);
    }
  });

  it('never shows a negative taxable value when a tax-inclusive rate is below its fixed taxes', () => {
    // A fully discounted inclusive package with a 10-per-pax cess: the cess is still charged.
    const comp = calculateBill({ roundTotal: false, lines: [pkg({ rate: 1060, taxInclusive: true, taxes: [gst5, cess], discount: { type: 'percent', value: 100, reason: 'Comp' } })] });
    expect(comp.lines[0]).toMatchObject({ taxable: 0, total: 1000 });
    expect(comp.taxes).toEqual([{ id: 'gst5', name: 'GST 5%', amount: 0 }, { id: 'cess', name: 'Cess', amount: 1000 }]);
    const cheap = calculateBill({ roundTotal: false, lines: [line({ qty: 3, rate: 9.99, taxInclusive: true, taxes: [cess] })] });
    expect(cheap.lines[0]).toMatchObject({ taxable: 0, total: 30 });
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

describe('three-decimal currencies', () => {
  const vat10: TaxRate = { id: 'vat', name: 'VAT 10%', type: 'percentage', rate: 10 };

  it('keeps fils for KWD, BHD and OMR instead of rounding to two decimals', () => {
    const bhd = calculateBill({ roundTotal: false, decimals: 3, lines: [line({ qty: 3, rate: 1.234, taxes: [vat10] })] });
    expect(bhd.lines[0]).toMatchObject({ amount: 3.702, taxable: 3.702, total: 4.072 });
    expect(bhd.taxes).toEqual([{ id: 'vat', name: 'VAT 10%', amount: 0.37 }]);
    expect(bhd.total).toBe(4.072);
    // The same bill in a two-decimal currency.
    expect(calculateBill({ roundTotal: false, lines: [line({ qty: 3, rate: 1.234, taxes: [vat10] })] }).total).toBe(4.07);
  });

  it('shares a bill discount to the fils and back-calculates inclusive rates to three decimals', () => {
    const bill = calculateBill({
      roundTotal: false, decimals: 3, billDiscount: { type: 'amount', value: 1.001, reason: 'x' },
      lines: [line({ id: 'a', qty: 1, rate: 2.5, taxes: [] }), line({ id: 'b', qty: 1, rate: 2.5, taxInclusive: true, taxes: [vat10] })],
    });
    expect(bill.discount).toBe(1.001);
    expect(bill.lines.map((l) => l.discount).reduce((s, d) => s + d, 0)).toBeCloseTo(1.001, 6);
    expect(bill.lines[1].taxable + bill.lines[1].taxes[0].amount).toBeCloseTo(bill.lines[1].total, 6);
    expect(bill.total).toBe(3.999);
  });

  it('rounds a three-decimal total to a whole dinar when the property rounds totals', () => {
    const bill = calculateBill({ roundTotal: true, decimals: 3, lines: [line({ qty: 1, rate: 10.4, taxes: [vat10] })] });
    expect(bill).toMatchObject({ total: 11, roundOff: -0.44 });
  });
});
