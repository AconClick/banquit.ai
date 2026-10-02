import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import QRCode from 'qrcode';
import type { PricedBillLine } from './bill-engine.js';
import { Bill, type BillDocument, type EInvoiceRecord } from './bill.schema.js';
import { BillingSetupService } from './billing-setup.service.js';
import { BillingService, EMPTY_BUYER } from './billing.service.js';
import { CreditNote } from './credit-note.schema.js';
import { EINVOICE_PROVIDER, type EInvoiceProvider } from './einvoice.provider.js';
import { buyerProblems, gstInvoice, irpPayload, type GstBuyer } from './gst.js';
import { financialYear } from './series.js';

const CHANGED_ELSEWHERE = 'This bill was changed by someone else. Reload it and try again.';
const CANCEL_REASONS = ['1', '2', '3', '4'] as const;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The guest's GST details on a bill, and e-invoices (IRN) for bills and credit notes. */
@Injectable()
export class GstService {
  constructor(
    @InjectModel(Bill.name) private readonly bills: Model<Bill>,
    @InjectModel(CreditNote.name) private readonly notes: Model<CreditNote>,
    private readonly billing: BillingService,
    private readonly setup: BillingSetupService,
    @Inject(EINVOICE_PROVIDER) private readonly irp: EInvoiceProvider,
  ) {}

  /** Saves the guest's GSTIN, name, address and place of supply. Locked once an e-invoice is registered. */
  async setBuyer(tenantId: Types.ObjectId, userId: string, billId: string, input: Partial<GstBuyer>) {
    const bill = await this.billing.get(tenantId, billId);
    if (bill.status === 'void') throw new BadRequestException('This bill is void.');
    if (bill.eInvoice?.status === 'generated') throw new BadRequestException('The e-invoice is registered with these details. Cancel it first to change them.');
    const seller = bill.gst ?? (await this.setup.gst(tenantId, bill.propertyId));
    const buyer: GstBuyer = {
      gstin: text(input.gstin, 15).toUpperCase(), legalName: text(input.legalName, 100), address: text(input.address, 200),
      location: text(input.location, 50), pincode: text(input.pincode, 6), placeOfSupply: text(input.placeOfSupply, 2) || seller.stateCode,
    };
    // A registered guest's place of supply defaults to the venue's state, which is the rule for banquets at a hotel.
    const problems = buyerProblems(buyer);
    if (problems.length) throw new BadRequestException(problems);
    const done = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, __v: bill.__v },
      { $set: { buyer }, $push: { history: { action: 'Guest GST details saved', at: new Date(), byUserId: userId } }, $inc: { __v: 1 } },
      { returnDocument: 'after' },
    );
    if (!done) throw new ConflictException(CHANGED_ELSEWHERE);
    return this.billing.getView(tenantId, billId);
  }

  /** Registers a final B2B bill with the IRP and keeps its IRN, acknowledgement and signed QR. */
  async generateForBill(tenantId: Types.ObjectId, userId: string, billId: string) {
    const bill = await this.billing.get(tenantId, billId);
    const { seller, buyer } = this.ready(bill);
    if (bill.eInvoice?.status === 'generated') throw new BadRequestException('This bill already has an e-invoice.');
    const inv = gstInvoice(bill.totals!.lines, new Map(Object.entries(bill.taxRates ?? {})), seller, buyer, bill.totals!.roundOff);
    const { payload, problems } = irpPayload({ type: 'INV', number: bill.number!, date: bill.date! }, inv, { ...seller, enabled: true }, buyer);
    if (problems.length) throw new BadRequestException([...new Set(problems)]);
    const record = await this.register(payload, bill.date!, userId, bill.propertyId, tenantId);
    const done = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, __v: bill.__v },
      { $set: { eInvoice: record }, $push: { history: { action: `E-invoice IRN ${record.irn.slice(0, 12)}…`, at: new Date(), byUserId: userId } }, $inc: { __v: 1 } },
      { returnDocument: 'after' },
    );
    if (!done) throw new ConflictException(CHANGED_ELSEWHERE);
    return this.billing.getView(tenantId, billId);
  }

  async cancelForBill(tenantId: Types.ObjectId, userId: string, billId: string, reasonCode: string, remark: string) {
    const bill = await this.billing.get(tenantId, billId);
    const e = bill.eInvoice;
    if (e?.status !== 'generated') throw new BadRequestException('This bill has no e-invoice to cancel.');
    const cancelled = await this.cancel(e, reasonCode, remark);
    const done = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, __v: bill.__v },
      { $set: { eInvoice: cancelled }, $push: { history: { action: 'E-invoice cancelled', at: new Date(), byUserId: userId, note: cancelled.cancelReason } }, $inc: { __v: 1 } },
      { returnDocument: 'after' },
    );
    if (!done) throw new ConflictException(CHANGED_ELSEWHERE);
    return this.billing.getView(tenantId, billId);
  }

  /** Registers a credit note against an e-invoiced bill (document type CRN). */
  async generateForCreditNote(tenantId: Types.ObjectId, userId: string, id: string) {
    const note = Types.ObjectId.isValid(id) ? await this.notes.findOne({ tenantId, _id: id }) : null;
    if (!note) throw new NotFoundException('Credit note not found.');
    if (note.status !== 'issued') throw new BadRequestException('This credit note is cancelled.');
    if (note.eInvoice?.status === 'generated') throw new BadRequestException('This credit note already has an e-invoice.');
    const bill = await this.billing.get(tenantId, note.billId);
    const { seller, buyer } = this.ready(bill);
    const inv = gstInvoice(this.creditLines(bill, note), new Map(Object.entries(bill.taxRates ?? {})), seller, buyer, note.totals.roundOff ?? 0);
    const { payload, problems } = irpPayload(
      { type: 'CRN', number: note.number, date: note.date, original: { number: bill.number!, date: note.billDate } }, inv, { ...seller, enabled: true }, buyer,
    );
    if (problems.length) throw new BadRequestException([...new Set(problems)]);
    note.eInvoice = await this.register(payload, note.date, userId, bill.propertyId, tenantId);
    note.markModified('eInvoice');
    await note.save();
    return this.creditNoteGst(tenantId, note.id as string);
  }

  /** The GST view of a credit note, for printing. */
  async creditNoteGst(tenantId: Types.ObjectId, id: string) {
    const note = Types.ObjectId.isValid(id) ? await this.notes.findOne({ tenantId, _id: id }) : null;
    if (!note) throw new NotFoundException('Credit note not found.');
    const bill = await this.billing.get(tenantId, note.billId);
    if (!bill.gst) return { gst: null };
    const buyer = bill.buyer ?? { ...EMPTY_BUYER, placeOfSupply: bill.gst.stateCode };
    const e = note.eInvoice;
    return {
      gst: {
        seller: bill.gst, buyer, eInvoiceOn: bill.gst.eInvoice,
        invoice: gstInvoice(this.creditLines(bill, note), new Map(Object.entries(bill.taxRates ?? {})), bill.gst, buyer, note.totals.roundOff ?? 0),
        eInvoice: e ? { ...e, qr: e.status === 'generated' ? await QRCode.toDataURL(e.signedQr, { errorCorrectionLevel: 'M', margin: 1, width: 220 }) : null } : null,
      },
    };
  }

  private ready(bill: BillDocument) {
    if (!bill.number || !bill.totals || bill.status === 'void' || bill.status === 'draft') throw new BadRequestException('E-invoices are for final bills.');
    if (!bill.gst) throw new BadRequestException('This bill was finalised without the GST invoice format, so it cannot be e-invoiced.');
    if (!bill.gst.eInvoice) throw new BadRequestException('E-invoicing is off for this property (Master › Billing Setup).');
    const buyer = bill.buyer ?? { ...EMPTY_BUYER, placeOfSupply: bill.gst.stateCode };
    return { seller: bill.gst, buyer };
  }

  /** A credit note's lines as priced lines, with the bill line's type for its SAC code. */
  private creditLines(bill: BillDocument, note: { totals: { lines: { billLineId: string; label: string; taxable: number; taxes: { id: string; name: string; amount: number }[]; total: number }[] } }): PricedBillLine[] {
    const byId = new Map((bill.totals!.lines as PricedBillLine[]).map((l) => [l.id, l]));
    return note.totals.lines.map((c) => {
      const l = byId.get(c.billLineId)!;
      return { ...l, qty: 1, rate: c.taxable, taxInclusive: false, amount: c.taxable, discount: 0, taxable: c.taxable, taxes: c.taxes, total: c.total };
    });
  }

  private async register(payload: Parameters<EInvoiceProvider['generate']>[0], date: string, userId: string, propertyId: string, tenantId: Types.ObjectId): Promise<EInvoiceRecord> {
    const { fyStartMonth } = await this.setup.values(tenantId, propertyId);
    try {
      const r = await this.irp.generate(payload, financialYear(date, fyStartMonth));
      return { status: 'generated', irn: r.irn, ackNo: r.ackNo, ackDate: r.ackDate, signedQr: r.signedQr, provider: this.irp.name, sandbox: r.sandbox, byUserId: userId };
    } catch (err) {
      throw new BadRequestException(`The e-invoice portal refused it: ${(err as Error).message}`);
    }
  }

  private async cancel(e: EInvoiceRecord, reasonCode: string, remark: string): Promise<EInvoiceRecord> {
    if (!(CANCEL_REASONS as readonly string[]).includes(reasonCode)) throw new BadRequestException('Choose why the e-invoice is cancelled.');
    const why = text(remark, 100);
    if (!why) throw new BadRequestException('Give a remark for cancelling the e-invoice.');
    // The IRP allows cancelling only within 24 hours of the acknowledgement.
    if (Date.now() - Date.parse(`${e.ackDate.replace(' ', 'T')}Z`) > 24 * 3_600_000) {
      throw new BadRequestException('An e-invoice can be cancelled only within 24 hours. Issue a credit note instead.');
    }
    try {
      const r = await this.irp.cancel(e.irn, reasonCode as (typeof CANCEL_REASONS)[number], why);
      return { ...e, status: 'cancelled', cancelDate: r.cancelDate, cancelReason: why };
    } catch (err) {
      throw new BadRequestException(`The e-invoice portal refused it: ${(err as Error).message}`);
    }
  }
}
