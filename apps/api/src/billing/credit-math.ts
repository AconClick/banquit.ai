/**
 * Credit note arithmetic. A credit note gives back part or all of what a final bill charged,
 * line by line, with each line's taxes reversed in the same proportion as they were charged.
 * Pure functions, so the numbers can be tested without a database.
 */
import { rounder } from '../pricing/money.js';
import type { PricedBillLine, TaxAmount } from './bill-engine.js';

export interface CreditedLine {
  billLineId: string;
  label: string;
  aType: string;
  taxable: number;
  taxes: TaxAmount[];
  total: number;
}

export interface CreditTotals {
  lines: CreditedLine[];
  taxable: number;
  taxes: TaxAmount[];
  taxTotal: number;
  roundOff: number;
  total: number;
}

/** What is still open to credit on a bill line, after the credit notes already issued. */
export function remainingOnLine(line: PricedBillLine, issued: CreditedLine[], decimals = 2) {
  const round = rounder(decimals);
  const before = issued.filter((c) => c.billLineId === line.id);
  return {
    taxable: round(line.taxable - before.reduce((s, c) => s + c.taxable, 0)),
    taxes: line.taxes.map((t) => ({
      ...t,
      amount: round(t.amount - before.reduce((s, c) => s + (c.taxes.find((x) => x.id === t.id)?.amount ?? 0), 0)),
    })),
    total: round(line.total - before.reduce((s, c) => s + c.total, 0)),
  };
}

/**
 * Credits `amount` (tax included) on a line. The full remaining amount reverses exactly what is
 * left of each tax; a part reverses each tax pro rata, and the taxable value takes the rounding.
 */
export function creditLine(line: PricedBillLine, issued: CreditedLine[], amount: number, decimals = 2): CreditedLine {
  const round = rounder(decimals);
  const left = remainingOnLine(line, issued, decimals);
  const base = { billLineId: line.id, label: line.label, aType: line.aType };
  if (round(amount) >= left.total) return { ...base, taxable: left.taxable, taxes: left.taxes, total: left.total };
  const share = left.total > 0 ? amount / left.total : 0;
  const taxes = left.taxes.map((t) => ({ ...t, amount: round(t.amount * share) }));
  const total = round(amount);
  return { ...base, taxes, total, taxable: round(total - taxes.reduce((s, t) => s + t.amount, 0)) };
}

/**
 * The credit note: requested lines, totalled. When it leaves nothing open on the bill, the
 * bill's round-off is reversed too, so a fully credited bill comes to exactly zero.
 */
export function creditTotals(
  bill: { lines: PricedBillLine[]; roundOff: number },
  issued: CreditedLine[],
  issuedRoundOff: number,
  requested: { lineId: string; amount: number }[],
  decimals = 2,
): CreditTotals {
  const round = rounder(decimals);
  const lines = requested
    .map((r) => creditLine(bill.lines.find((l) => l.id === r.lineId)!, issued, r.amount, decimals))
    .filter((l) => l.total > 0 || l.taxable > 0);
  const byTax = new Map<string, TaxAmount>();
  for (const l of lines) {
    for (const t of l.taxes) {
      const s = byTax.get(t.id) ?? { id: t.id, name: t.name, amount: 0 };
      s.amount = round(s.amount + t.amount);
      byTax.set(t.id, s);
    }
  }
  const after = [...issued, ...lines];
  const nothingLeft = bill.lines.every((l) => remainingOnLine(l, after, decimals).total <= 0);
  const roundOff = nothingLeft ? round(bill.roundOff - issuedRoundOff) : 0;
  const taxable = round(lines.reduce((s, l) => s + l.taxable, 0));
  const taxTotal = round([...byTax.values()].reduce((s, t) => s + t.amount, 0));
  return { lines, taxable, taxes: [...byTax.values()], taxTotal, roundOff, total: round(taxable + taxTotal + roundOff) };
}
