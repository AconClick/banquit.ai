import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill } from '../billing/bill.schema.js';
import { CreditNote } from '../billing/credit-note.schema.js';
import { MasterRecord } from '../masters/master-record.schema.js';
import { addDays, isDate } from '../reservations/local-time.js';
import { HallBlock, Reservation } from '../reservations/reservation.schema.js';
import { ReportCacheService } from './report-cache.service.js';
import * as math from './report-math.js';
import { toBillLike, toLike } from './report-records.js';
import * as summary from './report-summary.js';

export interface ReportQuery {
  /** Empty means every property of the tenant (group view). */
  propertyId?: string;
  from: string;
  to: string;
}

const MAX_REPORT_DAYS = 366;
const MAX_FORECAST_DAYS = 62;
/** Function sheets list every function, so they are for working days ahead, not a year. */
const MAX_SHEET_DAYS = 62;
/** The bill list under the Revenue totals shows this many bills, earliest first. */
const REVENUE_BILL_LIMIT = 500;

/**
 * Read-only reports over reservations, hall blocks and bills. Every query is filtered by the tenant,
 * and by the chosen property or the tenant's own properties, so no other tenant's data is read.
 * The counting reports add up monthly summaries (ReportCacheService), so a chain's yearly report
 * does not read every booking and bill each time.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(HallBlock.name) private readonly blocks: Model<HallBlock>,
    @InjectModel(MasterRecord.name) private readonly masters: Model<MasterRecord>,
    @InjectModel(Bill.name) private readonly bills: Model<Bill>,
    @InjectModel(CreditNote.name) private readonly creditNotes: Model<CreditNote>,
    private readonly cache: ReportCacheService,
  ) {}

  async bookingsByStatus(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const days = await this.cache.functionDays(tenantId, scope.propertyIds, scope.from, scope.to);
    return { ...this.header(scope), ...summary.readBookingsByStatus(days, scope.from, scope.to) };
  }

  async hallOccupancy(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const [days, blocks] = await Promise.all([this.cache.functionDays(tenantId, scope.propertyIds, scope.from, scope.to), this.blocksInRange(tenantId, scope)]);
    return { ...this.header(scope), rows: summary.readHallOccupancy(scope.halls, days, blocks, scope.from, scope.to) };
  }

  /** Bookings taken in the range (UTC dates), whatever their function date. */
  async enquiryConversion(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const [days, names] = await Promise.all([this.cache.conversionDays(tenantId, scope.propertyIds, scope.from, scope.to), this.names(tenantId, 'functionType')]);
    return { ...this.header(scope), ...summary.readEnquiryConversion(days, names, scope.from, scope.to) };
  }

  async functionSheets(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_SHEET_DAYS);
    const reservations = await this.reservationsInRange(tenantId, scope);
    const hallNames = new Map(scope.halls.map((h) => [h.id, h.name]));
    return { ...this.header(scope), rows: math.functionSheets(reservations, hallNames, await this.names(tenantId, 'functionType'), scope.from, scope.to) };
  }

  async forecast(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_FORECAST_DAYS);
    const [reservations, blocks] = await Promise.all([this.reservationsInRange(tenantId, scope), this.blocksInRange(tenantId, scope)]);
    return {
      ...this.header(scope),
      ...math.availabilityForecast(scope.halls, reservations, blocks, scope.from, scope.to),
      demand: math.menuDemand(reservations, await this.names(tenantId, 'menuItem'), scope.from, scope.to),
    };
  }

  /**
   * Revenue from final bills, by function date: totals from the monthly summaries, and the
   * earliest bills of the range listed. Credit notes issued in the range, by their own date, are
   * taken off (see report-math withCreditNotes). Reads bills and credit notes; never changes them.
   */
  async revenue(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const filter = {
      tenantId,
      propertyId: { $in: scope.propertyIds },
      status: { $in: [...math.REVENUE_BILL_STATUSES] },
      functionDate: { $gte: scope.from, $lte: scope.to },
    };
    const [months, edge, notes] = await Promise.all([
      this.cache.revenueDays(tenantId, scope.propertyIds, scope.from, scope.to),
      // The function date of the last bill listed, read from the index alone.
      this.bills.find(filter).sort({ functionDate: 1 }).skip(REVENUE_BILL_LIMIT - 1).limit(1).select({ _id: 0, functionDate: 1 }).lean(),
      // Few against the bills, so read as they are rather than summarised.
      this.creditNotes
        .find({ tenantId, propertyId: { $in: scope.propertyIds }, date: { $gte: scope.from, $lte: scope.to }, status: 'issued' })
        .select({ propertyId: 1, billId: 1, date: 1, status: 1, totals: 1 })
        .lean(),
    ]);
    const credited = await this.bills
      .find({ tenantId, _id: { $in: [...new Set(notes.map((n) => n.billId))].filter((id) => Types.ObjectId.isValid(id)) } })
      .select({ 'totals.lines.id': 1, 'totals.lines.source': 1 })
      .lean();
    const sourceOf = new Map(credited.flatMap((b) => (b.totals?.lines ?? []).map((l) => [`${String(b._id)}|${l.id}`, l.source] as [string, string])));
    const docs = await this.bills
      .find({ ...filter, functionDate: { $gte: scope.from, $lte: edge[0]?.functionDate ?? scope.to } })
      // The stored totals carry what the list needs; the editable lines and history are not read.
      .select({ lines: 0, history: 0, taxRates: 0 })
      .lean();
    const bills = math.revenue(docs.filter((b) => b.totals).map(toBillLike), scope.currencies, scope.from, scope.to).bills.slice(0, REVENUE_BILL_LIMIT);
    return {
      ...this.header(scope),
      ...math.withCreditNotes(
        summary.readRevenue(months, scope.currencies, scope.propertyIds, scope.from, scope.to),
        notes.map((n) => ({ propertyId: n.propertyId, billId: n.billId, date: n.date, status: n.status, totals: n.totals })),
        sourceOf, scope.currencies, scope.propertyIds, scope.from, scope.to, summary.emptyRevenueSum,
      ),
      bills,
      billLimit: REVENUE_BILL_LIMIT,
    };
  }

  /** Checks the dates and property, and loads the halls the report covers. */
  private async scope(tenantId: Types.ObjectId, q: ReportQuery, maxDays: number) {
    if (!isDate(q.from) || !isDate(q.to)) throw new BadRequestException('from and to must be dates (YYYY-MM-DD).');
    if (q.to < q.from) throw new BadRequestException('The end date cannot be before the start date.');
    if (addDays(q.from, maxDays - 1) < q.to) throw new BadRequestException(`Choose a range of at most ${maxDays} days.`);

    const properties = await this.masters.find({ tenantId, kind: 'property' }).lean();
    let propertyIds = properties.filter((p) => p.active).map((p) => String(p._id));
    if (q.propertyId) {
      // Only a property of this tenant; another tenant's id is simply not found.
      if (!properties.some((p) => String(p._id) === q.propertyId)) throw new NotFoundException('Property not found.');
      propertyIds = [q.propertyId];
    }
    const halls = (await this.masters.find({ tenantId, kind: 'hall', active: true }).sort({ uniqueKey: 1 }).lean())
      .filter((h) => propertyIds.includes(String(h.values.propertyId)))
      .map((h) => ({
        id: String(h._id),
        name: String(h.values.description),
        propertyId: String(h.values.propertyId),
        capacity: Number(h.values.capacity),
      }));
    const propertyNames = new Map(properties.map((p) => [String(p._id), String(p.values.name)]));
    const currencies = new Map(properties.map((p) => [String(p._id), String(p.values.currency ?? '')]));
    return { from: q.from, to: q.to, propertyId: q.propertyId || null, propertyIds, propertyNames, currencies, halls };
  }

  private header(scope: Awaited<ReturnType<ReportsService['scope']>>) {
    return {
      from: scope.from,
      to: scope.to,
      propertyId: scope.propertyId,
      properties: scope.propertyIds.map((id) => ({ id, name: scope.propertyNames.get(id) ?? '' })),
    };
  }

  /** Reservations with any hall slot touching the range. */
  private async reservationsInRange(tenantId: Types.ObjectId, scope: { from: string; to: string; propertyIds: string[] }) {
    const start = `${scope.from}T00:00`;
    const end = `${addDays(scope.to, 1)}T00:00`;
    const docs = await this.reservations
      .find({ tenantId, propertyId: { $in: scope.propertyIds }, slots: { $elemMatch: { end: { $gt: start }, start: { $lt: end } } } })
      .select({ receipts: 0, notes: 0, cancellation: 0 })
      .lean();
    // Sorted here: asking the database to sort by number makes it walk every booking of the tenant.
    docs.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
    return docs.map(toLike);
  }

  private async blocksInRange(tenantId: Types.ObjectId, scope: { from: string; to: string; halls: { id: string }[] }) {
    const docs = await this.blocks
      .find({ tenantId, active: true, hallId: { $in: scope.halls.map((h) => h.id) }, start: { $lt: `${addDays(scope.to, 1)}T00:00` }, end: { $gt: `${scope.from}T00:00` } })
      .lean();
    return docs.map((b) => ({ hallId: b.hallId, start: b.start, end: b.end }));
  }

  private async names(tenantId: Types.ObjectId, kind: string) {
    const records = await this.masters.find({ tenantId, kind }).lean();
    return new Map(records.map((r) => [String(r._id), String(r.values.description)]));
  }
}
