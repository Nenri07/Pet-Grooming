'use server';

/**
 * Booking flow server actions.
 *
 * These run only on the server ('use server'). The `computeEstimate` action
 * backs Step 3 of the public booking flow: it loads the groomer's estimate
 * rules and a service base price, then delegates to the pure
 * {@link calculateEstimate} engine.
 *
 * Design decisions:
 *  - The action RETURNS a typed result envelope rather than throwing, so the
 *    UI can distinguish "here is your estimate" from "we couldn't compute one"
 *    and block advancing accordingly (Requirement 5.4 / 5.5).
 *  - If required pet data is missing, or there is no base price to work from
 *    AND the groomer has no estimate rules, the action returns an error result
 *    so the UI shows a message and disables the Confirm button (Requirement 5.4).
 *
 * _Requirements: 5.1, 5.3, 5.4, 5.5_
 */
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Service } from '@/lib/db/models/service';
import { calculateEstimate } from '@/lib/estimate/engine';
import type { CoatCondition, EstimateResult } from '@/types';

/** The set of valid coat conditions the estimate engine understands. */
const COAT_CONDITIONS: readonly CoatCondition[] = [
  'smooth',
  'double',
  'wire',
  'curly',
  'long',
  'matted',
];

/** Input accepted by {@link computeEstimate}. */
export interface ComputeEstimateInput {
  /** The groomer's public booking slug. */
  groomerSlug: string;
  /** The pet's weight (must be a positive finite number). */
  petWeight?: number | null;
  /** The pet's coat condition (one of the six defined types). */
  coatCondition?: CoatCondition | null;
  /**
   * The base price of the service the client is booking. When omitted, the
   * groomer's first active service base price is used as a fallback.
   */
  serviceBasePrice?: number | null;
}

/**
 * Result envelope returned by {@link computeEstimate}.
 *
 * - On success: `ok` is true and `estimate` holds the computed range.
 * - On failure: `ok` is false and `error` holds a user-facing message. The UI
 *   renders the message and prevents advancing to step 4 (Requirement 5.4/5.5).
 */
export type ComputeEstimateResult =
  | { ok: true; estimate: EstimateResult }
  | { ok: false; error: string };

/** Whether a value is a usable positive, finite price/weight. */
function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Compute the instant price-range estimate for Step 3 of the booking flow.
 *
 * Loads the groomer profile (by slug) for its estimate rules and resolves a
 * base price: the caller-supplied `serviceBasePrice` when valid, otherwise the
 * groomer's first active service base price. Delegates the math to the pure
 * estimate engine.
 *
 * Returns an error result (rather than throwing) when the estimate cannot be
 * computed, so the UI can show the reason and block advancing (Requirement 5.4).
 */
export async function computeEstimate(
  input: ComputeEstimateInput
): Promise<ComputeEstimateResult> {
  const { groomerSlug, petWeight, coatCondition } = input;

  // 1. Validate the pet data needed for a calculation (Requirement 5.4).
  if (!isPositiveFinite(petWeight)) {
    return {
      ok: false,
      error: "We couldn't calculate an estimate because your pet's weight is missing.",
    };
  }
  if (!coatCondition || !COAT_CONDITIONS.includes(coatCondition)) {
    return {
      ok: false,
      error:
        "We couldn't calculate an estimate because your pet's coat condition is missing.",
    };
  }

  try {
    await connectDB();

    // 2. Load the groomer profile for estimate rules and to resolve a base price.
    const profile = await GroomerProfile.findOne({ groomerSlug })
      .select('userId estimateRules')
      .lean();

    if (!profile) {
      return {
        ok: false,
        error: "We couldn't calculate an estimate because this groomer is unavailable.",
      };
    }

    const estimateRules = Array.isArray(profile.estimateRules)
      ? profile.estimateRules
      : [];

    // 3. Resolve the service base price: use the supplied value when valid,
    //    otherwise fall back to the groomer's first active service.
    let serviceBasePrice = isPositiveFinite(input.serviceBasePrice)
      ? input.serviceBasePrice
      : undefined;

    if (serviceBasePrice === undefined) {
      const service = await Service.findOne({
        groomerId: profile.userId,
        isActive: true,
      })
        .select('basePrice')
        .sort({ createdAt: 1 })
        .lean();

      if (service && isPositiveFinite(service.basePrice)) {
        serviceBasePrice = service.basePrice;
      }
    }

    // 4. Without any base price AND no estimate rules there is nothing to work
    //    from, so we cannot produce a meaningful estimate (Requirement 5.4).
    if (serviceBasePrice === undefined && estimateRules.length === 0) {
      return {
        ok: false,
        error:
          "We couldn't calculate an estimate because this groomer hasn't configured pricing yet. Please contact them directly.",
      };
    }

    // If rules exist but no base price could be resolved, we still need a base
    // to apply percentage adjustments against — treat that as uncomputable too.
    if (serviceBasePrice === undefined) {
      return {
        ok: false,
        error:
          "We couldn't calculate an estimate because this groomer hasn't configured pricing yet. Please contact them directly.",
      };
    }

    // 5. Delegate to the pure estimate engine.
    const estimate = calculateEstimate({
      petWeight,
      coatCondition,
      serviceBasePrice,
      estimateRules,
    });

    return { ok: true, estimate };
  } catch (error) {
    console.error('computeEstimate failed:', error);
    return {
      ok: false,
      error: "We couldn't calculate an estimate right now. Please try again.",
    };
  }
}

// NOTE: The legacy `reserveSelectedSlot` action (Mongo-backed tentative hold)
// has been removed. Tentative holds are now Redis-backed via
// `POST /api/booking/hold` (Master Spec §9.4). The old
// `lib/calendar/reservation.ts` primitive is retained only for its property
// test and is no longer wired into the booking flow.
