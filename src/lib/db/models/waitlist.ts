/**
 * Waitlist model (Master Spec §11.1, §14).
 *
 * A client who wants an earlier / specific slot goes on the groomer's waitlist.
 * When a gap opens (cancellation or the groomer taps "Fill this gap"), active
 * waitlist entries whose preferred days / service match are ranked as Fill My
 * Day candidates and offered the slot via SMS.
 *
 * `status` walks: active → offered (a claim SMS went out) → filled (they took
 * a slot) / expired (window passed or the entry was retired).
 *
 * _Master Spec: §11.1, §14_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

/** Lifecycle of a waitlist entry (§14). */
export type WaitlistStatus = 'active' | 'offered' | 'filled' | 'expired';

export interface IWaitlist {
  groomerId: Types.ObjectId;
  clientId: Types.ObjectId;
  petId?: Types.ObjectId;
  serviceId?: Types.ObjectId;
  /** Preferred weekdays, 0=Sunday..6=Saturday (empty = any day). */
  preferredDays: number[];
  /** Earliest acceptable date (inclusive). */
  earliestDate?: Date;
  /** Latest acceptable date (inclusive). */
  latestDate?: Date;
  status: WaitlistStatus;
  createdAt: Date;
  updatedAt: Date;
}

const waitlistSchema = new Schema<IWaitlist>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    petId: { type: Schema.Types.ObjectId, ref: 'Pet' },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
    preferredDays: { type: [Number], default: [] },
    earliestDate: { type: Date },
    latestDate: { type: Date },
    status: {
      type: String,
      enum: ['active', 'offered', 'filled', 'expired'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Fill My Day query: a groomer's active entries (§11.1).
waitlistSchema.index({ groomerId: 1, status: 1 });
waitlistSchema.index({ clientId: 1 });

export const Waitlist: Model<IWaitlist> =
  (models.Waitlist as Model<IWaitlist>) || model<IWaitlist>('Waitlist', waitlistSchema);
