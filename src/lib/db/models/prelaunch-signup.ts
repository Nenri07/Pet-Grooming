import { Schema, model, models, type Model, type Types } from 'mongoose';

/**
 * PrelaunchSignup — a pre-launch "coming soon" early-access email signup.
 *
 * Distinct from the groomer-facing Fill-My-Day `Waitlist` model (which tracks a
 * groomer's clients waiting for an earlier slot). This one captures anonymous
 * marketing-site visitors from the `/coming-soon` page's email form
 * (`joinWaitlist`). `email` is unique so a repeat signup is idempotent.
 */
export interface IPrelaunchSignup {
  _id: Types.ObjectId;
  email: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const prelaunchSignupSchema = new Schema<IPrelaunchSignup>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    source: { type: String, default: 'coming-soon', maxlength: 60 },
  },
  { timestamps: true }
);

export const PrelaunchSignup: Model<IPrelaunchSignup> =
  (models.PrelaunchSignup as Model<IPrelaunchSignup>) ||
  model<IPrelaunchSignup>('PrelaunchSignup', prelaunchSignupSchema);
