/**
 * Subscription Mongoose model (Master Spec §13.2, §14).
 *
 * One row per groomer describing their PawPort plan, lifecycle status, trial /
 * billing-period boundaries, Stripe identifiers, SMS allowance + top-up
 * balance, and whether they are a founding member. Entitlements (§13.2) are
 * resolved FROM this row (see `lib/billing/entitlements.ts`) and cached in
 * Redis for 60s.
 *
 * Additive model — introducing it does not touch existing collections. A
 * groomer with NO subscription row is treated by the entitlements layer as
 * being on a fresh 14-day Pro trial (§13.2), so this row only needs to exist
 * once billing state actually changes.
 *
 * `groomerId` refs `User` and is the same id used everywhere else in the app
 * (`session.user.id` / `GroomerProfile.userId`).
 *
 * _Master Spec: §13.2, §14_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';
import type { PlanName } from '@/lib/plans';

/**
 * Subscription lifecycle status (Master Spec §13.2):
 *   trialing → active → past_due (7-day grace, everything works) →
 *   canceled/expired (read-only).
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';

export interface ISubscription {
  _id: Types.ObjectId;
  /** The groomer (User id). Unique — one subscription per groomer. */
  groomerId: Types.ObjectId;
  /** The billable plan name. `trial` maps to Pro capabilities (§13.1). */
  plan: PlanName;
  /** Lifecycle status (§13.2). */
  status: SubscriptionStatus;
  /** When the current trial ends (only meaningful while `trialing`). */
  trialEndsAt?: Date | null;
  /** End of the current paid period; also the grace-window anchor for past_due. */
  currentPeriodEnd?: Date | null;
  /** Stripe Customer id (cus_...). */
  stripeCustomerId?: string | null;
  /** Stripe Subscription id (sub_...). */
  stripeSubscriptionId?: string | null;
  /** Included monthly SMS allowance for this plan (§13.1). */
  smsIncluded: number;
  /** One-time top-up balance added via Checkout (§13.4). */
  smsTopupBalance: number;
  /** Whether this groomer is a lifetime-locked founding member (§13.2). */
  foundingMember: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PLAN_NAMES: PlanName[] = ['trial', 'solo', 'pro'];
const STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
];

const subscriptionSchema = new Schema<ISubscription>(
  {
    groomerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    plan: { type: String, enum: PLAN_NAMES, required: true, default: 'trial' },
    status: {
      type: String,
      enum: STATUSES,
      required: true,
      default: 'trialing',
    },
    trialEndsAt: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    smsIncluded: { type: Number, min: 0, default: 300 },
    smsTopupBalance: { type: Number, min: 0, default: 0 },
    foundingMember: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// `groomerId` (unique) index is created by the field-level `unique: true`.
// Look up subscriptions by Stripe ids from webhooks; sparse so many nulls are
// allowed without a unique collision.
subscriptionSchema.index({ stripeCustomerId: 1 }, { sparse: true });
subscriptionSchema.index({ stripeSubscriptionId: 1 }, { sparse: true });

export const Subscription: Model<ISubscription> =
  (models.Subscription as Model<ISubscription>) ||
  model<ISubscription>('Subscription', subscriptionSchema);
