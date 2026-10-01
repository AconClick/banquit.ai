/**
 * Bill arithmetic (docs/workflows/billing-stages.md, stage 5). Pure functions. Billable pax and
 * discounts are worked out here; taxes, including the tax-inclusive back-calculation, come from
 * the same priceLine as the booking's proforma, so the proforma and the bill always agree.
 */

import { priceLine, round2, type TaxRate } from '../pricing/proforma.js';

export { round2, type TaxRate };
export type AType = 'package' | 'alacarte' | 'services';
/** Where a bill line came from. */
export type LineSource = 'package' | 'extra' | 'running' | 'hallHire' | 'liquorLicence';

export interface Discount {
  type: 'percent' | 'amount';
  value: number;
  reason: string;
}

export interface BillLineInput {
  id: string;
  source: LineSource;
  aType: AType;
  label: string;
  /** Package lines: billed on max(guaranteed, actual). Actual is null until entered. */
  guaranteedPax?: number;
  actualPax?: number | null;
  /** Every other line: the quantity billed. Ignored for package lines. */
  qty: number;
  rate: number;
  /** The rate already includes tax, so tax is back-calculated (open-questions.md, section 4). */
  taxInclusive: boolean;
  taxes: TaxRate[];
  discount?: Discount | null;
}

export interface TaxAmount {
  id: string;
  name: string;
  amount: number;
}

export interface PricedBillLine {
  id: string;
  source: LineSource;
  aType: AType;
  label: string;
  guaranteedPax: number | null;
  actualPax: number | null;
  /** Quantity billed: billable pax for packages. */
  qty: number;
  rate: number;
  taxInclusive: boolean;
  /** qty × rate as agreed (tax included when the rate includes tax). */
  amount: number;
  /** Line discount plus this line's share of the bill discount. */
  discount: number;
  taxable: number;
  taxes: TaxAmount[];
  total: number;
}

export interface BillTotals {
  lines: PricedBillLine[];
  /** Sum of line amounts before discounts. */
  amount: number;
  discount: number;
  taxable: number;
  taxes: TaxAmount[];
  taxTotal: number;
  roundOff: number;
  total: number;
  /** Advances received before the bill, applied first. */
  advances: number;
  /** Payments taken against the bill, less refunds. */
  paid: number;
  /** Still to collect. Negative when the guest has paid more than the bill (refund or credit due). */
  balance: number;
  warnings: string[];
}

export interface BillInput {
  lines: BillLineInput[];
  billDiscount?: Discount | null;
  roundTotal: boolean;
  advances?: number;
  paid?: number;
  /** Booking-level expected max, for the "more guests than expected" warning. */
  expectedMaxPax?: number;
}

const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0));

/** Billable pax = max(guaranteed, actual). Before the actual count is entered, the guarantee. */
export const billablePax = (guaranteed: number, actual: number | null | undefined) =>
  actual === null || actual === undefined ? guaranteed : Math.max(guaranteed, actual);

export const lineQty = (l: BillLineInput) => (l.source === 'package' ? billablePax(l.guaranteedPax ?? 0, l.actualPax) : l.qty);

const discountOn = (amount: number, d: Discount | null | undefined) => {
  if (!d || !(d.value > 0)) return 0;
  const value = d.type === 'percent' ? (amount * Math.min(d.value, 100)) / 100 : d.value;
  return round2(Math.min(amount, value));
};

/**
 * Taxes for one line on its amount after discounts. A discounted tax-inclusive line stays at the
 * discounted inclusive amount, and the taxable value is worked back from it (open-questions.md,
 * section 4: discount the inclusive rate, then back-calculate).
 */
function taxLine(net: number, qty: number, l: BillLineInput) {
  const priced = priceLine({ label: l.label, aType: l.aType, qty, rate: qty > 0 ? net / qty : 0, taxInclusive: l.taxInclusive, taxes: l.taxes });
  return { taxable: priced.taxable, taxes: priced.taxes };
}

export function calculateBill(input: BillInput): BillTotals {
  const warnings: string[] = [];
  const base = input.lines.map((l) => {
    const qty = lineQty(l);
    const amount = round2(qty * l.rate);
    const lineDiscount = discountOn(amount, l.discount);
    return { l, qty, amount, lineDiscount, net: round2(amount - lineDiscount) };
  });

  // The bill discount is shared across lines in proportion to their amount after line discounts;
  // the last line with an amount takes the rounding difference.
  const netTotal = sum(base.map((b) => b.net));
  const billDiscount = discountOn(netTotal, input.billDiscount);
  const shares = base.map(() => 0);
  if (billDiscount > 0 && netTotal > 0) {
    let left = billDiscount;
    const last = base.map((b) => b.net > 0).lastIndexOf(true);
    base.forEach((b, i) => {
      if (b.net <= 0) return;
      shares[i] = i === last ? left : Math.min(left, round2((billDiscount * b.net) / netTotal));
      left = round2(left - shares[i]);
    });
  }

  const lines: PricedBillLine[] = base.map((b, i) => {
    const net = round2(b.net - shares[i]);
    const { taxable, taxes } = taxLine(net, b.qty, b.l);
    return {
      id: b.l.id,
      source: b.l.source,
      aType: b.l.aType,
      label: b.l.label,
      guaranteedPax: b.l.source === 'package' ? (b.l.guaranteedPax ?? 0) : null,
      actualPax: b.l.source === 'package' ? (b.l.actualPax ?? null) : null,
      qty: b.qty,
      rate: b.l.rate,
      taxInclusive: b.l.taxInclusive,
      amount: b.amount,
      discount: round2(b.lineDiscount + shares[i]),
      taxable,
      taxes,
      total: round2(taxable + sum(taxes.map((t) => t.amount))),
    };
  });

  const byTax = new Map<string, TaxAmount>();
  for (const l of lines) {
    for (const t of l.taxes) {
      const s = byTax.get(t.id) ?? { id: t.id, name: t.name, amount: 0 };
      s.amount = round2(s.amount + t.amount);
      byTax.set(t.id, s);
    }
  }
  const taxable = sum(lines.map((l) => l.taxable));
  const taxTotal = sum([...byTax.values()].map((t) => t.amount));
  const gross = round2(taxable + taxTotal);
  const total = input.roundTotal ? Math.round(gross) : gross;
  const advances = round2(input.advances ?? 0);
  const paid = round2(input.paid ?? 0);

  const packages = input.lines.filter((l) => l.source === 'package');
  for (const l of packages) {
    if (l.actualPax === null || l.actualPax === undefined) warnings.push(`${l.label}: enter the actual pax. Billed on the guarantee until then.`);
  }
  const actual = packages.reduce((s, l) => s + (l.actualPax ?? 0), 0);
  if (input.expectedMaxPax && actual > input.expectedMaxPax) {
    warnings.push(`${actual} guests came, more than the expected max of ${input.expectedMaxPax}. Add a remark if needed.`);
  }

  return {
    lines,
    amount: sum(base.map((b) => b.amount)),
    discount: sum(lines.map((l) => l.discount)),
    taxable,
    taxes: [...byTax.values()],
    taxTotal,
    roundOff: round2(total - gross),
    total,
    advances,
    paid,
    balance: round2(total - advances - paid),
    warnings,
  };
}
