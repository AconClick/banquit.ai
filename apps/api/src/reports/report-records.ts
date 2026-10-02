import type { Types } from 'mongoose';
import type { Bill } from '../billing/bill.schema.js';
import type { Reservation } from '../reservations/reservation.schema.js';
import type { BillLike, ReservationLike } from './report-math.js';

/** Plain report records from lean bookings and bills, whatever fields the query selected. */

export type LeanReservation = Reservation & { _id: Types.ObjectId; createdAt?: Date };
export type LeanBill = Bill & { _id: Types.ObjectId };

export function toLike(r: LeanReservation): ReservationLike {
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
    slots: (r.slots ?? []).map((s) => ({ hallId: s.hallId, start: s.start, end: s.end })),
    history: (r.history ?? []).map((h) => ({ from: h.from, to: h.to, at: h.at })),
    createdAt: r.createdAt,
    packages: (r.packages ?? []).map((p) => ({ packageId: p.packageId, name: p.name, pax: p.pax, choices: [...p.choices] })),
    extras: (r.extras ?? []).map((e) => ({ itemId: e.itemId, name: e.name, aType: e.aType, qty: e.qty })),
  };
}

export function toBillLike(b: LeanBill): BillLike {
  return {
    id: String(b._id), number: b.number ?? '', propertyId: b.propertyId, reservationId: b.reservationId,
    reservationNumber: b.reservationNumber, hostName: b.hostName, functionDate: b.functionDate, status: b.status,
    totals: b.totals as unknown as BillLike['totals'], advances: b.advances ?? [], payments: b.payments ?? [],
    credits: (b.credits ?? []).map((c) => ({ total: c.total, status: c.status })),
  };
}
