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

/** A geographic point (Master Spec §10.1). */
interface GeoPoint {
  lat: number;
  lng: number;
}

/** A travel-fee tier: charge `fee` for distances up to `uptoKm` (§10.4). */
interface TravelFeeTier {
  uptoKm: number;
  fee: number;
}

/** How new bookings are handled (§9.2). */
export type BookingMode = 'instant' | 'request';

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
  // --- PawPort native calendar & routing (Master Spec §9.2, §10.1, §14) ---
  // All additive; existing google* fields retained for now.
  timezone?: string;
  baseAddress?: string;
  baseLocation?: GeoPoint;
  serviceRadiusKm?: number;
  maxDetourMin?: number;
  bufferMin?: number;
  slotStepMin?: number;
  minNoticeHours?: number;
  maxAdvanceDays?: number;
  avgSpeedKmh?: number;
  roadFactor?: number;
  parkingMin?: number;
  travelFeeTiers?: TravelFeeTier[];
  bookingMode?: BookingMode;
  icsFeedToken?: string;
  depositPolicy?: string;
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

const geoPointSchema = new Schema<GeoPoint>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false }
);

const travelFeeTierSchema = new Schema<TravelFeeTier>(
  {
    uptoKm: { type: Number, required: true, min: 0 },
    fee: { type: Number, required: true, min: 0 },
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
    // --- PawPort native calendar & routing (additive; §9.2, §10.1, §14) ---
    timezone: { type: String, default: 'UTC' },
    baseAddress: { type: String, maxlength: 300 },
    baseLocation: { type: geoPointSchema },
    serviceRadiusKm: { type: Number, min: 0 },
    maxDetourMin: { type: Number, min: 0, default: 25 },
    bufferMin: { type: Number, min: 0, default: 10 },
    slotStepMin: { type: Number, min: 5, default: 15 },
    minNoticeHours: { type: Number, min: 0, default: 12 },
    maxAdvanceDays: { type: Number, min: 1, default: 30 },
    avgSpeedKmh: { type: Number, min: 1, default: 32 },
    roadFactor: { type: Number, min: 1, default: 1.35 },
    parkingMin: { type: Number, min: 0, default: 3 },
    travelFeeTiers: [travelFeeTierSchema],
    bookingMode: { type: String, enum: ['instant', 'request'], default: 'instant' },
    icsFeedToken: { type: String },
    depositPolicy: { type: String, maxlength: 1000 },
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
