// Load generator for a running API seeded by seed.stress.ts. Plain Node, no dependencies.
//   node test/stress/load.mjs <seed.json> <base url> [scenario...] > results.json
// Each scenario runs a number of virtual users in a loop for a fixed time and reports latency
// percentiles, throughput and errors.
import { readFileSync } from 'node:fs';

const [seedFile, base = 'http://127.0.0.1:3100', ...only] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
const SECONDS = Number(process.env.SECONDS ?? 20);
const today = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const tenants = { solo: seed.solo, regal: seed.regal, chain: seed.chain };
const everyone = [seed.solo, seed.regal, seed.chain, ...seed.small];

async function call(v, method, path, body) {
  const started = performance.now();
  try {
    const init = { method, headers: { 'x-tenant': v.host.split('.')[0], authorization: `Bearer ${v.ops}`, 'content-type': 'application/json' } };
    if (body) init.body = JSON.stringify(body);
    const res = await fetch(`${base}/api/${path}`, init);
    const text = await res.text();
    return { ms: performance.now() - started, status: res.status, bytes: text.length, text };
  } catch (err) {
    return { ms: performance.now() - started, status: 0, bytes: 0, text: String(err) };
  }
}

const propertyOf = (v) => v.ids[`p${1 + Math.floor(Math.random() * Object.keys(v.ids).filter((k) => /^p\d+$/.test(k)).length)}`];
const hallsOf = (v, p) => Object.keys(v.ids).filter((k) => new RegExp(`^p${p}h\\d+$`).test(k));

/** Operations a user does, each returning [label, method, path, body]. */
const ops = {
  diary: (v) => ['diary week', 'GET', `diary?propertyId=${propertyOf(v)}&from=${addDays(today, Math.floor(Math.random() * 60) - 7)}&days=7`],
  details: (v) => ['booking details', 'GET', `reservations/${pick(v.sampleReservations)}/details`],
  billView: (v) => ['bill screen', 'GET', `billing/reservations/${pick(v.sampleBilled)}`],
  billList: () => ['bill list (month)', 'GET', `billing/bills?from=${addDays(today, -60)}&to=${addDays(today, -30)}`],
  enquiry: (v) => {
    const props = Object.keys(v.ids).filter((k) => /^p\d+$/.test(k)).length;
    const p = 1 + Math.floor(Math.random() * props);
    const hall = pick(hallsOf(v, p));
    const day = addDays(today, 30 + Math.floor(Math.random() * 120));
    return ['create enquiry', 'POST', 'reservations', {
      propertyId: v.ids[`p${p}`], status: 'enquiry', hostName: 'Load', phone: '+919800000000', functionTypeId: v.ids.wedding,
      guaranteedPax: 100, expectedMaxPax: 120, slots: [{ hallId: v.ids[hall], start: `${day}T11:00`, end: `${day}T15:00` }],
    }];
  },
  hold: (v) => {
    // A provisional booking in a far-off year, so it rarely clashes, but still checks the hall's whole history.
    const props = Object.keys(v.ids).filter((k) => /^p\d+$/.test(k)).length;
    const p = 1 + Math.floor(Math.random() * props);
    const hall = pick(hallsOf(v, p));
    const day = addDays('2029-01-01', Math.floor(Math.random() * 3000));
    const h = String(Math.floor(Math.random() * 22)).padStart(2, '0');
    return ['create provisional', 'POST', 'reservations', {
      propertyId: v.ids[`p${p}`], status: 'provisional', hostName: 'Load', phone: '+919800000000', functionTypeId: v.ids.wedding,
      guaranteedPax: 100, expectedMaxPax: 120, slots: [{ hallId: v.ids[hall], start: `${day}T${h}:00`, end: `${day}T${h}:59` }],
    }];
  },
  statusReport: () => ['report: bookings by status (month, all properties)', 'GET', `reports/bookings-by-status?from=${addDays(today, -30)}&to=${today}`],
  occupancy: () => ['report: hall occupancy (year, all properties)', 'GET', `reports/hall-occupancy?from=${addDays(today, -365)}&to=${today}`],
  forecast: () => ['report: forecast (62 days, all properties)', 'GET', `reports/forecast?from=${today}&to=${addDays(today, 61)}`],
  revenue: () => ['report: revenue (year, all properties)', 'GET', `reports/revenue?from=${addDays(today, -365)}&to=${today}`],
  sheets: () => ['report: function sheets (week)', 'GET', `reports/function-sheets?from=${today}&to=${addDays(today, 6)}`],
};

const MIX = [['diary', 45], ['details', 20], ['billView', 8], ['billList', 4], ['enquiry', 8], ['hold', 5], ['statusReport', 4], ['sheets', 4], ['forecast', 2]];
function mixed(v) {
  let x = Math.random() * 100;
  for (const [name, w] of MIX) { if ((x -= w) < 0) return ops[name](v); }
  return ops.diary(v);
}

async function run(name, users, pickTenant, op, seconds = SECONDS) {
  const samples = new Map();
  const errors = new Map();
  const until = performance.now() + seconds * 1000;
  let count = 0;
  await Promise.all(Array.from({ length: users }, async () => {
    while (performance.now() < until) {
      const v = pickTenant();
      const [label, method, path, body] = op(v);
      const r = await call(v, method, path, body);
      count++;
      if (!samples.has(label)) samples.set(label, []);
      samples.get(label).push(r.ms);
      if (r.status >= 400 || r.status === 0) {
        const key = `${label} ${r.status} ${r.text.slice(0, 100)}`;
        errors.set(key, (errors.get(key) ?? 0) + 1);
      }
    }
  }));
  const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
  const result = { scenario: name, users, seconds, requests: count, rps: Math.round(count / seconds), ops: {}, errors: Object.fromEntries(errors) };
  for (const [label, xs] of samples) {
    xs.sort((a, b) => a - b);
    result.ops[label] = { n: xs.length, p50: Math.round(pct(xs, 50)), p95: Math.round(pct(xs, 95)), p99: Math.round(pct(xs, 99)), max: Math.round(xs[xs.length - 1]) };
  }
  console.error(JSON.stringify(result));
  return result;
}

const scenarios = {
  // One user, one tenant at a time: how long each screen takes on its own.
  single: async () => {
    const out = [];
    for (const [tname, v] of Object.entries(tenants)) {
      for (const name of Object.keys(ops)) out.push({ tenant: tname, ...(await run(`${tname} ${name}`, 1, () => v, ops[name], 5)) });
    }
    return out;
  },
  // Many users across all tenants doing a realistic mix.
  mixed: async () => {
    const out = [];
    for (const users of [10, 25, 50, 100, 200]) out.push(await run(`mixed x${users}`, users, () => pick(everyone), mixed));
    return out;
  },
  // Everyone on the chain at once (the biggest tenant).
  chain: async () => {
    const out = [];
    for (const users of [10, 50, 100]) out.push(await run(`chain diary x${users}`, users, () => seed.chain, ops.diary));
    for (const users of [10, 50]) out.push(await run(`chain create provisional x${users}`, users, () => seed.chain, ops.hold));
    for (const users of [5, 20]) out.push(await run(`chain year reports x${users}`, users, () => seed.chain, () => (Math.random() < 0.5 ? ops.occupancy() : ops.revenue())));
    return out;
  },
};

const results = {};
for (const name of only.length ? only : Object.keys(scenarios)) results[name] = await scenarios[name]();
console.log(JSON.stringify(results, null, 1));
