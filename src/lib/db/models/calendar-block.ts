/**
 * CalendarBlock Mongoose model.
 *
 * A locally-stored copy of a Google Calendar event that blocks time on a
 * groomer's availability. The bidirectional calendar sync (see
 * `lib/calendar/sync.ts`) writes these rows so that availability computation
 * (`lib/calendar/availability.ts`) can query blocked time without hitting the
 * Google Calendar API on every request.
 *
 * _Requirements: 6.1, 6.2, 14.2, 14.3_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

/**
 * The origin of a CalendarBlock row.
 *  - 'groomer': a per-groomer block (historical / OAuth model). `groomerId`
 *    is set.
 *  - 'shared-calendar': a busy block synced from the single shared
 *    service-account calendar (locked service-account model). `groomerId` is
 *    absent; the block applies to the shared calendar and is refreshed
 *    wholesale by the calendar-sync cron.
 */
export type CalendarBlockSource = 'groomer' | 'shared-calendar';

export interface ICalendarBlock {
  _id: Types.ObjectId;
  /** Present for per-groomer blocks; absent for shared-calendar blocks. */
  groomerId?: Types.ObjectId;
  /** Provenance of this block. Defaults to 'groomer' for backward compat. */
  source: CalendarBlockSource;
  startTime: Date;
  endTime: Date;
  googleEventId?: string;
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
    googleEventId: { type: String },
  },
  { timestamps: true }
);

// Supports the range query used by getAvailableSlots:
//   { groomerId, startTime: { $lte: endDate }, endTime: { $gte: startDate } }
calendarBlockSchema.index({ groomerId: 1, startTime: 1, endTime: 1 });
// Supports the shared-calendar cron's in-window replace:
//   { source: 'shared-calendar', startTime: { $lt: end }, endTime: { $gt: start } }
calendarBlockSchema.index({ source: 1, startTime: 1, endTime: 1 });

export const CalendarBlock: Model<ICalendarBlock> =
  (models.CalendarBlock as Model<ICalendarBlock>) ||
  model<ICalendarBlock>('CalendarBlock', calendarBlockSchema);
