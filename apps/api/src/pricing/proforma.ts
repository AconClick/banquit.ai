/**
 * Proforma and bill arithmetic (docs/workflows/billing-stages.md, stage 5). Pure functions so the
 * same numbers come out of the proforma, the draft bill and the tests.
 */
export interface TaxRate {
  id: string;
  name: string;
  type: 'percentage' | 'fixed';
  /** Percent for percentage taxes; an amount per unit (pax, plate, hour) for fixed taxes. */
  rate: number;
}

export interface PriceLine {
  label: string;
  aType: 'package' | 'alacarte' | 'services';
  qty: number;
  /** Agreed rate per unit, with or without tax as taxInclusive says. */
  rate: number;
  taxInclusive: boolean;
  taxes: TaxRate[];
}

export interface PricedLine extends Omit<PriceLine, 'taxes'> {
  /** qty × rate as agreed (tax included when the rate includes tax). */
  amount: number;
  taxable: number;
  taxes: { id: string; name: string; amount: number }[];
  total: number;
}

export interface Proforma {
  lines: PricedLine[];
  taxable: number;
  taxes: { id: string; name: string; amount: number }[];
  taxTotal: number;
  roundOff: number;
  total: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function priceLine(line: PriceLine): PricedLine {
  const pct = line.taxes.filter((t) => t.type === 'percentage');
  const fixed = line.taxes.filter((t) => t.type === 'fixed');
  const p = pct.reduce((s, t) => s + t.rate / 100, 0);
  const f = fixed.reduce((s, t) => s + t.rate, 0);
  const amount = round2(line.qty * line.rate);

  let taxable: number;
  let taxes: { id: string; name: string; amount: number }[];
  if (line.taxInclusive) {
    // Back-calculate so the guest pays exactly the agreed inclusive price:
    // taxable per unit = (R − fixed taxes) / (1 + percentage taxes).
    const unitTaxable = Math.max(0, (line.rate - f) / (1 + p));
    taxes = [
      ...pct.map((t) => ({ id: t.id, name: t.name, amount: round2(line.qty * unitTaxable * (t.rate / 100)) })),
      ...fixed.map((t) => ({ id: t.id, name: t.name, amount: round2(line.qty * t.rate) })),
    ];
    // A rate below the fixed taxes (say a fully discounted line) leaves nothing taxable: the fixed
    // taxes are still charged, as on a tax-exclusive line, and the taxable value never goes negative.
    taxable = Math.max(0, round2(amount - taxes.reduce((s, t) => s + t.amount, 0)));
  } else {
    taxable = amount;
    taxes = [
      ...pct.map((t) => ({ id: t.id, name: t.name, amount: round2(taxable * (t.rate / 100)) })),
      ...fixed.map((t) => ({ id: t.id, name: t.name, amount: round2(line.qty * t.rate) })),
    ];
  }
  const total = round2(taxable + taxes.reduce((s, t) => s + t.amount, 0));
  return { label: line.label, aType: line.aType, qty: line.qty, rate: line.rate, taxInclusive: line.taxInclusive, amount, taxable, taxes, total };
}

export function proforma(lines: PriceLine[], roundTotal: boolean): Proforma {
  const priced = lines.map(priceLine);
  const byTax = new Map<string, { id: string; name: string; amount: number }>();
  for (const l of priced) {
    for (const t of l.taxes) {
      const sum = byTax.get(t.id) ?? { id: t.id, name: t.name, amount: 0 };
      sum.amount = round2(sum.amount + t.amount);
      byTax.set(t.id, sum);
    }
  }
  const taxable = round2(priced.reduce((s, l) => s + l.taxable, 0));
  const taxTotal = round2([...byTax.values()].reduce((s, t) => s + t.amount, 0));
  const gross = round2(taxable + taxTotal);
  const total = roundTotal ? Math.round(gross) : gross;
  return { lines: priced, taxable, taxes: [...byTax.values()], taxTotal, roundOff: round2(total - gross), total };
}
