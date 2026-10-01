import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bill } from '../billing/bill.schema.js';
import { MasterRecord } from '../masters/master-record.schema.js';
import { addDays, isDate } from '../reservations/local-time.js';
import { HallBlock, Reservation } from '../reservations/reservation.schema.js';
import * as math from './report-math.js';

export interface ReportQuery {
  /** Empty means every property of the tenant (group view). */
  propertyId?: string;
  from: string;
  to: string;
}

const MAX_REPORT_DAYS = 366;
const MAX_FORECAST_DAYS = 62;
/** What the counting reports read; leaving out history and menus keeps a chain's yearly report light. */
const SUMMARY_FIELDS = { number: 1, status: 1, propertyId: 1, hostName: 1, functionTypeId: 1, guaranteedPax: 1, expectedMaxPax: 1, actualPax: 1, slots: 1 } as const;

/**
 * Read-only reports over reservations and hall blocks. Every query is filtered by the tenant,
 * and by the chosen property or the tenant's own properties, so no other tenant's data is read.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(HallBlock.name) private readonly blocks: Model<HallBlock>,
    @InjectModel(MasterRecord.name) private readonly masters: Model<MasterRecord>,
    @InjectModel(Bill.name) private readonly bills: Model<Bill>,
  ) {}

  async bookingsByStatus(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const reservations = await this.reservationsInRange(tenantId, scope, SUMMARY_FIELDS);
    return { ...this.header(scope), ...math.bookingsByStatus(reservations, scope.from, scope.to) };
  }

  async hallOccupancy(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const [reservations, blocks] = await Promise.all([this.reservationsInRange(tenantId, scope, SUMMARY_FIELDS), this.blocksInRange(tenantId, scope)]);
    return { ...this.header(scope), rows: math.hallOccupancy(scope.halls, reservations, blocks, scope.from, scope.to) };
  }

  async enquiryConversion(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    // Bookings taken in the range, whatever their function date.
    const docs = await this.reservations
      .find({
        tenantId,
        propertyId: { $in: scope.propertyIds },
        createdAt: { $gte: new Date(`${scope.from}T00:00:00Z`), $lt: new Date(`${addDays(scope.to, 1)}T00:00:00Z`) },
      })
      .lean();
    return { ...this.header(scope), ...math.enquiryConversion(docs.map(toLike), await this.names(tenantId, 'functionType')) };
  }

  async functionSheets(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
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

  /** Revenue from final bills, by function date. Reads bills; never changes them. */
  async revenue(tenantId: Types.ObjectId, q: ReportQuery) {
    const scope = await this.scope(tenantId, q, MAX_REPORT_DAYS);
    const docs = await this.bills
      .find({
        tenantId,
        propertyId: { $in: scope.propertyIds },
        status: { $in: [...math.REVENUE_BILL_STATUSES] },
        functionDate: { $gte: scope.from, $lte: scope.to },
      })
      // The stored totals carry what the report needs; the editable lines and history are not read.
      .select({ lines: 0, history: 0, taxRates: 0 })
      .lean();
    const bills = docs
      .filter((b) => b.totals)
      .map((b) => ({
        id: String(b._id), number: b.number ?? '', propertyId: b.propertyId, reservationId: b.reservationId,
        reservationNumber: b.reservationNumber, hostName: b.hostName, functionDate: b.functionDate, status: b.status,
        totals: b.totals as unknown as math.BillLike['totals'], advances: b.advances, payments: b.payments,
      }));
    return { ...this.header(scope), ...math.revenue(bills, scope.currencies, scope.from, scope.to) };
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
  private async reservationsInRange(tenantId: Types.ObjectId, scope: { from: string; to: string; propertyIds: string[] }, fields: Record<string, 0 | 1> = { receipts: 0, notes: 0, cancellation: 0 }) {
    const start = `${scope.from}T00:00`;
    const end = `${addDays(scope.to, 1)}T00:00`;
    const docs = await this.reservations
      .find({ tenantId, propertyId: { $in: scope.propertyIds }, slots: { $elemMatch: { end: { $gt: start }, start: { $lt: end } } } })
      .select(fields)
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

type LeanReservation = Reservation & { _id: Types.ObjectId; createdAt?: Date };

function toLike(r: LeanReservation): math.ReservationLike {
  return {
    id: String(r._id),
    number: r.number,
    status: r.status,
    propertyId: r.propertyId,
    hostName: r.hostName,
    functionTypeId: r.functionTypeId,
    seatingStyleId: r.seatingStyleId ?? null,
    guaranteedPax: r.guaranteedPax,
    expectedMaxPax: r.expectedMaxPax,
    actualPax: r.actualPax ?? null,
    slots: r.slots.map((s) => ({ hallId: s.hallId, start: s.start, end: s.end })),
    history: (r.history ?? []).map((h) => ({ from: h.from, to: h.to, at: h.at })),
    createdAt: r.createdAt,
    packages: (r.packages ?? []).map((p) => ({ packageId: p.packageId, name: p.name, pax: p.pax, choices: [...p.choices] })),
    extras: (r.extras ?? []).map((e) => ({ itemId: e.itemId, name: e.name, aType: e.aType, qty: e.qty })),
  };
}
