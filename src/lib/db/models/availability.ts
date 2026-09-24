/**
 * Availability (forward model) — Master Spec §9.2, §14.
 *
 * The forward-looking source of truth for a groomer's recurring weekly
 * availability windows and one-off blocks, with an IANA timezone. All slot math
 * is done in UTC internally and converted using this timezone (§9.2).
 *
 * NOTE: this coexists with the profile-embedded `availabilityWindows` /
 * `blockedDates` on GroomerProfile for now. No data has been migrated yet — the
 * native slot engine (Phase 2) still reads from the profile. This model is the
 * target shape for a later migration.
 *
 * _Master Spec: §9.2, §14_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

/** A recurring weekly window. `day` uses 0 = Monday .. 6 = Sunday. */
export interface WeeklyWindow {
  day: number;
  start: string; // "09:00"
  end: string; // "17:00"
}

/** A one-off blocked interval (holiday, break, manual block). */
export interface AvailabilityBlock {
  startAt: Date;
  endAt: Date;
  reason?: string;
}

export interface IAvailability {
  _id: Types.ObjectId;
  groomerId: Types.ObjectId;
  weeklyWindows: WeeklyWindow[];
  blocks: AvailabilityBlock[];
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

const weeklyWindowSchema = new Schema<WeeklyWindow>(
  {
    day: { type: Number, required: true, min: 0, max: 6 }, // 0 = Monday
    start: { type: String, required: true }, // "09:00"
    end: { type: String, required: true }, // "17:00"
  },
  { _id: false }
);

const availabilityBlockSchema = new Schema<AvailabilityBlock>(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    reason: { type: String, maxlength: 200 },
  },
  { _id: false }
);

const availabilitySchema = new Schema<IAvailability>(
  {
    groomerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
      unique: true,
    },
    weeklyWindows: [weeklyWindowSchema],
    blocks: [availabilityBlockSchema],
    timezone: { type: String, default: 'UTC' },
  },
  { timestamps: true }
);

export const Availability: Model<IAvailability> =
  (models.Availability as Model<IAvailability>) ||
  model<IAvailability>('Availability', availabilitySchema);
