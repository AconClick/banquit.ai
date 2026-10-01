import { writeFileSync } from 'node:fs';
import { calculateBill, round2, type BillLineInput, type Discount, type TaxRate } from '../../src/billing/bill-engine.js';
import { proforma } from '../../src/pricing/proforma.js';

/** Small seeded random generator so a failing case can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const TAXES: TaxRate[][] = [
  [],
  [{ id: 'c', name: 'CGST 2.5%', type: 'percentage', rate: 2.5 }, { id: 's', name: 'SGST 2.5%', type: 'percentage', rate: 2.5 }],
  [{ id: 'g', name: 'GST 18%', type: 'percentage', rate: 18 }],
  [{ id: 'v', name: 'VAT 5%', type: 'percentage', rate: 5 }, { id: 'm', name: 'Municipality 7%', type: 'percentage', rate: 7 }, { id: 'f', name: 'Tourism fee', type: 'fixed', rate: 15 }],
  [{ id: 'f', name: 'Tourism fee', type: 'fixed', rate: 15 }],
];

describe('bill arithmetic fuzz', () => {
  it('keeps every invariant over 20,000 random bills', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 20_000; seed++) {
      const r = rng(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
      const money = () => pick([0, 0.01, 0.99, 1, 9.99, 99.5, 149.99, 950, 1199.99, 2500, 7500, 125000.55]);
      const disc = (): Discount | null => {
        const k = r();
        if (k < 0.5) return null;
        return k < 0.75
          ? { type: 'percent', value: pick([1, 5, 10, 12.5, 33.33, 50, 99.99, 100]), reason: 'x' }
          : { type: 'amount', value: pick([0.01, 1, 10, 99.99, 500, 1e6]), reason: 'x' };
      };
      const lines: BillLineInput[] = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => {
        const pkg = r() < 0.4;
        return {
          id: `L${i}`, source: pkg ? 'package' : pick(['extra', 'running', 'hallHire'] as const), aType: pkg ? 'package' : pick(['alacarte', 'services'] as const),
          label: `L${i}`, guaranteedPax: pkg ? pick([1, 37, 100, 250]) : undefined, actualPax: pkg ? pick([null, 0, 36, 80, 120]) : null,
          qty: pick([0.5, 1, 3, 7, 12.25]), rate: money(), taxInclusive: r() < 0.5, taxes: pick(TAXES), discount: disc(),
        };
      });
      const input = { lines, billDiscount: disc(), roundTotal: r() < 0.5, advances: pick([0, 1000, 99999.99]), paid: 0 };
      const b = calculateBill(input);
      const say = (what: string) => problems.push(`seed ${seed}: ${what}`);

      for (const l of b.lines) {
        if (l.taxable < 0) say(`${l.label} taxable ${l.taxable} < 0 (rate ${l.rate}, inclusive ${l.taxInclusive}, discount ${l.discount}, amount ${l.amount})`);
        if (l.discount > l.amount + 1e-9) say(`${l.label} discount ${l.discount} > amount ${l.amount}`);
        if (l.taxes.some((t) => t.amount < 0)) say(`${l.label} negative tax`);
        if (Math.abs(round2(l.taxable + l.taxes.reduce((s, t) => s + t.amount, 0)) - l.total) > 1e-9) say(`${l.label} total does not add up`);
        // A tax-inclusive line: the guest pays the discounted inclusive amount, no more.
        // (Fixed taxes are always charged in full, so a rate below them is the one exception.)
        const fixed = round2(input.lines.find((x) => x.id === l.id)!.taxes.filter((t) => t.type === 'fixed').reduce((s, t) => s + t.rate, 0) * l.qty);
        if (l.taxInclusive && l.total > Math.max(round2(l.amount - l.discount), fixed) + 1e-9) say(`${l.label} inclusive total ${l.total} > agreed ${round2(l.amount - l.discount)}`);
      }
      const billDisc = round2(b.discount - b.lines.reduce((s, l, i) => s + Math.min(l.amount, input.lines[i].discount ? (input.lines[i].discount!.type === 'percent' ? l.amount * Math.min(input.lines[i].discount!.value, 100) / 100 : input.lines[i].discount!.value) : 0), 0));
      if (billDisc < -0.011) say(`bill discount share negative ${billDisc}`);
      for (const t of b.taxes) {
        const sum = round2(b.lines.flatMap((l) => l.taxes).filter((x) => x.id === t.id).reduce((s, x) => s + x.amount, 0));
        if (Math.abs(sum - t.amount) > 1e-9) say(`tax ${t.id} summary ${t.amount} != lines ${sum}`);
      }
      if (Math.abs(round2(b.taxable + b.taxTotal + b.roundOff) - b.total) > 1e-9) say('total != taxable + tax + round off');
      if (Math.abs(b.roundOff) > 0.5 + 1e-9) say(`round off ${b.roundOff}`);
      if (input.roundTotal && !Number.isInteger(b.total)) say('rounded total has paise');
      if (Math.abs(round2(b.total - b.advances - b.paid) - b.balance) > 1e-9) say('balance');

      // With no discounts the bill must match the booking's proforma.
      if (!input.billDiscount && lines.every((l) => !l.discount)) {
        const pf = proforma(lines.map((l) => ({ label: l.label, aType: l.aType, qty: l.source === 'package' ? Math.max(l.guaranteedPax ?? 0, l.actualPax ?? 0) : l.qty, rate: l.rate, taxInclusive: l.taxInclusive, taxes: l.taxes })), input.roundTotal);
        if (Math.abs(pf.total - b.total) > 1e-9) say(`proforma ${pf.total} != bill ${b.total}`);
      }
    }
    const kinds = new Map<string, { n: number; first: string }>();
    for (const p of problems) {
      const key = p.replace(/^seed \d+: /, '').replace(/[\d.-]+/g, '#').replace(/L#/g, 'L');
      const k = kinds.get(key) ?? { n: 0, first: p };
      k.n++;
      kinds.set(key, k);
    }
    writeFileSync(`${process.env.PROBE_OUT ?? '/tmp'}/bill-math.json`, JSON.stringify([...kinds.values()], null, 2));
    expect([...kinds.values()]).toEqual([]);
  });
});
