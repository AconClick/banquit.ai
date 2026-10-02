/**
 * E-invoicing: registering a B2B invoice or credit note with the Invoice Registration Portal (IRP)
 * gets back an IRN, an acknowledgement and a signed QR code to print.
 *
 * The provider is chosen with EINVOICE_PROVIDER: "sandbox" (default) answers like the IRP without
 * calling it, so the whole flow can be used and tested; "nic" is the live IRP, which needs the
 * credentials below and is not switched on until they exist.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { irnFor } from './gst.js';

export interface IrpResult {
  irn: string;
  ackNo: string;
  /** "YYYY-MM-DD HH:mm:ss", as the IRP returns it. */
  ackDate: string;
  signedQr: string;
  /** True when it came from the sandbox: not a valid IRN. */
  sandbox: boolean;
}

export interface EInvoiceProvider {
  readonly name: string;
  generate(payload: { SellerDtls: { Gstin: string }; DocDtls: { Typ: string; No: string } }, financialYear: string): Promise<IrpResult>;
  /** Reason codes: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other. Allowed within 24 hours. */
  cancel(irn: string, reasonCode: '1' | '2' | '3' | '4', remark: string): Promise<{ cancelDate: string }>;
}

export const EINVOICE_PROVIDER = Symbol('EINVOICE_PROVIDER');

const b64url = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Answers like the IRP, offline. IRNs are computed the IRP's way but are not registered anywhere. */
@Injectable()
export class SandboxIrpProvider implements EInvoiceProvider {
  readonly name = 'sandbox';

  async generate(payload: Parameters<EInvoiceProvider['generate']>[0] & Record<string, unknown>, financialYear: string): Promise<IrpResult> {
    const irn = irnFor(payload.SellerDtls.Gstin, financialYear, payload.DocDtls.Typ, payload.DocDtls.No);
    // A 15-digit acknowledgement number, like the IRP's.
    const ackNo = `1${String(parseInt(createHash('sha256').update(irn).digest('hex').slice(0, 12), 16)).padStart(14, '0').slice(-14)}`;
    const ackDate = stamp();
    const p = payload as unknown as {
      BuyerDtls: { Gstin: string }; DocDtls: { Dt: string }; ValDtls: { TotInvVal: number }; ItemList: { HsnCd: string }[];
    };
    const data = {
      SellerGstin: payload.SellerDtls.Gstin, BuyerGstin: p.BuyerDtls.Gstin, DocNo: payload.DocDtls.No, DocTyp: payload.DocDtls.Typ,
      DocDt: p.DocDtls.Dt, TotInvVal: p.ValDtls.TotInvVal, ItemCnt: p.ItemList.length, MainHsnCode: p.ItemList[0]?.HsnCd, Irn: irn, IrnDt: ackDate,
    };
    // Same shape as the IRP's signed QR (a JWT); the signature marks it as a sandbox one.
    const signedQr = `${b64url({ alg: 'none', typ: 'JWT', note: 'SANDBOX - not a registered IRN' })}.${b64url({ data: JSON.stringify(data), iss: 'Banquet.ai sandbox IRP' })}.${b64url('SANDBOX')}`;
    return { irn, ackNo, ackDate, signedQr, sandbox: true };
  }

  async cancel() {
    return { cancelDate: stamp() };
  }
}

/**
 * The live IRP (einvoice1.gst.gov.in) through its API. Needs, from the GST portal's API
 * registration (or a GSP): EINVOICE_CLIENT_ID, EINVOICE_CLIENT_SECRET, EINVOICE_USERNAME,
 * EINVOICE_PASSWORD for each GSTIN, and the IRP's public key in EINVOICE_PUBLIC_KEY.
 */
@Injectable()
export class NicIrpProvider implements EInvoiceProvider {
  readonly name = 'nic';
  static readonly NEEDS = ['EINVOICE_CLIENT_ID', 'EINVOICE_CLIENT_SECRET', 'EINVOICE_USERNAME', 'EINVOICE_PASSWORD', 'EINVOICE_PUBLIC_KEY'];

  private notReady(): never {
    const missing = NicIrpProvider.NEEDS.filter((k) => !process.env[k]);
    throw new Error(
      missing.length
        ? `The live e-invoice portal is not set up: ${missing.join(', ')} missing.`
        : 'The live e-invoice portal connection is not switched on yet. Use the sandbox until it is tested with the IRP sandbox credentials.',
    );
  }

  async generate(): Promise<IrpResult> {
    return this.notReady();
  }

  async cancel(): Promise<{ cancelDate: string }> {
    return this.notReady();
  }
}

export const eInvoiceProviderClass = () => (process.env.EINVOICE_PROVIDER === 'nic' ? NicIrpProvider : SandboxIrpProvider);
