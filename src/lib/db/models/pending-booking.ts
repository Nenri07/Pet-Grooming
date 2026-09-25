/**
 * PendingBooking Mongoose model.
 *
 * A short-lived server-side record of the FULL booking context (pet, owner,
 * slot) captured when a Stripe deposit PaymentIntent is created. Stripe
 * metadata values are capped at 500 characters EACH, which the full pet+owner
 * payload comfortably exceeds, so the booking cannot be round-tripped through
 * the PaymentIntent metadata. Instead we persist it here keyed by the
 * PaymentIntent id and put only small identifiers on the Stripe metadata.
 *
 * On `payment_intent.succeeded` the webhook looks the record up by
 * `paymentIntentId`, materialises the Client/Pet/Appointment/Transaction, then
 * deletes it. A TTL index on `createdAt` (expire after 1 hour) reaps records
 * for abandoned/failed checkouts so nothing lingers.
 *
 * _Requirements: 7.1, 7.3, 7.5_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';
import type { OwnerDetailsInput, PetInfoInput } from '@/types';

export interface IPendingBooking {
  _id: Types.ObjectId;
  /** The Stripe PaymentIntent id this booking is keyed on (unique). */
  paymentIntentId: string;
  groomerId: Types.ObjectId;
  groomerSlug: string;
  /** Full pet details captured in Step 1. */
  pet: PetInfoInput;
  /** Full owner + service-address details captured in Step 2. */
  owner: OwnerDetailsInput;
  /** ISO-8601 start of the selected slot. */
  slotStart: string;
  /** ISO-8601 end of the selected slot (optional; webhook falls back to service duration). */
  slotEnd?: string;
  /** Optional explicit service id the client is booking. */
  serviceId?: string;
  /**
   * Optional Redis hold id placed on the slot before payment (Master Spec
   * §9.4). Threaded through so the webhook can release the hold + bust the slot
   * cache once the booking is fulfilled. Absent for back-compat / no-Redis.
   */
  holdId?: string;
  /** SMS consent (§12.3) captured at booking step 2; stamped on the Client. */
  smsConsent?: boolean;
  createdAt: Date;
}

// The pet/owner subdocuments are stored as flexible Mixed types: they mirror
// the PetInfoInput / OwnerDetailsInput shapes but we don't re-declare every
// field here — the webhook re-validates before persisting the real records.
const pendingBookingSchema = new Schema<IPendingBooking>({
  paymentIntentId: { type: String, required: true, unique: true },
  groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  groomerSlug: { type: String, required: true },
  pet: { type: Schema.Types.Mixed, required: true },
  owner: { type: Schema.Types.Mixed, required: true },
  slotStart: { type: String, required: true },
  slotEnd: { type: String },
  serviceId: { type: String },
  holdId: { type: String },
  smsConsent: { type: Boolean },
  createdAt: { type: Date, default: Date.now },
});

// TTL index: MongoDB removes a pending booking one hour after creation, so an
// abandoned or failed checkout self-cleans even if the webhook never runs.
pendingBookingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const PendingBooking: Model<IPendingBooking> =
  (models.PendingBooking as Model<IPendingBooking>) ||
  model<IPendingBooking>('PendingBooking', pendingBookingSchema);
