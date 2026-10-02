/**
 * India GST invoice format (Rule 46, CGST Rules 2017) and the e-invoice (IRP) JSON, schema 1.1.
 * Pure functions: a final bill's priced lines and tax rates in, the GST view of it out. Amounts are
 * the bill's own; GST only changes how its taxes are shown (CGST + SGST within the state, IGST across).
 */
import { createHash } from 'node:crypto';
import { round2, type PricedBillLine, type TaxRate } from './bill-engine.js';

/** GST state codes (first two digits of a GSTIN), used for place of supply. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '96': 'Outside India',
};

/** How a tax from the Tax master counts for GST. A combined "GST 18%" is split in two within the state. */
export type GstRole = 'gst' | 'cgst' | 'sgst' | 'igst' | 'cess';
export const GST_ROLES: GstRole[] = ['gst', 'cgst', 'sgst', 'igst', 'cess'];

/** Default SAC codes for banquet billing; the property can change them. */
export interface SacCodes {
  package: string;
  alacarte: string;
  services: string;
  hallHire: string;
  liquorLicence: string;
}

export const DEFAULT_SAC: SacCodes = {
  /** Event-based catering. */
  package: '996334',
  alacarte: '996334',
  /** Event organisation and assistance (decor, DJ). */
  services: '998596',
  /** Renting of non-residential property. */
  hallHire: '997212',
  /** Other services not elsewhere classified. */
  liquorLicence: '999799',
};

export interface GstSetup {
  enabled: boolean;
  gstin: string;
  legalName: string;
  tradeName: string;
  address1: string;
  address2: string;
  location: string;
  pincode: string;
  /** From the GSTIN; also the default place of supply (banquets are supplied where the venue is). */
  stateCode: string;
  sac: SacCodes;
  /** Tax master id → its GST role. Taxes not listed print as other charges. */
  taxRoles: Record<string, GstRole>;
  /** Generate e-invoices (IRN) for business guests with a GSTIN. */
  eInvoice: boolean;
}

export const DEFAULT_GST: GstSetup = {
  enabled: false, gstin: '', legalName: '', tradeName: '', address1: '', address2: '', location: '', pincode: '', stateCode: '',
  sac: { ...DEFAULT_SAC }, taxRoles: {}, eInvoice: false,
};

/** The guest's GST details on a bill. Without a GSTIN the bill is B2C. */
export interface GstBuyer {
  gstin: string;
  legalName: string;
  address: string;
  location: string;
  pincode: string;
  /** Place of supply, a GST state code. */
  placeOfSupply: string;
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A GSTIN in the right shape whose last character is the right check digit. */
export function isGstin(value: unknown): value is string {
  if (typeof value !== 'string' || !GSTIN.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(value[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === value[14] && !!GST_STATES[value.slice(0, 2)];
}

/** HSN/SAC: 4, 6 or 8 digits (6 for businesses over ₹5 crore turnover). */
export const isSac = (v: unknown): v is string => typeof v === 'string' && /^(\d{4}|\d{6}|\d{8})$/.test(v);
export const isPincode = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{5}$/.test(v);

export const sacFor = (sac: SacCodes, line: Pick<PricedBillLine, 'source' | 'aType'>) =>
  line.source === 'hallHire' ? sac.hallHire : line.source === 'liquorLicence' ? sac.liquorLicence : sac[line.aType];

export interface GstLine {
  slNo: number;
  billLineId: string;
  label: string;
  sac: string;
  qty: number;
  /** Value before discount, without tax. */
  gross: number;
  discount: number;
  taxable: number;
  /** Total GST rate in percent (CGST + SGST, or IGST). */
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cessRate: number;
  cess: number;
  /** Fixed-rate cess, e.g. per plate. */
  cessFixed: number;
  /** Taxes that are not GST. */
  other: number;
  total: number;
}

export interface GstInvoice {
  intraState: boolean;
  placeOfSupply: string;
  b2b: boolean;
  lines: GstLine[];
  /** One row per GST rate, as the invoice's tax summary. */
  byRate: { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  other: number;
  roundOff: number;
  total: number;
}

/**
 * The GST view of priced lines. Within the state a combined GST tax is halved into CGST and SGST
 * (SGST takes the odd paisa); across states CGST and SGST are shown together as IGST.
 */
export function gstInvoice(
  lines: PricedBillLine[], rates: Map<string, TaxRate>, setup: Pick<GstSetup, 'stateCode' | 'sac' | 'taxRoles'>,
  buyer: Pick<GstBuyer, 'gstin' | 'placeOfSupply'> | null, roundOff: number,
): GstInvoice {
  const placeOfSupply = buyer?.placeOfSupply || setup.stateCode;
  const intraState = placeOfSupply === setup.stateCode;
  const out: GstLine[] = lines.map((l, i) => {
    let cgst = 0; let sgst = 0; let igst = 0; let cess = 0; let cessFixed = 0; let other = 0; let gstRate = 0; let cessRate = 0;
    for (const t of l.taxes) {
      const role = setup.taxRoles[t.id];
      const rate = rates.get(t.id);
      const pct = rate?.type === 'percentage' ? rate.rate : 0;
      if (role === 'gst') {
        gstRate += pct;
        if (intraState) { const half = round2(t.amount / 2); cgst += half; sgst += round2(t.amount - half); } else igst += t.amount;
      } else if (role === 'cgst' || role === 'sgst') {
        gstRate += pct;
        if (!intraState) igst += t.amount;
        else if (role === 'cgst') cgst += t.amount;
        else sgst += t.amount;
      } else if (role === 'igst') {
        gstRate += pct;
        igst += t.amount;
      } else if (role === 'cess') {
        if (rate?.type === 'fixed') cessFixed += t.amount;
        else { cessRate += pct; cess += t.amount; }
      } else other += t.amount;
    }
    return {
      slNo: i + 1, billLineId: l.id, label: l.label, sac: sacFor(setup.sac, l), qty: l.qty,
      gross: round2(l.taxable + (l.taxInclusive ? 0 : l.discount)), discount: l.taxInclusive ? 0 : l.discount, taxable: l.taxable,
      gstRate: round2(gstRate), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), cessRate, cess: round2(cess),
      cessFixed: round2(cessFixed), other: round2(other), total: l.total,
    };
  });
  const sum = (k: keyof GstLine) => round2(out.reduce((s, l) => s + (l[k] as number), 0));
  const rateMap = new Map<number, GstInvoice['byRate'][number]>();
  for (const l of out) {
    const r = rateMap.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable = round2(r.taxable + l.taxable);
    r.cgst = round2(r.cgst + l.cgst);
    r.sgst = round2(r.sgst + l.sgst);
    r.igst = round2(r.igst + l.igst);
    rateMap.set(l.gstRate, r);
  }
  const taxable = sum('taxable');
  return {
    intraState, placeOfSupply, b2b: !!buyer?.gstin, lines: out, byRate: [...rateMap.values()].sort((a, b) => a.gstRate - b.gstRate),
    taxable, cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: round2(sum('cess') + sum('cessFixed')), other: sum('other'),
    roundOff, total: round2(sum('total') + roundOff),
  };
}

/** Problems with the property's GST setup, before any GST invoice is printed or e-invoiced. */
export function gstSetupProblems(g: GstSetup): string[] {
  if (!g.enabled) return [];
  const p: string[] = [];
  if (!isGstin(g.gstin)) p.push('GST: enter the property’s GSTIN (15 characters, with a valid check digit).');
  if (!g.legalName) p.push('GST: enter the legal name as registered.');
  if (!g.address1 || !g.location) p.push('GST: enter the address and city.');
  if (!isPincode(g.pincode)) p.push('GST: enter a 6-digit PIN code.');
  for (const [k, v] of Object.entries(g.sac)) if (!isSac(v)) p.push(`GST: the SAC code for ${k} must be 4, 6 or 8 digits.`);
  for (const r of Object.values(g.taxRoles)) if (!GST_ROLES.includes(r)) p.push('GST: choose CGST, SGST, IGST, GST or cess for each tax.');
  return p;
}

/** Problems with a guest's GST details on a bill. */
export function buyerProblems(b: GstBuyer): string[] {
  const p: string[] = [];
  if (b.gstin && !isGstin(b.gstin)) p.push('The guest’s GSTIN is not valid. Check the 15 characters.');
  if (b.placeOfSupply && !GST_STATES[b.placeOfSupply]) p.push('Choose the place of supply from the list of states.');
  if (b.pincode && !isPincode(b.pincode)) p.push('The guest’s PIN code must be 6 digits.');
  if (b.gstin && !b.legalName) p.push('Enter the guest’s legal name as on their GST registration.');
  return p;
}

/** dd/mm/yyyy, as the IRP wants dates. */
const irpDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const money = (n: number) => round2(n);

export interface IrpDocument {
  type: 'INV' | 'CRN';
  number: string;
  date: string;
  /** For a credit note: the invoice it reduces. */
  original?: { number: string; date: string };
}

/** The e-invoice JSON (NIC IRP schema 1.1) for a B2B bill or credit note. */
export function irpPayload(doc: IrpDocument, inv: GstInvoice, seller: GstSetup, buyer: GstBuyer) {
  const problems = [...gstSetupProblems({ ...seller, enabled: true })];
  if (!buyer.gstin) problems.push('E-invoices are for business guests: enter the guest’s GSTIN.');
  if (!buyer.address || !buyer.location || !isPincode(buyer.pincode)) problems.push('Enter the guest’s address, city and PIN code for the e-invoice.');
  problems.push(...buyerProblems(buyer));
  if (doc.number.length > 16 || !/^[A-Za-z1-9][A-Za-z0-9/-]*$/.test(doc.number)) problems.push('The document number must be at most 16 letters, digits, / or -, not starting with 0. Change the series prefix in Billing Setup.');
  const payload = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: doc.type, No: doc.number, Dt: irpDate(doc.date) },
    SellerDtls: {
      Gstin: seller.gstin, LglNm: seller.legalName, TrdNm: seller.tradeName || undefined, Addr1: seller.address1, Addr2: seller.address2 || undefined,
      Loc: seller.location, Pin: Number(seller.pincode), Stcd: seller.stateCode,
    },
    BuyerDtls: {
      Gstin: buyer.gstin, LglNm: buyer.legalName, Pos: inv.placeOfSupply, Addr1: buyer.address.slice(0, 100), Loc: buyer.location,
      Pin: Number(buyer.pincode), Stcd: buyer.gstin.slice(0, 2),
    },
    ItemList: inv.lines.map((l) => ({
      SlNo: String(l.slNo), PrdDesc: l.label.slice(0, 300), IsServc: 'Y', HsnCd: l.sac, Qty: l.qty, Unit: 'OTH',
      UnitPrice: l.qty > 0 ? Math.round((l.gross / l.qty) * 1000) / 1000 : 0, TotAmt: money(l.gross), Discount: money(l.discount),
      AssAmt: money(l.taxable), GstRt: l.gstRate, IgstAmt: l.igst, CgstAmt: l.cgst, SgstAmt: l.sgst, CesRt: l.cessRate, CesAmt: l.cess,
      CesNonAdvlAmt: l.cessFixed, OthChrg: l.other, TotItemVal: money(l.total),
    })),
    ValDtls: {
      AssVal: inv.taxable, CgstVal: inv.cgst, SgstVal: inv.sgst, IgstVal: inv.igst, CesVal: inv.cess, OthChrg: inv.other,
      RndOffAmt: inv.roundOff, TotInvVal: inv.total,
    },
    ...(doc.original ? { RefDtls: { PrecDocDtls: [{ InvNo: doc.original.number, InvDt: irpDate(doc.original.date) }] } } : {}),
  };
  return { payload, problems };
}

/** The IRN the IRP gives: SHA-256 of seller GSTIN, financial year, document type and number. */
export function irnFor(gstin: string, fy: string, type: string, number: string) {
  return createHash('sha256').update(`${gstin}${fy}${type}${number}`).digest('hex');
}
