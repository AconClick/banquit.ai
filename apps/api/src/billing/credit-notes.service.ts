import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MastersService } from '../masters/masters.service.js';
import { rounder } from '../pricing/money.js';
import { todayIn } from '../reservations/local-time.js';
import type { PricedBillLine } from './bill-engine.js';
import { Bill, type BillDocument } from './bill.schema.js';
import { BillingSetupService } from './billing-setup.service.js';
import { BillingService } from './billing.service.js';
import { CreditNote, type CreditNoteDocument } from './credit-note.schema.js';
import { creditTotals, remainingOnLine, type CreditedLine } from './credit-math.js';

export interface CreditNoteInput {
  reason: string;
  /** Credit the whole of what is still open on the bill. */
  full?: boolean;
  /** Or these amounts (tax included) on these bill lines. */
  lines?: { lineId: string; amount: number }[];
}

const CHANGED_ELSEWHERE = 'This bill was changed by someone else. Reload it and try again.';
const CREDITABLE = ['finalised', 'partiallySettled', 'settled'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Credit notes against final bills: a lower price agreed afterwards, a service not given, a billing mistake. */
@Injectable()
export class CreditNotesService {
  constructor(
    @InjectModel(Bill.name) private readonly bills: Model<Bill>,
    @InjectModel(CreditNote.name) private readonly notes: Model<CreditNote>,
    private readonly billing: BillingService,
    private readonly setup: BillingSetupService,
    private readonly masters: MastersService,
  ) {}

  /** Per bill line: what was charged, credited so far, and still open to credit. */
  async openLines(tenantId: Types.ObjectId, bill: BillDocument) {
    const issued = await this.issuedLines(tenantId, bill.id as string);
    const dp = bill.decimals ?? 2;
    return (bill.totals?.lines ?? []).map((l: PricedBillLine) => {
      const left = remainingOnLine(l, issued, dp);
      return { lineId: l.id, label: l.label, total: l.total, credited: rounder(dp)(l.total - left.total), open: left.total };
    });
  }

  async forBill(tenantId: Types.ObjectId, billId: string) {
    const bill = await this.billing.get(tenantId, billId);
    const notes = await this.notes.find({ tenantId, billId: bill.id }).sort({ createdAt: 1 });
    return { lines: await this.openLines(tenantId, bill), creditNotes: notes.map((n) => this.view(n)) };
  }

  async list(tenantId: Types.ObjectId, filter: { propertyId?: string; from?: string; to?: string }) {
    const q: Record<string, unknown> = { tenantId };
    if (filter.propertyId) q.propertyId = filter.propertyId;
    if (filter.from || filter.to) q.date = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}) };
    const notes = await this.notes.find(q).sort({ date: -1, createdAt: -1 }).limit(500);
    return notes.map((n) => this.view(n));
  }

  async get(tenantId: Types.ObjectId, id: string) {
    const note = Types.ObjectId.isValid(id) ? await this.notes.findOne({ tenantId, _id: id }) : null;
    if (!note) throw new NotFoundException('Credit note not found.');
    return { ...this.view(note), print: await this.setup.print(tenantId, note.propertyId) };
  }

  async issue(tenantId: Types.ObjectId, userId: string, billId: string, input: CreditNoteInput) {
    const bill = await this.billing.get(tenantId, billId);
    if (!CREDITABLE.includes(bill.status) || !bill.number || !bill.totals) throw new BadRequestException('Credit notes are issued against a final bill.');
    const dp = bill.decimals ?? 2;
    const round = rounder(dp);
    const problems: string[] = [];
    const reason = text(input?.reason, 300);
    if (!reason) problems.push('Give the reason for the credit note.');
    const issuedNotes = await this.notes.find({ tenantId, billId: bill.id, status: 'issued' });
    const issued = issuedNotes.flatMap((n) => n.totals.lines);
    const issuedRoundOff = round(issuedNotes.reduce((s, n) => s + (n.totals.roundOff ?? 0), 0));
    const lines: PricedBillLine[] = bill.totals.lines;

    let requested: { lineId: string; amount: number }[];
    if (input?.full) {
      requested = lines.map((l) => ({ lineId: l.id, amount: remainingOnLine(l, issued, dp).total }));
    } else {
      requested = [];
      for (const r of Array.isArray(input?.lines) ? input.lines : []) {
        if (!r || r.amount === 0 || r.amount === null || r.amount === undefined) continue;
        const line = lines.find((l) => l.id === r.lineId);
        if (!line) { problems.push('Choose lines on this bill.'); continue; }
        const open = remainingOnLine(line, issued, dp).total;
        if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || round(r.amount) <= 0) problems.push(`${line.label}: the amount must be more than 0.`);
        else if (round(r.amount) > open) problems.push(`${line.label}: only ${open.toFixed(dp)} is left to credit.`);
        else requested.push({ lineId: line.id, amount: round(r.amount) });
      }
    }
    const totals = creditTotals(bill.totals, issued, issuedRoundOff, requested.filter((r) => r.amount > 0), dp);
    if (!problems.length && totals.total <= 0) problems.push(input?.full ? 'Everything on this bill has been credited already.' : 'Enter an amount to credit on at least one line.');
    if (problems.length) throw new BadRequestException([...new Set(problems)]);

    // Lock the bill (only if unchanged since read) before taking a number, so two credit notes
    // cannot over-credit it and a refused one leaves no gap in the series.
    const id = new Types.ObjectId();
    const date = await this.masters.propertyToday(tenantId, bill.propertyId);
    const credit = { id: id.toHexString(), date, total: totals.total, status: 'issued' as const };
    const after = this.billing.balance({ ...this.plain(bill), credits: [...bill.credits, credit] }, bill.totals.total);
    const locked = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, status: bill.status, __v: bill.__v },
      { $push: { credits: credit }, $set: { status: this.billing.statusFor(after, true) }, $inc: { __v: 1 } },
      { returnDocument: 'after' },
    );
    if (!locked) throw new ConflictException(CHANGED_ELSEWHERE);
    const { number } = await this.setup.take(tenantId, bill.propertyId, 'creditNote');
    const note = await this.notes.create({
      _id: id, tenantId, propertyId: bill.propertyId, billId: bill.id, billNumber: bill.number, billDate: await this.billDate(tenantId, bill),
      reservationId: bill.reservationId, reservationNumber: bill.reservationNumber, hostName: bill.hostName,
      number, date, reason, status: 'issued', currency: bill.currency ?? 'INR', decimals: dp, totals, byUserId: userId,
    });
    await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, 'credits.id': credit.id },
      { $set: { 'credits.$.number': number }, $push: { history: { action: `Credit note ${number}`, at: new Date(), byUserId: userId, note: reason } }, $inc: { __v: 1 } },
    );
    return { creditNote: this.view(note), bill: await this.billing.getView(tenantId, bill.id as string) };
  }

  /** Cancels a credit note issued in error; the bill's balance goes back up. */
  async cancel(tenantId: Types.ObjectId, userId: string, id: string, reason: string) {
    const why = text(reason, 300);
    if (!why) throw new BadRequestException('Give the reason for cancelling the credit note.');
    const note = Types.ObjectId.isValid(id) ? await this.notes.findOne({ tenantId, _id: id }) : null;
    if (!note) throw new NotFoundException('Credit note not found.');
    if (note.status !== 'issued') throw new BadRequestException('This credit note is already cancelled.');
    const bill = await this.billing.get(tenantId, note.billId);
    const credits = bill.credits.map((c) => (c.id === note.id ? { ...c, status: 'cancelled' as const } : c));
    const after = this.billing.balance({ ...this.plain(bill), credits }, bill.totals!.total);
    const locked = await this.bills.findOneAndUpdate(
      { _id: bill._id, tenantId, __v: bill.__v, credits: { $elemMatch: { id: note.id, status: 'issued' } } },
      {
        $set: { 'credits.$.status': 'cancelled', status: this.billing.statusFor(after, bill.advances.length + bill.payments.length > 0 || credits.some((c) => c.status === 'issued')) },
        $push: { history: { action: `Credit note ${note.number} cancelled`, at: new Date(), byUserId: userId, note: why } },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!locked) throw new ConflictException(CHANGED_ELSEWHERE);
    note.status = 'cancelled';
    note.cancelledAt = new Date();
    note.cancelReason = why;
    await note.save();
    return { creditNote: this.view(note), bill: await this.billing.getView(tenantId, bill.id as string) };
  }

  private async issuedLines(tenantId: Types.ObjectId, billId: string): Promise<CreditedLine[]> {
    const notes = await this.notes.find({ tenantId, billId, status: 'issued' }).lean();
    return notes.flatMap((n) => n.totals.lines);
  }

  /** The final bill's date at the property; bills finalised before it was stored use their finalising time. */
  private async billDate(tenantId: Types.ObjectId, bill: BillDocument) {
    if (bill.date) return bill.date;
    const property = await this.masters.get(tenantId, 'property', bill.propertyId).catch(() => null);
    return todayIn(property?.values.timeZone as string | undefined, bill.finalisedAt ?? new Date());
  }

  private plain(bill: BillDocument) {
    return { advances: bill.advances, payments: bill.payments, credits: bill.credits, decimals: bill.decimals };
  }

  view(n: CreditNoteDocument) {
    return {
      id: n.id as string, number: n.number, date: n.date, status: n.status, reason: n.reason, billId: n.billId, billNumber: n.billNumber,
      billDate: n.billDate, reservationId: n.reservationId, reservationNumber: n.reservationNumber, hostName: n.hostName,
      propertyId: n.propertyId, currency: n.currency, decimals: n.decimals, cancelReason: n.cancelReason ?? null, ...n.totals,
    };
  }
}
