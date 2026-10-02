/**
 * Edge-safe billing constants (Master Spec §13.1, §13.2).
 *
 * This module exists SOLELY to hold the handful of pure billing constants that
 * both the Edge runtime (route-protection middleware → `access.ts`) and the
 * Node runtime (`entitlements.ts`) need, WITHOUT dragging in any Mongoose /
 * Stripe / Redis code. The Next.js Edge runtime forbids the dynamic code
 * evaluation Mongoose performs, so anything `src/middleware.ts` transitively
 * imports MUST stay free of DB/ORM imports.
 *
 * It only imports the pure `PLANS` catalog from `@/lib/plans` (which touches
 * neither the DB, Stripe, nor Redis), so importing this module from the Edge
 * bundle is safe.
 *
 * `entitlements.ts` re-exports these so existing importers keep working, and
 * `access.ts` imports them from here directly (never from `entitlements.ts`).
 */
import { PLANS } from '@/lib/plans';

/** The 7-day grace window for `past_due` subscriptions (Master Spec §13.2). */
export const GRACE_PERIOD_DAYS = 7;

/**
 * Default trial length in days (Master Spec §13.1, §13.2). Mirrors
 * `PLANS.trial.days` from the pure plan catalog.
 */
export const TRIAL_DAYS = PLANS.trial.days;
