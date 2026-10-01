import { describe, expect, it } from 'vitest';
import { priceLine, proforma, type TaxRate } from './proforma.js';
import { slabFor, DEFAULT_SETTINGS } from './settings.js';

const gst5: TaxRate = { id: 'g', name: 'GST 5%', type: 'percentage', rate: 5 };
const cgst: TaxRate = { id: 'c', name: 'CGST 2.5%', type: 'percentage', rate: 2.5 };
const sgst: TaxRate = { id: 's', name: 'SGST 2.5%', type: 'percentage', rate: 2.5 };
const cess: TaxRate = { id: 'f', name: 'Cess', type: 'fixed', rate: 10 };

describe('proforma arithmetic', () => {
  it('back-calculates a tax-inclusive package to the agreed price (open-questions example)', () => {
    const l = priceLine({ label: 'Buffet', aType: 'package', qty: 100, rate: 950, taxInclusive: true, taxes: [gst5] });
    expect(l.amount).toBe(95000);
    expect(l.taxes[0].amount).toBe(4523.81);
    expect(l.taxable).toBe(90476.19);
    expect(l.total).toBe(95000);
  });

  it('keeps the inclusive total exact with split taxes and a fixed tax', () => {
    const l = priceLine({ label: 'Buffet', aType: 'package', qty: 37, rate: 1199, taxInclusive: true, taxes: [cgst, sgst, cess] });
    expect(l.total).toBe(37 * 1199);
    expect(l.taxes.find((t) => t.id === 'f')!.amount).toBe(370);
  });

  it('adds taxes on top of an exclusive rate', () => {
    const l = priceLine({ label: 'DJ', aType: 'services', qty: 2, rate: 7500, taxInclusive: false, taxes: [cgst, sgst] });
    expect(l.taxable).toBe(15000);
    expect(l.taxes.map((t) => t.amount)).toEqual([375, 375]);
    expect(l.total).toBe(15750);
  });

  it('totals per tax and rounds the bill with a round-off line', () => {
    const p = proforma(
      [
        { label: 'A', aType: 'alacarte', qty: 3, rate: 33.33, taxInclusive: false, taxes: [gst5] },
        { label: 'B', aType: 'alacarte', qty: 1, rate: 10, taxInclusive: false, taxes: [gst5] },
      ],
      true,
    );
    expect(p.taxable).toBe(109.99);
    expect(p.taxes).toEqual([{ id: 'g', name: 'GST 5%', amount: 5.5 }]);
    expect(p.total).toBe(115);
    expect(p.roundOff).toBe(-0.49);
  });

  it('can leave the total unrounded', () => {
    expect(proforma([{ label: 'A', aType: 'alacarte', qty: 1, rate: 10.5, taxInclusive: false, taxes: [] }], false).total).toBe(10.5);
  });
});

describe('cancellation slabs', () => {
  const slabs = DEFAULT_SETTINGS.cancellationSlabs;
  it.each([
    [45, 0], [31, 0], [30, 25], [15, 25], [14, 50], [7, 50], [6, 100], [0, 100], [-1, 100],
  ])('%i days before charges %i%%', (days, percent) => {
    expect(slabFor(slabs, days).percent).toBe(percent);
  });
});
