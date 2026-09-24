/**
 * GroomerProfile (Business) Mongoose model.
 *
 * Holds a groomer's business configuration: branding, booking slug, deposit,
 * estimate rules, recurring availability windows, blocked dates, Google
 * Calendar linkage, onboarding progress, and theme preference. One profile
 * exists per User.
 *
 * _Requirements: 22.1, 22.4, 22.5, 22.6, 15.5, 15.6_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';
import type { CoatCondition, EstimateRule } from '@/types';

interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface BlockedDate {
  startDateTime: Date;
  endDateTime: Date;
}

export interface IGroomerProfile {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  businessName?: string;
  groomerSlug?: string;
  logoUrl?: string;
  phone?: string;
  businessEmail?: string;
  depositAmount: number;
  estimateRules: EstimateRule[];
  availabilityWindows: AvailabilityWindow[];
  blockedDates: BlockedDate[];
  googleCalendarId?: string;
  googleRefreshToken?: string;
  googleCalendarConnected: boolean;
  onboardingComplete: boolean;
  onboardingStep: number;
  themePreference: 'light' | 'dark';
  serviceIntervalDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const estimateRuleSchema = new Schema<EstimateRule>(
  {
    coatCondition: {
      type: String,
      enum: ['smooth', 'double', 'wire', 'curly', 'long', 'matted'] satisfies CoatCondition[],
    },
    weightRange: { min: Number, max: Number },
    priceAdjustmentPercent: { type: Number, min: -50, max: 50 },
    note: { type: String, maxlength: 500 },
  },
  { _id: false }
);

const availabilityWindowSchema = new Schema<AvailabilityWindow>(
  {
    dayOfWeek: { type: Number, min: 0, max: 6 }, // 0 = Monday
    startTime: { type: String }, // "09:00" (15-min increments)
    endTime: { type: String }, // "17:00"
  },
  { _id: false }
);

const blockedDateSchema = new Schema<BlockedDate>(
  {
    startDateTime: { type: Date, required: true },
    endDateTime: { type: Date, required: true },
  },
  { _id: false }
);

const groomerProfileSchema = new Schema<IGroomerProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, maxlength: 100 },
    groomerSlug: { type: String, unique: true, sparse: true, lowercase: true, match: /^[a-z0-9-]{3,40}$/ },
    logoUrl: { type: String },
    phone: { type: String, maxlength: 15 },
    businessEmail: { type: String, maxlength: 254 },
    depositAmount: { type: Number, min: 0, max: 500, default: 25 },
    estimateRules: [estimateRuleSchema],
    availabilityWindows: [availabilityWindowSchema],
    blockedDates: [blockedDateSchema],
    googleCalendarId: { type: String },
    googleRefreshToken: { type: String },
    googleCalendarConnected: { type: Boolean, default: false },
    onboardingComplete: { type: Boolean, default: false },
    onboardingStep: { type: Number, default: 0 },
    themePreference: { type: String, enum: ['light', 'dark'], default: 'light' },
    serviceIntervalDays: { type: Number, default: 42 }, // 6 weeks
  },
  { timestamps: true }
);

// Note: the `groomerSlug` (unique, sparse) and `userId` (unique) indexes are
// already created by their field-level definitions above. Declaring them again
// here would produce a conflicting duplicate index of the same auto-generated
// name, which `syncIndexes()` rejects.

export const GroomerProfile: Model<IGroomerProfile> =
  (models.GroomerProfile as Model<IGroomerProfile>) ||
  model<IGroomerProfile>('GroomerProfile', groomerProfileSchema);
