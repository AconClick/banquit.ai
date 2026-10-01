import type { startApp } from '../helpers.js';

type App = Awaited<ReturnType<typeof startApp>>;
const auth = { type: 'bearer' as const };

export interface Venue {
  sub: string;
  host: string;
  /** entp in the Master panel. */
  master: string;
  /** A second user with every Operations permission. */
  ops: string;
  ids: Record<string, string>;
  /** Plain request helpers: they return the response, whatever its status. */
  get: (path: string, token?: string) => Promise<{ status: number; body: any }>;
  post: (path: string, body?: object, token?: string) => Promise<{ status: number; body: any }>;
  put: (path: string, body?: object, token?: string) => Promise<{ status: number; body: any }>;
}

/**
 * A tenant with one company, `properties` properties with `hallsPer` halls each, taxes, a
 * tax-inclusive package, extras and reasons, plus an operations user next to entp.
 */
export async function venue(t: App, sub: string, opts: { properties?: number; hallsPer?: number; currency?: string; bufferMinutes?: number } = {}): Promise<Venue> {
  const { host, token: master } = await t.tenantWithEntp(sub);
  const send = (method: 'get' | 'post' | 'put') => async (path: string, body?: object, token = ops) => {
    const req = t.http()[method](`/api/${path}`).set('Host', host).auth(token, auth);
    const res = await (body ? req.send(body) : req);
    return { status: res.status, body: res.body };
  };
  let ops = master;
  const mpost = async (path: string, body: object) => {
    const res = await send('post')(path, body, master);
    if (res.status !== 201) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id as string;
  };
  const ids: Record<string, string> = {};
  const company = await mpost('masters/company', { name: `${sub} Group`, city: 'Kochi', state: 'Kerala', country: 'India' });
  const props: string[] = [];
  for (let p = 1; p <= (opts.properties ?? 1); p++) {
    const id = await mpost('masters/property', { name: `${sub} P${p}`, companyId: company, city: 'Kochi', state: 'Kerala', country: 'India', currency: opts.currency ?? 'INR' });
    props.push(id);
    ids[`p${p}`] = id;
    for (let h = 1; h <= (opts.hallsPer ?? 1); h++) {
      ids[`p${p}h${h}`] = await mpost('masters/hall', {
        description: `Hall ${p}-${h}`, propertyId: id, capacity: 500, areaSqFt: 4000, bufferMinutes: opts.bufferMinutes ?? 0,
      });
    }
  }
  ids.wedding = await mpost('masters/functionType', { description: 'Wedding' });
  ids.cancel = await mpost('masters/cancellationReason', { description: 'Guest changed plans' });
  ids.amend = await mpost('masters/amendmentReason', { description: 'Guest asked' });
  ids.blockReason = await mpost('masters/hallBlockReason', { description: 'Maintenance' });
  ids.cgst = await mpost('masters/tax', { description: 'CGST 2.5%', taxType: 'percentage', rate: 2.5, validFrom: '2020-01-01', propertyIds: props });
  ids.sgst = await mpost('masters/tax', { description: 'SGST 2.5%', taxType: 'percentage', rate: 2.5, validFrom: '2020-01-01', propertyIds: props });
  ids.gst18 = await mpost('masters/tax', { description: 'GST 18%', taxType: 'percentage', rate: 18, validFrom: '2020-01-01', propertyIds: props });
  const head = await mpost('masters/incomeExpenseHead', { code: 'FB', description: 'Food' });
  const unit = await mpost('masters/unit', { description: 'Plate', shortDescription: 'PLT' });
  const main = await mpost('masters/mainGroup', { code: 'FOOD', description: 'Food' });
  const starters = await mpost('masters/subGroup', { code: 'ST', description: 'Starters', mainGroupId: main });
  const item = (code: string, description: string, over: object) => mpost('masters/menuItem', {
    code, description, subGroupId: starters, unitId: unit, defaultRate: 0, aType: 'package', incomeExpenseHeadId: head, ...over,
  });
  ids.tikka = await item('S1', 'Chicken Tikka', {});
  ids.dj = await item('DJ', 'DJ Console', { aType: 'services', defaultRate: 7500 });
  ids.mocktail = await item('MK', 'Mocktail', { aType: 'alacarte', defaultRate: 150 });
  ids.pkg = await mpost('masters/package', {
    code: 'BLNV', description: 'Buffet Lunch', ratePerPax: 950, taxInclusive: true, propertyIds: props,
    incomeExpenseHeadId: head, groups: [{ subGroupId: starters, min: 1, max: 1, itemIds: [ids.tikka] }],
  });
  ids.pkgEx = await mpost('masters/package', {
    code: 'DNV', description: 'Dinner', ratePerPax: 1199.99, taxInclusive: false, propertyIds: props,
    incomeExpenseHeadId: head, groups: [{ subGroupId: starters, min: 1, max: 1, itemIds: [ids.tikka] }],
  });
  for (const p of props) {
    const res = await send('put')(`properties/${p}/settings`, {
      defaultTaxIds: { package: [ids.cgst, ids.sgst], alacarte: [ids.gst18], services: [ids.cgst, ids.sgst] }, advancePercent: 0,
    }, master);
    if (res.status !== 200) throw new Error(`settings: ${JSON.stringify(res.body)}`);
  }

  // An operations user, so the tests keep a Master and an Operations session side by side.
  const role = await send('post')('roles', { name: 'Banquet Manager', permissions: ['diary.view', 'reservations.manage', 'reservations.confirmWithoutAdvance', 'billing.manage', 'billing.approve', 'reports.view'] }, master);
  const email = `ops@${sub}.test`;
  await send('post')('users', { userId: 'ops1', firstName: 'Ops', email, roleId: role.body.id }, master);
  const pw = t.passwordIn(t.lastMessage(email).body);
  const first = await t.http().post('/api/auth/login').set('Host', host).send({ userId: 'ops1', password: pw });
  const changed = await t.http().post('/api/auth/change-password').set('Host', host).auth(first.body.token, auth).send({ currentPassword: pw, newPassword: 'Ops2026xxx' });
  ops = (await t.http().post('/api/auth/activity').set('Host', host).auth(changed.body.token, auth).send({ activity: 'operations' })).body.token;
  return { sub, host, master, ops, ids, get: (p, tok) => send('get')(p, undefined, tok), post: send('post'), put: send('put') };
}

export const today = () => new Date().toISOString().slice(0, 10);

/** A booking at `date` from..to in the hall, created as `status`. */
export function booking(v: Venue, hall: string, date: string, from: string, to: string, status = 'enquiry', pax = 100, property = 'p1') {
  return v.post('reservations', {
    propertyId: v.ids[property], status, hostName: `Host ${Math.random().toString(36).slice(2, 7)}`, phone: '+919800000111',
    functionTypeId: v.ids.wedding, guaranteedPax: pax, expectedMaxPax: pax + 20,
    slots: [{ hallId: v.ids[hall], start: `${date}T${from}`, end: `${date}T${to}` }],
  });
}

/** A completed booking (function held today) with a package and an advance, ready to bill. */
export async function completedBooking(v: Venue, opts: { hall?: string; from: string; to: string; pax: number; actual: number; advance?: number; pkg?: string; extras?: object[] }) {
  const r = await booking(v, opts.hall ?? 'p1h1', today(), opts.from, opts.to, 'enquiry', opts.pax);
  if (r.status !== 201) throw new Error(`booking: ${JSON.stringify(r.body)}`);
  const id = r.body.id as string;
  const steps: [string, object][] = [
    [`reservations/${id}/menu`, { packages: [{ packageId: v.ids[opts.pkg ?? 'pkg'], pax: opts.pax, choices: [v.ids.tikka] }], extras: opts.extras ?? [] }],
  ];
  const menu = await v.put(steps[0][0], steps[0][1]);
  if (menu.status !== 200) throw new Error(`menu: ${JSON.stringify(menu.body)}`);
  if (opts.advance) {
    const rc = await v.post(`reservations/${id}/receipts`, { amount: opts.advance, mode: 'upi' });
    if (rc.status !== 201) throw new Error(`receipt: ${JSON.stringify(rc.body)}`);
  }
  for (const body of [{ status: 'confirmed' }, { status: 'inFunction' }, { status: 'completed', actualPax: opts.actual }]) {
    const s = await v.post(`reservations/${id}/status`, body);
    if (s.status !== 200) throw new Error(`status ${body.status}: ${JSON.stringify(s.body)}`);
  }
  return id;
}
