/**
 * CalendarBlock Mongoose model.
 *
 * A stored time block that removes availability from a groomer's calendar
 * (e.g. a break or a busy period). Availability computation
 * (`lib/calendar/availability.ts`) queries these rows so blocked time is
 * excluded from generated slots. PawPort has no external calendar dependency
 * (Master Spec §9 — Google Calendar removed); these rows are now purely
 * native.
 *
 * _Requirements: 6.1_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

/**
 * The origin of a CalendarBlock row.
 *  - 'groomer': a per-groomer block. `groomerId` is set.
 *  - 'shared-calendar': a legacy source retained only for backward
 *    compatibility with any rows written before the native calendar migration.
 */
export type CalendarBlockSource = 'groomer' | 'shared-calendar';

export interface ICalendarBlock {
  _id: Types.ObjectId;
  /** Present for per-groomer blocks; absent for legacy shared blocks. */
  groomerId?: Types.ObjectId;
  /** Provenance of this block. Defaults to 'groomer'. */
  source: CalendarBlockSource;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

const calendarBlockSchema = new Schema<ICalendarBlock>(
  {
    // Optional: shared-calendar blocks (service-account model) are not tied to
    // a single groomer, so groomerId may be absent for them.
    groomerId: { type: Schema.Types.ObjectId, ref: 'User' },
    source: {
      type: String,
      enum: ['groomer', 'shared-calendar'],
      default: 'groomer',
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
  },
  { timestamps: true }
);

// Supports the range query used by getAvailableSlots:
//   { groomerId, startTime: { $lte: endDate }, endTime: { $gte: startDate } }
calendarBlockSchema.index({ groomerId: 1, startTime: 1, endTime: 1 });
calendarBlockSchema.index({ source: 1, startTime: 1, endTime: 1 });

export const CalendarBlock: Model<ICalendarBlock> =
  (models.CalendarBlock as Model<ICalendarBlock>) ||
  model<ICalendarBlock>('CalendarBlock', calendarBlockSchema);
