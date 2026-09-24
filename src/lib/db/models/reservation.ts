/**
 * Reservation Mongoose model.
 *
 * A short-lived document representing a tentative hold on a groomer's time
 * slot while a client completes the booking flow (steps 4 → 5). Each hold is
 * owned by a browser `sessionId` and lasts 10 minutes.
 *
 * Expiry is enforced by MongoDB itself via a TTL index on `expiresAt`
 * (`expireAfterSeconds: 0`): once `expiresAt` is in the past, the server
 * reaps the document automatically, so an abandoned checkout frees the slot
 * without any application-level cleanup.
 *
 * See `lib/calendar/reservation.ts` for the atomic check-and-reserve logic.
 *
 * _Requirements: 6.3, 6.4_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IReservation {
  _id: Types.ObjectId;
  groomerId: Types.ObjectId;
  slotStart: Date;
  slotEnd: Date;
  sessionId: string;
  expiresAt: Date;
}

const reservationSchema = new Schema<IReservation>({
  groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  slotStart: { type: Date, required: true },
  slotEnd: { type: Date, required: true },
  sessionId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

// TTL index: MongoDB removes the document once `expiresAt` has passed, so a
// tentative hold that is never converted to a booking self-expires.
reservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Supports the check-and-reserve lookup by groomer + exact slot bounds.
reservationSchema.index({ groomerId: 1, slotStart: 1, slotEnd: 1 });

export const Reservation: Model<IReservation> =
  (models.Reservation as Model<IReservation>) ||
  model<IReservation>('Reservation', reservationSchema);
