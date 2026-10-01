import { writeFileSync } from 'node:fs';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { calculateBill, type TaxRate } from '../../src/billing/bill-engine.js';
import { Bill } from '../../src/billing/bill.schema.js';
import { addDays } from '../../src/reservations/local-time.js';
import { Counter, Reservation, type ReservationStatus } from '../../src/reservations/reservation.schema.js';
import { Tenant } from '../../src/tenants/tenant.schema.js';
import { startApp } from '../helpers.js';
import { today, venue, type Venue } from './fixture.js';

/**
 * Seeds a load-test database: one single-hall venue, a 3-property hotel, a 25-property chain
 * and 40 small tenants, each with about two years of bookings (past ones billed), plus the
 * tokens the load script needs. Run with MONGO_URL pointing at a throw-away database.
 */
const SIZES = {
  solo: { properties: 1, hallsPer: 1, perHallPerYear: 600 },
  regal: { properties: 3, hallsPer: 4, perHallPerYear: 600 },
  chain: { properties: 25, hallsPer: 4, perHallPerYear: 600 },
} as const;
const SMALL_TENANTS = Number(process.env.SMALL_TENANTS ?? 40);
const SLOTS = [['11:00', '15:00'], ['18:00', '23:00']] as const;
const TAXES: TaxRate[] = [
  { id: 'c', name: 'CGST 2.5%', type: 'percentage', rate: 2.5 },
  { id: 's', name: 'SGST 2.5%', type: 'percentage', rate: 2.5 },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('seed the load-test database', () => {
  it('seeds', async () => {
    const t = await startApp();
    const reservations = t.app.get<Model<Reservation>>(getModelToken(Reservation.name));
    const bills = t.app.get<Model<Bill>>(getModelToken(Bill.name));
    const counters = t.app.get<Model<Counter>>(getModelToken(Counter.name));
    const tenants = t.app.get<Model<Tenant>>(getModelToken(Tenant.name));
    const out: Record<string, unknown> = {};
    const now = today();
    const first = addDays(now, -540);
    const last = addDays(now, 180);
    let total = 0;

    async function fill(v: Venue, properties: number, hallsPer: number, perHallPerYear: number, seed: number) {
      const r = rng(seed);
      const tenantId = (await tenants.findOne({ subdomain: v.sub }))!._id;
      const docs: any[] = [];
      const billDocs: any[] = [];
      let n = 0;
      const billSeq = new Map<string, number>();
      // Two slots a day; chance per slot so each hall gets about perHallPerYear bookings a year.
      const p = Math.min(1, perHallPerYear / (365 * 2));
      for (let pi = 1; pi <= properties; pi++) {
        for (let hi = 1; hi <= hallsPer; hi++) {
          const hallId = v.ids[`p${pi}h${hi}`];
          for (let d = first; d <= last; d = addDays(d, 1)) {
            for (const [from, to] of SLOTS) {
              if (r() > p) continue;
              const past = d < now;
              const x = r();
              // One holding booking per slot, and sometimes an enquiry, lost or cancelled one alongside.
              const statuses: ReservationStatus[] = past
                ? [x < 0.75 ? 'billed' : x < 0.85 ? 'cancelled' : 'lost']
                : [x < 0.5 ? 'confirmed' : x < 0.65 ? 'provisional' : x < 0.9 ? 'enquiry' : x < 0.95 ? 'waitlisted' : 'cancelled'];
              if (r() < 0.3) statuses.push(r() < 0.5 ? 'lost' : 'enquiry');
              for (const status of statuses) {
                const pax = 50 + Math.floor(r() * 400);
                const actual = status === 'billed' ? Math.max(0, pax - 40 + Math.floor(r() * 80)) : undefined;
                const created = new Date(Date.parse(`${addDays(d, -Math.floor(r() * 120))}T10:00:00Z`));
                const id = new Types.ObjectId();
                const number = `R-${String(++n).padStart(6, '0')}`;
                const advance = ['billed', 'confirmed'].includes(status) ? Math.round(pax * 950 * 0.25) : 0;
                docs.push({
                  _id: id, tenantId, propertyId: v.ids[`p${pi}`], number, status, hostName: `Guest ${n}`, contactName: '', phone: '+919800000000', email: '',
                  functionTypeId: v.ids.wedding, guaranteedPax: pax, expectedMaxPax: pax + 30, actualPax: actual,
                  slots: [{ hallId, start: `${d}T${from}`, end: `${d}T${to}` }], notes: '',
                  packages: status === 'enquiry' || status === 'lost' ? [] : [{ packageId: v.ids.pkg, name: 'Buffet Lunch', pax, rate: 950, taxInclusive: true, choices: [v.ids.tikka] }],
                  extras: [], receipts: advance ? [{ number: `RC-${n}`, date: addDays(d, -30) < now ? addDays(d, -30) : now, amount: advance, mode: 'upi', reference: '', byUserId: 'seed', at: created }] : [],
                  history: [{ from: null, to: status, at: created, byUserId: 'seed' }], createdAt: created, updatedAt: created, __v: 0,
                });
                if (status === 'billed') {
                  const totals = calculateBill({
                    lines: [{ id: 'L1', source: 'package', aType: 'package', label: 'Buffet Lunch', guaranteedPax: pax, actualPax: actual, qty: pax, rate: 950, taxInclusive: true, taxes: TAXES }],
                    roundTotal: true, advances: advance,
                  });
                  const fy = Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1;
                  const key = `${v.ids[`p${pi}`]}:${fy}`;
                  const seq = (billSeq.get(key) ?? 0) + 1;
                  billSeq.set(key, seq);
                  const { lines, amount, discount, taxable, taxes, taxTotal, roundOff, total: sum } = totals;
                  billDocs.push({
                    tenantId, propertyId: v.ids[`p${pi}`], reservationId: String(id), reservationNumber: number, hostName: `Guest ${n}`, functionDate: d,
                    status: 'settled', number: `B/${fy}-${String((fy + 1) % 100).padStart(2, '0')}/${String(seq).padStart(6, '0')}`,
                    lines: [{ id: 'L1', source: 'package', aType: 'package', label: 'Buffet Lunch', kind: 'package', itemId: v.ids.pkg, guaranteedPax: pax, actualPax: actual, qty: pax, rate: 950, taxInclusive: true, taxIds: [v.ids.cgst, v.ids.sgst], discount: null, remark: '' }],
                    billDiscount: null, roundTotal: true, taxRates: {}, advances: advance ? [{ number: `RC-${n}`, date: d, amount: advance, mode: 'upi' }] : [],
                    payments: [{ number: `PY-${n}`, kind: 'payment', date: d, amount: totals.balance, mode: 'card', reference: '', byUserId: 'seed', at: created }],
                    totals: { lines, amount, discount, taxable, taxes, taxTotal, roundOff, total: sum }, finalisedAt: created,
                    history: [{ action: 'Seeded', at: created, byUserId: 'seed' }], createdAt: created, updatedAt: created,
                  });
                }
              }
            }
          }
        }
      }
      for (let i = 0; i < docs.length; i += 5000) await reservations.collection.insertMany(docs.slice(i, i + 5000));
      for (let i = 0; i < billDocs.length; i += 5000) await bills.collection.insertMany(billDocs.slice(i, i + 5000));
      await counters.collection.updateOne({ tenantId, name: 'reservation' }, { $set: { seq: n } }, { upsert: true });
      for (const [key, seq] of billSeq) {
        const [propertyId, fy] = key.split(':');
        await counters.collection.updateOne({ tenantId, name: `bill:${propertyId}:${fy}-${String((Number(fy) + 1) % 100).padStart(2, '0')}` }, { $set: { seq } }, { upsert: true });
      }
      total += docs.length;
      const future = docs.filter((x) => x.slots[0].start >= now);
      return {
        host: v.host, ops: v.ops, master: v.master, ids: v.ids, reservations: docs.length, bills: billDocs.length,
        sampleReservations: future.filter((_, i) => i % Math.max(1, Math.floor(future.length / 200)) === 0).map((x) => String(x._id)),
        sampleBilled: docs.filter((x) => x.status === 'billed').filter((_, i) => i % 50 === 0).slice(0, 200).map((x) => String(x._id)),
      };
    }

    let seed = 1;
    for (const [name, s] of Object.entries(SIZES)) {
      const started = Date.now();
      const v = await venue(t, name, { properties: s.properties, hallsPer: s.hallsPer });
      out[name] = await fill(v, s.properties, s.hallsPer, s.perHallPerYear, seed++);
      console.error(`seeded ${name} in ${Date.now() - started} ms`, (out[name] as any).reservations);
    }
    const small: unknown[] = [];
    for (let i = 0; i < SMALL_TENANTS; i++) {
      const v = await venue(t, `small${i}`, { properties: 1, hallsPer: 2 });
      small.push(await fill(v, 1, 2, 250, 100 + i));
    }
    out.small = small;
    out.totalReservations = total;
    writeFileSync(`${process.env.PROBE_OUT ?? '/tmp'}/seed.json`, JSON.stringify(out));
    // Leave the data in place for the load run.
    await t.app.close();
  });
});
