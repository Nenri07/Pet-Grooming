import { Schema, model, models, type Document, type Types } from 'mongoose';
import type { AppointmentStatus } from '@/types';

// Canonical definition lives in `src/types`; re-exported here for convenience.
export type { AppointmentStatus } from '@/types';

/** Routing metadata attached at commit time (Master Spec §10.5). */
export interface RouteMeta {
  prevId?: Types.ObjectId | string | null;
  nextId?: Types.ObjectId | string | null;
  extraDriveMin?: number;
  fromPrevKm?: number;
  score?: number;
}

/** Where a booking originated (Master Spec §14). */
export type AppointmentSource = 'public' | 'manual' | 'claim' | 'rebook';

export interface IAppointment extends Document {
  groomerId: Types.ObjectId;
  clientId: Types.ObjectId;
  petId: Types.ObjectId;
  serviceId: Types.ObjectId;
  /** Additive multi-service field; `serviceId` is kept as the required legacy field. */
  serviceIds?: Types.ObjectId[];
  scheduledDate: Date;
  scheduledEndDate: Date;
  status: AppointmentStatus;
  serviceAddress?: string;
  notes?: string;
  postGroomNotes?: string;
  // --- PawPort native calendar & routing (additive; §10.5, §14) ---
  /** Geocoded coordinates for this appointment's service address (§10.1). */
  location?: { lat: number; lng: number };
  routeMeta?: RouteMeta;
  flexible?: boolean;
  source?: AppointmentSource;
  /**
   * Additive (§12.3): QStash message ids for the scheduled reminder jobs
   * (reminder_24h, reminder_2h). Stored so reschedule/cancel can cancel them.
   */
  reminderJobIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    petId: { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceIds: [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    scheduledDate: { type: Date, required: true },
    scheduledEndDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'in-progress', 'completed', 'cancelled'],
      default: 'upcoming',
    },
    serviceAddress: { type: String, maxlength: 500 },
    notes: { type: String, maxlength: 500 },
    postGroomNotes: { type: String, maxlength: 2000 },
    // --- PawPort native calendar & routing (additive; §10.5, §14) ---
    location: {
      type: new Schema<{ lat: number; lng: number }>(
        {
          lat: { type: Number, required: true, min: -90, max: 90 },
          lng: { type: Number, required: true, min: -180, max: 180 },
        },
        { _id: false }
      ),
      required: false,
    },
    routeMeta: {
      type: new Schema<RouteMeta>(
        {
          prevId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
          nextId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
          extraDriveMin: { type: Number },
          fromPrevKm: { type: Number },
          score: { type: Number },
        },
        { _id: false }
      ),
      required: false,
    },
    flexible: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ['public', 'manual', 'claim', 'rebook'],
      default: 'public',
    },
    // Additive (§12.3): scheduled reminder job ids (QStash) for cancel/replace.
    reminderJobIds: { type: [String], default: undefined },
  },
  { timestamps: true }
);

appointmentSchema.index({ groomerId: 1, scheduledDate: 1 });
appointmentSchema.index({ groomerId: 1, status: 1 });
appointmentSchema.index({ clientId: 1 });
appointmentSchema.index({ petId: 1 });

// Double-booking safety net (§9.4): non-cancelled appointments only.
// A partial index keeps cancelled rows out so a re-booked slot after a
// cancellation is not blocked. This is a query-acceleration + integrity aid;
// the authoritative race check is the Redis lock + Mongo re-check in commit.ts.
appointmentSchema.index(
  { groomerId: 1, scheduledDate: 1 },
  {
    name: 'active_groomer_slot',
    partialFilterExpression: { status: { $ne: 'cancelled' } },
  }
);

export const Appointment =
  models.Appointment || model<IAppointment>('Appointment', appointmentSchema);
