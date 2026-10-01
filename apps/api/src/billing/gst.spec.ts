import type { PricedBillLine, TaxRate } from './bill-engine.js';
import { DEFAULT_GST, buyerProblems, gstInvoice, gstSetupProblems, irnFor, irpPayload, isGstin, type GstBuyer, type GstSetup } from './gst.js';

const seller: GstSetup = {
  ...DEFAULT_GST, enabled: true, gstin: '27AAPFU0939F1ZV', legalName: 'Sea View Hotels Pvt Ltd', address1: '1 Marine Drive', location: 'Mumbai',
  pincode: '400020', stateCode: '27', taxRoles: { gst18: 'gst', cess: 'cess' },
};
const rates = new Map<string, TaxRate>([
  ['gst18', { id: 'gst18', name: 'GST 18%', type: 'percentage', rate: 18 }],
  ['cess', { id: 'cess', name: 'Cess', type: 'fixed', rate: 5 }],
  ['city', { id: 'city', name: 'City tax', type: 'percentage', rate: 1 }],
]);
const line = (over: Partial<PricedBillLine>): PricedBillLine => ({
  id: 'l1', source: 'package', aType: 'package', label: 'Gold package', guaranteedPax: 100, actualPax: null, qty: 100, rate: 1000,
  taxInclusive: false, amount: 100000, discount: 0, taxable: 100000, taxes: [{ id: 'gst18', name: 'GST 18%', amount: 18000 }], total: 118000, ...over,
});
const buyer = (over: Partial<GstBuyer> = {}): GstBuyer => ({
  gstin: '29AABCT1332L1ZA', legalName: 'Tech Corp Ltd', address: '5 MG Road', location: 'Bengaluru', pincode: '560001', placeOfSupply: '27', ...over,
});

describe('GSTIN', () => {
  it('checks the shape, the state code and the check digit', () => {
    expect(isGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isGstin('27AAPFU0939F1ZW')).toBe(false);
    expect(isGstin('27aapfu0939f1zv')).toBe(false);
    expect(isGstin('99AAPFU0939F1ZV')).toBe(false);
    expect(isGstin('')).toBe(false);
  });
});

describe('gstInvoice', () => {
  it('halves a combined GST into CGST and SGST within the state', () => {
    const inv = gstInvoice([line({ taxes: [{ id: 'gst18', name: 'GST 18%', amount: 18000.01 }], total: 118000.01 })], rates, seller, null, -0.01);
    expect(inv).toMatchObject({ intraState: true, placeOfSupply: '27', b2b: false, cgst: 9000, sgst: 9000.01, igst: 0, total: 118000 });
    expect(inv.lines[0]).toMatchObject({ sac: '996334', gstRate: 18, cgst: 9000, sgst: 9000.01 });
    expect(inv.byRate).toEqual([{ gstRate: 18, taxable: 100000, cgst: 9000, sgst: 9000.01, igst: 0 }]);
  });

  it('shows IGST when the place of supply is another state', () => {
    const inv = gstInvoice([line({})], rates, seller, buyer({ placeOfSupply: '29' }), 0);
    expect(inv).toMatchObject({ intraState: false, b2b: true, cgst: 0, sgst: 0, igst: 18000, total: 118000 });
  });

  it('keeps cess and non-GST taxes apart, and uses the hall hire SAC', () => {
    const inv = gstInvoice(
      [line({ source: 'hallHire', aType: 'services', taxes: [{ id: 'gst18', name: 'GST', amount: 18000 }, { id: 'cess', name: 'Cess', amount: 500 }, { id: 'city', name: 'City', amount: 1000 }], total: 119500 })],
      rates, seller, null, 0,
    );
    expect(inv.lines[0]).toMatchObject({ sac: '997212', cessFixed: 500, other: 1000, cgst: 9000, sgst: 9000 });
    expect(inv).toMatchObject({ cess: 500, other: 1000, total: 119500 });
  });

  it('shows the discount before the taxable value', () => {
    const inv = gstInvoice([line({ discount: 10000, taxable: 90000, taxes: [{ id: 'gst18', name: 'GST', amount: 16200 }], total: 106200 })], rates, seller, null, 0);
    expect(inv.lines[0]).toMatchObject({ gross: 100000, discount: 10000, taxable: 90000 });
  });
});

describe('setup and buyer checks', () => {
  it('needs a full GST registration only when GST is on', () => {
    expect(gstSetupProblems(DEFAULT_GST)).toEqual([]);
    expect(gstSetupProblems({ ...DEFAULT_GST, enabled: true }).join(' ')).toMatch(/GSTIN.*legal name.*address.*PIN/);
    expect(gstSetupProblems(seller)).toEqual([]);
    expect(gstSetupProblems({ ...seller, sac: { ...seller.sac, hallHire: '12' } })[0]).toMatch(/hallHire/);
  });

  it('accepts a guest without a GSTIN, and checks one that has it', () => {
    expect(buyerProblems(buyer({ gstin: '', legalName: '' }))).toEqual([]);
    expect(buyerProblems(buyer({ gstin: '29AABCT1332L1ZB' }))[0]).toMatch(/GSTIN is not valid/);
    expect(buyerProblems(buyer({ legalName: '' }))[0]).toMatch(/legal name/);
  });
});

describe('irpPayload', () => {
  it('builds the IRP 1.1 JSON for a bill', () => {
    const inv = gstInvoice([line({})], rates, seller, buyer(), 0);
    const { payload, problems } = irpPayload({ type: 'INV', number: 'B/2026-27/000001', date: '2026-10-01' }, inv, seller, buyer());
    expect(problems).toEqual([]);
    expect(payload).toMatchObject({
      Version: '1.1', TranDtls: { SupTyp: 'B2B' }, DocDtls: { Typ: 'INV', No: 'B/2026-27/000001', Dt: '01/10/2026' },
      SellerDtls: { Gstin: '27AAPFU0939F1ZV', Pin: 400020, Stcd: '27' }, BuyerDtls: { Gstin: '29AABCT1332L1ZA', Pos: '27', Stcd: '29' },
      ItemList: [{ SlNo: '1', HsnCd: '996334', IsServc: 'Y', Qty: 100, UnitPrice: 1000, AssAmt: 100000, GstRt: 18, CgstAmt: 9000, SgstAmt: 9000, TotItemVal: 118000 }],
      ValDtls: { AssVal: 100000, CgstVal: 9000, SgstVal: 9000, TotInvVal: 118000 },
    });
    expect(payload).not.toHaveProperty('RefDtls');
  });

  it('quotes the original invoice on a credit note, and refuses B2C or long numbers', () => {
    const inv = gstInvoice([line({})], rates, seller, buyer(), 0);
    const crn = irpPayload({ type: 'CRN', number: 'CN/26-27/000001', date: '2026-10-02', original: { number: 'B/2026-27/000001', date: '2026-10-01' } }, inv, seller, buyer());
    expect(crn.payload.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: 'B/2026-27/000001', InvDt: '01/10/2026' }] });
    const b2c = irpPayload({ type: 'INV', number: 'CN/2026-27/000001', date: '2026-10-01' }, inv, seller, buyer({ gstin: '' }));
    expect(b2c.problems.join(' ')).toMatch(/business guests.*16 letters/);
  });

  it('computes the IRN from GSTIN, year, type and number', () => {
    expect(irnFor('27AAPFU0939F1ZV', '2026-27', 'INV', 'B/1')).toMatch(/^[0-9a-f]{64}$/);
    expect(irnFor('27AAPFU0939F1ZV', '2026-27', 'INV', 'B/1')).not.toBe(irnFor('27AAPFU0939F1ZV', '2026-27', 'CRN', 'B/1'));
  });
});
