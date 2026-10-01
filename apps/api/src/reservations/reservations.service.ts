import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model, Types } from 'mongoose';
import { MastersService } from '../masters/masters.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { BookingDetailsService, type MenuInput, type ReceiptInput } from './booking-details.service.js';
import type { MasterRecordDocument } from '../masters/master-record.schema.js';
import { addDays, fromMinutes, isDate, isLocalDateTime, toMinutes } from './local-time.js';
import {
  Counter,
  HallBlock,
  HallBlockDocument,
  HallLock,
  HOLDING_STATUSES,
  HallSlot,
  Reservation,
  ReservationDocument,
  ReservationStatus,
} from './reservation.schema.js';

export interface ReservationInput {
  propertyId: string;
  status: ReservationStatus;
  hostName: string;
  contactName?: string;
  phone: string;
  email?: string;
  functionTypeId: string;
  seatingStyleId?: string;
  guaranteedPax: number;
  expectedMaxPax: number;
  slots: HallSlot[];
  optionDate?: string;
  notes?: string;
  /** Needed when changing a Provisional or Confirmed booking. */
  amendmentReasonId?: string;
}

export interface BlockInput {
  hallId: string;
  start: string;
  end: string;
  reasonId: string;
  notes?: string;
}

/** Which status can follow which (see docs/workflows/reservation-stages.md). */
const NEXT: Partial<Record<ReservationStatus, ReservationStatus[]>> = {
  enquiry: ['provisional', 'waitlisted', 'confirmed', 'lost', 'cancelled'],
  provisional: ['confirmed', 'lost', 'cancelled'],
  waitlisted: ['provisional', 'confirmed', 'lost', 'cancelled'],
  confirmed: ['inFunction', 'cancelled'],
  inFunction: ['completed'],
};
const CREATE_STATUSES: ReservationStatus[] = ['enquiry', 'provisional', 'waitlisted', 'confirmed'];
const EDITABLE: ReservationStatus[] = ['enquiry', 'provisional', 'waitlisted', 'confirmed'];
/** Changing these needs an Amendment Reason and is recorded in the history. */
const AMEND_NEEDS_REASON: ReservationStatus[] = ['provisional', 'confirmed'];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  enquiry: 'Enquiry', provisional: 'Provisional', waitlisted: 'Waitlisted', confirmed: 'Confirmed',
  inFunction: 'In Function', completed: 'Function Completed', billed: 'Billed', cancelled: 'Cancelled', lost: 'Lost',
};

/** How long one request may hold a hall while it checks and saves, and how long another waits for it. */
const HALL_LOCK_LEASE_MS = 15_000;
const HALL_LOCK_WAIT_MS = 5_000;
export const CHANGED_ELSEWHERE = 'This booking was changed by someone else. Reload it and try again.';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Packages, extras and advances can be changed until the function is over. */
const DETAILS_EDITABLE: ReservationStatus[] = ['enquiry', 'provisional', 'waitlisted', 'confirmed', 'inFunction'];

export interface StatusOptions {
  reasonId?: string;
  optionDate?: string;
  note?: string;
  /** Cancellation: a lower charge than the slab gives (a waiver); needs a note. */
  cancellationCharge?: number;
  /** The user may confirm without the full advance, giving a note. */
  canSkipAdvance?: boolean;
  /** Needed to complete a function (reservation-stages.md 3.7). */
  actualPax?: number;
}

export const reservationView = (r: ReservationDocument, warnings: string[] = []) => ({
  id: r.id as string,
  number: r.number,
  status: r.status,
  propertyId: r.propertyId,
  hostName: r.hostName,
  contactName: r.contactName,
  phone: r.phone,
  email: r.email,
  functionTypeId: r.functionTypeId,
  seatingStyleId: r.seatingStyleId ?? null,
  guaranteedPax: r.guaranteedPax,
  expectedMaxPax: r.expectedMaxPax,
  actualPax: r.actualPax ?? null,
  slots: r.slots.map((s) => ({ hallId: s.hallId, start: s.start, end: s.end })),
  optionDate: r.optionDate ?? null,
  notes: r.notes,
  history: r.history.map((h) => ({ from: h.from, to: h.to, at: h.at, byUserId: h.byUserId, reasonId: h.reasonId ?? null, note: h.note ?? null })),
  warnings,
});

export const blockView = (b: HallBlockDocument) => ({
  id: b.id as string, hallId: b.hallId, start: b.start, end: b.end, reasonId: b.reasonId, notes: b.notes,
});

@Injectable()
export class ReservationsService {
  constructor(
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(HallBlock.name) private readonly blocks: Model<HallBlock>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    @InjectModel(HallLock.name) private readonly locks: Model<HallLock>,
    private readonly masters: MastersService,
    private readonly pricing: PricingService,
    private readonly booking: BookingDetailsService,
  ) {}

  /** Everything the diary shows for one property and date range: halls, bookings and blocks. */
  async diary(tenantId: Types.ObjectId, propertyId: string, from: string, days: number) {
    if (!isDate(from)) throw new BadRequestException('from must be a date (YYYY-MM-DD).');
    if (!Number.isInteger(days) || days < 1 || days > 31) throw new BadRequestException('days must be 1 to 31.');
    await this.activeRecord(tenantId, 'property', propertyId, 'Property');
    const halls = (await this.masters.list(tenantId, 'hall', false)).filter((h) => h.values.propertyId === propertyId);
    const start = `${from}T00:00`;
    const end = `${addDays(from, days)}T00:00`;
    const hallIds = halls.map((h) => h.id as string);
    const [reservations, blocks] = await Promise.all([
      this.reservations.find({
        tenantId, propertyId, status: { $ne: 'lost' }, slots: { $elemMatch: { end: { $gt: start }, start: { $lt: end } } },
      }).sort({ number: 1 }),
      this.blocks.find({ tenantId, active: true, hallId: { $in: hallIds }, start: { $lt: end }, end: { $gt: start } }),
    ]);
    return {
      from,
      days,
      halls: halls.map((h) => ({ id: h.id as string, name: h.values.description, capacity: h.values.capacity })),
      reservations: reservations.map((r) => reservationView(r)),
      blocks: blocks.map(blockView),
    };
  }

  async get(tenantId: Types.ObjectId, id: string) {
    const r = Types.ObjectId.isValid(id) ? await this.reservations.findOne({ tenantId, _id: id }) : null;
    if (!r) throw new NotFoundException('Reservation not found.');
    return r;
  }

  async create(tenantId: Types.ObjectId, userId: string, input: ReservationInput) {
    if (!CREATE_STATUSES.includes(input.status)) throw new BadRequestException('A new booking must be an Enquiry, Provisional, Waitlisted or Confirmed.');
    const holds = HOLDING_STATUSES.includes(input.status);
    return this.withHalls(tenantId, holds ? input.slots : [], async () => {
      const { clean, warnings } = await this.validate(tenantId, input, null);
      const seq = await this.next(tenantId, 'reservation');
      const r = await this.reservations.create({
        ...clean,
        tenantId,
        number: `R-${String(seq).padStart(6, '0')}`,
        history: [{ from: null, to: clean.status, at: new Date(), byUserId: userId }],
      });
      return reservationView(r, warnings);
    });
  }

  async update(tenantId: Types.ObjectId, userId: string, id: string, input: ReservationInput) {
    const r = await this.get(tenantId, id);
    if (!EDITABLE.includes(r.status)) throw new BadRequestException(`A ${STATUS_LABELS[r.status]} booking cannot be changed.`);
    if (AMEND_NEEDS_REASON.includes(r.status)) {
      await this.activeRecord(tenantId, 'amendmentReason', input.amendmentReasonId, 'Amendment reason');
    }
    // Status is changed through changeStatus, never by editing.
    return this.withHalls(tenantId, HOLDING_STATUSES.includes(r.status) ? input.slots : [], async () => {
      const { clean, warnings } = await this.validate(tenantId, { ...input, status: r.status }, r);
      Object.assign(r, clean);
      r.history.push({
        from: r.status, to: r.status, at: new Date(), byUserId: userId, reasonId: input.amendmentReasonId, note: 'Amended',
      });
      await this.saveChecked(r);
      return reservationView(r, warnings);
    });
  }

  async changeStatus(
    tenantId: Types.ObjectId,
    userId: string,
    id: string,
    to: ReservationStatus,
    opts: StatusOptions,
  ) {
    const r = await this.get(tenantId, id);
    if (!NEXT[r.status]?.includes(to)) {
      throw new BadRequestException(`A ${STATUS_LABELS[r.status]} booking cannot become ${STATUS_LABELS[to]}.`);
    }
    const note = opts.note?.trim() || undefined;
    if (to === 'cancelled') {
      await this.activeRecord(tenantId, 'cancellationReason', opts.reasonId, 'Cancellation reason');
      await this.chargeCancellation(tenantId, r, opts.cancellationCharge, note);
    }
    if (to === 'confirmed') {
      const { proforma, settings } = await this.booking.quote(tenantId, r);
      const advance = this.booking.advance(r, proforma.total, settings);
      if (advance.shortBy > 0) {
        if (!opts.canSkipAdvance) {
          throw new BadRequestException(`Confirming needs an advance of ${advance.required.toFixed(2)} (${advance.percent}% of the proforma); ${advance.paid.toFixed(2)} is paid.`);
        }
        if (!note) throw new BadRequestException('Give a note to confirm without the full advance.');
      }
    }
    if (to === 'inFunction') {
      // Started by the banquet captain on the day; a day's leeway covers early set-up.
      const first = r.slots.map((s) => s.start.slice(0, 10)).sort()[0];
      if (addDays(await this.masters.propertyToday(tenantId, r.propertyId), 1) < first) {
        throw new BadRequestException(`The function can be started from its date (${first}).`);
      }
    }
    if (to === 'completed') {
      const actual = opts.actualPax;
      if (typeof actual !== 'number' || !Number.isInteger(actual) || actual < 0) {
        throw new BadRequestException('Enter the actual pax (a whole number) to complete the function.');
      }
      r.actualPax = actual;
    }
    const warnings: string[] = [];
    const takesHall = HOLDING_STATUSES.includes(to) && r.status !== 'confirmed';
    return this.withHalls(tenantId, takesHall ? r.slots : [], async () => {
      if (takesHall) await this.checkAvailability(tenantId, r.slots, r._id);
      if (to === 'provisional') {
        r.optionDate = await this.optionDate(tenantId, r.propertyId, opts.optionDate, r.slots);
      } else if (to !== 'cancelled') {
        r.set('optionDate', undefined);
      }
      const from = r.status;
      r.status = to;
      r.history.push({ from, to, at: new Date(), byUserId: userId, reasonId: opts.reasonId, note });
      await this.saveChecked(r);
      return reservationView(r, warnings);
    });
  }

  /**
   * Called by billing when the final bill is fully settled: the only way a booking becomes Billed,
   * so the reservation status stays owned by this module.
   */
  async markBilled(tenantId: Types.ObjectId, userId: string, id: string, billNumber: string) {
    const r = await this.get(tenantId, id);
    if (r.status === 'billed') return reservationView(r);
    if (r.status !== 'completed') throw new BadRequestException(`A ${STATUS_LABELS[r.status]} booking cannot be marked billed.`);
    // One step, so a settlement never waits on, or loses to, another change to the booking.
    const done = await this.reservations.findOneAndUpdate(
      { _id: r._id, tenantId, status: 'completed' },
      {
        $set: { status: 'billed' },
        $push: { history: { from: 'completed', to: 'billed', at: new Date(), byUserId: userId, note: `Bill ${billNumber} settled` } },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after' },
    );
    return reservationView(done ?? (await this.get(tenantId, id)));
  }

  async details(tenantId: Types.ObjectId, id: string) {
    const r = await this.get(tenantId, id);
    return { ...reservationView(r), ...(await this.booking.details(tenantId, r)) };
  }

  async menuOptions(tenantId: Types.ObjectId, id: string) {
    const r = await this.get(tenantId, id);
    return this.booking.menuOptions(tenantId, r.propertyId);
  }

  async saveMenu(tenantId: Types.ObjectId, userId: string, id: string, input: MenuInput & { amendmentReasonId?: string }) {
    const r = await this.get(tenantId, id);
    if (!DETAILS_EDITABLE.includes(r.status)) throw new BadRequestException(`The menu of a ${STATUS_LABELS[r.status]} booking cannot be changed.`);
    const amend = [...AMEND_NEEDS_REASON, 'inFunction'].includes(r.status);
    if (amend) await this.activeRecord(tenantId, 'amendmentReason', input.amendmentReasonId, 'Amendment reason');
    await this.booking.applyMenu(tenantId, r, input);
    if (amend) {
      r.history.push({ from: r.status, to: r.status, at: new Date(), byUserId: userId, reasonId: input.amendmentReasonId, note: 'Menu changed' });
    }
    await this.saveChecked(r);
    return this.details(tenantId, id);
  }

  async addReceipt(tenantId: Types.ObjectId, userId: string, id: string, input: ReceiptInput) {
    const r = await this.get(tenantId, id);
    if (!DETAILS_EDITABLE.includes(r.status)) throw new BadRequestException(`A ${STATUS_LABELS[r.status]} booking cannot take an advance.`);
    await this.booking.addReceipt(tenantId, userId, r, input);
    await r.save();
    return this.details(tenantId, id);
  }

  /** Cancellation charge from the property's slabs, taken from advances first (open-questions.md, section 2). */
  private async chargeCancellation(tenantId: Types.ObjectId, r: ReservationDocument, override: number | undefined, note: string | undefined) {
    const { proforma, settings } = await this.booking.quote(tenantId, r);
    const preview = this.booking.cancellationPreview(r, proforma.total, settings, await this.masters.propertyToday(tenantId, r.propertyId));
    if (!preview) {
      if (override !== undefined && override > 0) throw new BadRequestException('This booking carries no cancellation charge.');
      if (r.receipts.length) {
        const paid = this.booking.paid(r);
        r.cancellation = { daysBefore: 0, percent: 0, computed: 0, ...this.booking.split(0, paid) };
      }
      return;
    }
    let charge = preview.computed;
    if (override !== undefined && override !== null) {
      if (typeof override !== 'number' || !Number.isFinite(override) || override < 0) throw new BadRequestException('Cancellation charge must be 0 or more.');
      if (override > preview.computed) throw new BadRequestException(`The charge cannot be more than the slab amount (${preview.computed.toFixed(2)}).`);
      if (override < preview.computed && !note) throw new BadRequestException('Give a note when reducing the cancellation charge.');
      charge = Math.round(override * 100) / 100;
    }
    r.cancellation = { daysBefore: preview.daysBefore, percent: preview.percent, computed: preview.computed, ...this.booking.split(charge, this.booking.paid(r)) };
  }

  async createBlock(tenantId: Types.ObjectId, userId: string, input: BlockInput) {
    if (!isLocalDateTime(input.start) || !isLocalDateTime(input.end) || input.end <= input.start) {
      throw new BadRequestException('Choose a valid from and to time.');
    }
    await this.activeRecord(tenantId, 'hall', input.hallId, 'Hall');
    await this.activeRecord(tenantId, 'hallBlockReason', input.reasonId, 'Hall block reason');
    const slot = { hallId: input.hallId, start: input.start, end: input.end };
    return this.withHalls(tenantId, [slot], async () => {
      await this.checkAvailability(tenantId, [slot], null);
      const block = await this.blocks.create({ ...slot, tenantId, reasonId: input.reasonId, notes: input.notes ?? '', byUserId: userId });
      return blockView(block);
    });
  }

  async removeBlock(tenantId: Types.ObjectId, id: string) {
    const block = Types.ObjectId.isValid(id) ? await this.blocks.findOne({ tenantId, _id: id, active: true }) : null;
    if (!block) throw new NotFoundException('Hall block not found.');
    block.active = false;
    await block.save();
  }

  private async validate(tenantId: Types.ObjectId, input: ReservationInput, existing: ReservationDocument | null) {
    const problems: string[] = [];
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const hostName = text(input.hostName);
    const phone = text(input.phone);
    if (!hostName) problems.push('Host (company or guest name) is required.');
    if (!phone) problems.push('Phone is required.');
    const g = input.guaranteedPax;
    const e = input.expectedMaxPax;
    if (!Number.isInteger(g) || g < 1) problems.push('Guaranteed pax must be a whole number of at least 1.');
    if (!Number.isInteger(e) || e < 1) problems.push('Expected max pax must be a whole number of at least 1.');
    else if (Number.isInteger(g) && e < g) problems.push('Expected max pax cannot be less than guaranteed pax.');
    if (!Array.isArray(input.slots) || input.slots.length === 0) problems.push('Choose at least one hall and time.');
    if (problems.length) throw new BadRequestException(problems);

    const property = await this.activeRecord(tenantId, 'property', input.propertyId, 'Property');
    await this.activeRecord(tenantId, 'functionType', input.functionTypeId, 'Function type');
    if (input.seatingStyleId) await this.activeRecord(tenantId, 'seatingStyle', input.seatingStyleId, 'Seating style');

    const warnings: string[] = [];
    const slots: HallSlot[] = [];
    for (const s of input.slots) {
      if (!s || !isLocalDateTime(s.start) || !isLocalDateTime(s.end) || s.end <= s.start) {
        throw new BadRequestException('Each hall needs a valid from and to time, with to after from.');
      }
      const hall = await this.activeRecord(tenantId, 'hall', s.hallId, 'Hall');
      if (hall.values.propertyId !== property.id) throw new BadRequestException(`${String(hall.values.description)} is not in this property.`);
      const capacity = hall.values.capacity as number;
      if (g > capacity) {
        throw new BadRequestException(`${String(hall.values.description)} holds ${capacity} guests; the guarantee is ${g}.`);
      }
      if (e > capacity) warnings.push(`Expected max (${e}) is more than the capacity of ${String(hall.values.description)} (${capacity}).`);
      slots.push({ hallId: s.hallId, start: s.start, end: s.end });
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const [a, b] = [slots[i], slots[j]];
        if (a.hallId === b.hallId && a.start < b.end && b.start < a.end) {
          throw new BadRequestException('The same hall is listed twice for overlapping times.');
        }
      }
    }

    if (HOLDING_STATUSES.includes(input.status)) await this.checkAvailability(tenantId, slots, existing?._id ?? null);

    const optionDate = input.status === 'provisional'
      ? await this.optionDate(tenantId, property.id as string, input.optionDate ?? existing?.optionDate, slots)
      : undefined;
    return {
      warnings,
      clean: {
        propertyId: property.id as string,
        status: input.status,
        hostName,
        contactName: text(input.contactName),
        phone,
        email: text(input.email),
        functionTypeId: input.functionTypeId,
        seatingStyleId: input.seatingStyleId || undefined,
        guaranteedPax: g,
        expectedMaxPax: e,
        slots,
        optionDate,
        notes: text(input.notes),
      },
    };
  }

  /**
   * The hall must be free of other holding bookings (Provisional, Confirmed, In Function) and of
   * hall blocks, including the hall's setup / cleanup buffer on both sides.
   */
  private async checkAvailability(tenantId: Types.ObjectId, slots: HallSlot[], excludeId: Types.ObjectId | null) {
    for (const slot of slots) {
      const hall = await this.masters.get(tenantId, 'hall', slot.hallId);
      const buffer = (hall.values.bufferMinutes as number) ?? 0;
      const from = toMinutes(slot.start) - buffer;
      const to = toMinutes(slot.end) + buffer;
      const overlaps = (s: { start: string; end: string }) => toMinutes(s.start) < to && toMinutes(s.end) > from;
      const name = String(hall.values.description);

      const filter: Record<string, unknown> = {
        tenantId,
        status: { $in: HOLDING_STATUSES },
        // Only bookings near this slot, not the hall's whole history.
        slots: { $elemMatch: { hallId: slot.hallId, end: { $gt: fromMinutes(from) }, start: { $lt: fromMinutes(to) } } },
      };
      if (excludeId) filter._id = { $ne: excludeId };
      for (const other of await this.reservations.find(filter)) {
        const clash = other.slots.find((s) => s.hallId === slot.hallId && overlaps(s));
        if (clash) {
          throw new ConflictException(
            `${name} is already held ${clash.start.replace('T', ' ')} to ${clash.end.replace('T', ' ')} by ${other.number} (${other.hostName}, ${STATUS_LABELS[other.status]}).` +
              (buffer ? ` The hall needs ${buffer} minutes between bookings.` : ''),
          );
        }
      }
      const blocks = await this.blocks.find({ tenantId, active: true, hallId: slot.hallId, start: { $lt: fromMinutes(to) }, end: { $gt: fromMinutes(from) } });
      const block = blocks.find(overlaps);
      if (block) {
        throw new ConflictException(`${name} is blocked ${block.start.replace('T', ' ')} to ${block.end.replace('T', ' ')}.`);
      }
    }
  }

  /** Given or default option date: by default 7 days from today, but at least 3 days before the function. */
  private async optionDate(tenantId: Types.ObjectId, propertyId: string, given: string | undefined, slots: HallSlot[]) {
    const today = await this.masters.propertyToday(tenantId, propertyId);
    const firstDay = slots.map((s) => s.start.slice(0, 10)).sort()[0];
    if (given) {
      if (!isDate(given)) throw new BadRequestException('Option date must be a date (YYYY-MM-DD).');
      if (given < today) throw new BadRequestException('Option date cannot be in the past.');
      if (given > firstDay) throw new BadRequestException('Option date cannot be after the function date.');
      return given;
    }
    const settings = await this.pricing.settings(tenantId, propertyId);
    const byRule = addDays(firstDay, -settings.optionBeforeFunctionDays);
    const def = addDays(today, settings.optionDays);
    const pick = def < byRule ? def : byRule;
    return pick < today ? today : pick;
  }

  /**
   * Runs `work` while holding a lease on each hall, so the availability check and the save happen
   * as one step: two people booking the same hall at the same moment cannot both get it.
   */
  private async withHalls<T>(tenantId: Types.ObjectId, slots: { hallId: string }[], work: () => Promise<T>): Promise<T> {
    const halls = [...new Set(slots.map((s) => s?.hallId).filter((h): h is string => typeof h === 'string'))].sort();
    if (!halls.length) return work();
    const owner = new Types.ObjectId().toHexString();
    const held: string[] = [];
    try {
      for (const hallId of halls) {
        await this.lockHall(tenantId, hallId, owner);
        held.push(hallId);
      }
      return await work();
    } finally {
      if (held.length) await this.locks.updateMany({ tenantId, hallId: { $in: held }, owner }, { $set: { until: new Date(0) } });
    }
  }

  private async lockHall(tenantId: Types.ObjectId, hallId: string, owner: string) {
    const giveUp = Date.now() + HALL_LOCK_WAIT_MS;
    for (;;) {
      const now = new Date();
      try {
        // Takes a free (or expired) lease; while someone holds it, the upsert hits the unique index.
        await this.locks.updateOne(
          { tenantId, hallId, until: { $lte: now } },
          { $set: { owner, until: new Date(now.getTime() + HALL_LOCK_LEASE_MS) } },
          { upsert: true },
        );
        return;
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
      if (Date.now() > giveUp) throw new ConflictException('Someone else is booking this hall right now. Please try again.');
      await pause(10 + Math.random() * 40);
    }
  }

  /** Saves the booking only if nobody else saved it since it was read. */
  private async saveChecked(r: ReservationDocument) {
    r.increment();
    try {
      await r.save();
    } catch (err) {
      if (err instanceof MongooseError.VersionError) throw new ConflictException(CHANGED_ELSEWHERE);
      throw err;
    }
  }

  private async activeRecord(tenantId: Types.ObjectId, kind: string, id: unknown, label: string): Promise<MasterRecordDocument> {
    if (typeof id !== 'string' || !id) throw new BadRequestException(`${label} is required.`);
    const record = await this.masters.get(tenantId, kind, id).catch(() => null);
    if (!record || !record.active) throw new BadRequestException(`${label}: choose an active entry from the list.`);
    return record;
  }

  private async next(tenantId: Types.ObjectId, name: string) {
    const c = await this.counters.findOneAndUpdate({ tenantId, name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    return c!.seq;
  }
}
