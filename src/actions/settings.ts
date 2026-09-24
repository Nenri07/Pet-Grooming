'use server';

/**
 * Business settings server actions for the Groomer Portal.
 *
 * These run only on the server ('use server'). Every action authenticates the
 * caller via NextAuth and scopes each query to the authenticated groomer's
 * profile (`userId: session.user.id`) so one groomer can never read or mutate
 * another groomer's business settings.
 *
 *  - `getBusinessSettings` loads the current profile fields for the settings
 *    form (Requirement 15.1).
 *  - `updateBusinessSettings` validates the input with `settingsSchema` and
 *    BLOCKS persistence when any field is invalid, returning field errors
 *    instead of saving (Requirement 15.1 / 21.1). It persists to the
 *    GroomerProfile and best-effort revalidates the public booking page so
 *    changes propagate (Requirement 15.4). Crucially, the update itself
 *    succeeds regardless of downstream propagation timing — revalidation is
 *    wrapped so a slow/failed revalidate never fails the update (clarification
 *    15.4: the update completes even if propagation exceeds 5s).
 *  - `updateGroomerSlug` validates the slug FORMAT via `isValidSlugFormat`
 *    (Requirement 15.5), checks uniqueness case-insensitively against OTHER
 *    profiles (Requirement 15.6), persists the slug, and revalidates the public
 *    /book/{slug} route.
 *
 * All actions RETURN a typed result envelope rather than throwing, so the UI
 * can render inline field errors and surface conflicts/errors as toasts.
 *
 * _Requirements: 15.1, 15.4, 15.5, 15.6, 21.1_
 */
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { isValidSlugFormat } from '@/lib/validators/slug';
import { settingsSchema, type ServiceSettingsInput } from '@/lib/validators/settings';
import type { CoatCondition, EstimateRule } from '@/types';

// ---------------------------------------------------------------------------
// Shared shapes / result envelopes
// ---------------------------------------------------------------------------

/** A single estimate rule as returned to / submitted from the settings form. */
export interface SettingsEstimateRule {
  coatCondition?: CoatCondition;
  weightMin?: number;
  weightMax?: number;
  priceAdjustmentPercent: number;
  note?: string;
}

/** The serializable business-settings shape returned to the settings page. */
export interface BusinessSettingsData {
  businessName: string;
  phone: string;
  businessEmail: string;
  depositAmount: number;
  estimateRules: SettingsEstimateRule[];
  logoUrl: string;
  groomerSlug: string;
}

/** Result envelope returned by {@link getBusinessSettings}. */
export type GetBusinessSettingsResult =
  | { ok: true; settings: BusinessSettingsData }
  | { ok: false; error: string };

/**
 * Result envelope for {@link updateBusinessSettings}. On validation failure
 * `fieldErrors` carries per-field messages so the form can render them inline
 * without clearing valid values (Requirement 21.1).
 */
export type UpdateBusinessSettingsResult =
  | { ok: true; settings: BusinessSettingsData }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[]> };

/**
 * Result envelope for {@link updateGroomerSlug}. On a format failure or a
 * uniqueness conflict, `ok` is false and `error` carries a specific message
 * (Requirements 15.5 / 15.6).
 */
export type UpdateGroomerSlugResult =
  | { ok: true; groomerSlug: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside a RegExp so a slug containing regex
 * metacharacters can't alter the uniqueness query. (Valid slugs only contain
 * `[a-z0-9-]`, but we defend anyway since this runs before format is trusted.)
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Project a lean/hydrated profile document into the settings form shape. */
function toSettingsData(profile: {
  businessName?: string;
  phone?: string;
  businessEmail?: string;
  depositAmount: number;
  estimateRules?: EstimateRule[];
  logoUrl?: string;
  groomerSlug?: string;
}): BusinessSettingsData {
  return {
    businessName: profile.businessName ?? '',
    phone: profile.phone ?? '',
    businessEmail: profile.businessEmail ?? '',
    depositAmount: profile.depositAmount,
    estimateRules: (profile.estimateRules ?? []).map((rule) => ({
      coatCondition: rule.coatCondition,
      weightMin: rule.weightRange?.min,
      weightMax: rule.weightRange?.max,
      priceAdjustmentPercent: rule.priceAdjustmentPercent,
      note: rule.note ?? '',
    })),
    logoUrl: profile.logoUrl ?? '',
    groomerSlug: profile.groomerSlug ?? '',
  };
}

/**
 * Best-effort revalidation of the public booking page after a settings change.
 * Wrapped so a slow or failing revalidate NEVER fails the settings update
 * (clarification 15.4 — the update completes regardless of propagation timing).
 */
function revalidatePublicBooking(groomerSlug?: string): void {
  if (!groomerSlug) return;
  try {
    revalidatePath(`/book/${groomerSlug}`);
  } catch {
    // Revalidation is best-effort; propagation timing must not fail the update.
  }
}

/**
 * Normalize a validated estimate rule (form shape) into the persisted
 * {@link EstimateRule} shape. Empty coat/note/weight values collapse to
 * `undefined` so the DB doesn't store empty strings or partial weight ranges.
 */
function toPersistedRule(rule: {
  coatCondition?: CoatCondition | '';
  weightMin?: number | '';
  weightMax?: number | '';
  priceAdjustmentPercent: number;
  note?: string;
}): EstimateRule {
  const min = typeof rule.weightMin === 'number' ? rule.weightMin : undefined;
  const max = typeof rule.weightMax === 'number' ? rule.weightMax : undefined;
  const hasRange = min !== undefined || max !== undefined;

  return {
    coatCondition: rule.coatCondition ? rule.coatCondition : undefined,
    weightRange: hasRange ? { min, max } : undefined,
    priceAdjustmentPercent: rule.priceAdjustmentPercent,
    note: rule.note ? rule.note : undefined,
  };
}

// ---------------------------------------------------------------------------
// getBusinessSettings
// ---------------------------------------------------------------------------

/**
 * Load the authenticated groomer's business settings for the settings page
 * (Requirement 15.1).
 */
export async function getBusinessSettings(): Promise<GetBusinessSettingsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view settings.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select(
        'businessName phone businessEmail depositAmount estimateRules logoUrl groomerSlug'
      )
      .lean();

    if (!profile) {
      return { ok: false, error: 'Business profile not found.' };
    }

    return { ok: true, settings: toSettingsData(profile) };
  } catch (error) {
    console.error('getBusinessSettings failed:', error);
    return {
      ok: false,
      error: "We couldn't load your settings right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// updateBusinessSettings
// ---------------------------------------------------------------------------

/**
 * Validate and persist the authenticated groomer's business settings.
 *
 * On invalid input the action returns `{ ok: false, fieldErrors }` and persists
 * nothing (Requirement 15.1 / 21.1). On success it persists the profile and
 * best-effort revalidates the public booking page. The update completes
 * regardless of propagation timing to the public page (clarification 15.4).
 *
 * The groomer slug is intentionally NOT handled here — see
 * {@link updateGroomerSlug} (Requirements 15.5 / 15.6).
 */
export async function updateBusinessSettings(
  input: ServiceSettingsInput
): Promise<UpdateBusinessSettingsResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to update settings.' };
  }

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;

  try {
    await connectDB();

    const updated = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      {
        $set: {
          businessName: data.businessName,
          phone: data.phone ? data.phone : undefined,
          businessEmail: data.businessEmail ? data.businessEmail : undefined,
          depositAmount: data.depositAmount,
          estimateRules: data.estimateRules.map(toPersistedRule),
          logoUrl: data.logoUrl ? data.logoUrl : undefined,
        },
      },
      { new: true }
    )
      .select(
        'businessName phone businessEmail depositAmount estimateRules logoUrl groomerSlug'
      )
      .lean();

    if (!updated) {
      return { ok: false, error: 'Business profile not found.' };
    }

    // Propagate to the public booking page (best-effort; never fails the
    // update — clarification 15.4).
    revalidatePublicBooking(updated.groomerSlug);

    return { ok: true, settings: toSettingsData(updated) };
  } catch (error) {
    console.error('updateBusinessSettings failed:', error);
    return {
      ok: false,
      error: "We couldn't save your settings right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// updateGroomerSlug
// ---------------------------------------------------------------------------

/**
 * Validate and persist the authenticated groomer's public booking slug.
 *
 * Flow:
 *  1. Format check via `isValidSlugFormat` — on failure return a specific
 *     message (Requirement 15.5).
 *  2. Uniqueness check, case-insensitively, against OTHER groomer profiles
 *     (excluding the caller's own profile). If taken, return the
 *     "already taken" conflict WITHOUT persisting (Requirement 15.6).
 *  3. Persist the (lowercased) slug and revalidate the public /book/{slug}.
 */
export async function updateGroomerSlug(
  slug: string
): Promise<UpdateGroomerSlugResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to update your booking link.' };
  }

  const normalized = slug.trim().toLowerCase();

  // 1. Format (Requirement 15.5).
  if (!isValidSlugFormat(normalized)) {
    return {
      ok: false,
      error:
        'Your booking link must be 3–40 characters and use only lowercase letters, numbers, and hyphens.',
    };
  }

  try {
    await connectDB();

    // 2. Uniqueness against OTHER profiles, case-insensitively (Requirement 15.6).
    const conflict = await GroomerProfile.findOne({
      userId: { $ne: session.user.id },
      groomerSlug: { $regex: `^${escapeRegExp(normalized)}$`, $options: 'i' },
    })
      .select('_id')
      .lean();

    if (conflict) {
      return { ok: false, error: 'That booking link is already taken.' };
    }

    // 3. Persist.
    const updated = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      { $set: { groomerSlug: normalized } },
      { new: true }
    )
      .select('groomerSlug')
      .lean();

    if (!updated) {
      return { ok: false, error: 'Business profile not found.' };
    }

    revalidatePublicBooking(updated.groomerSlug);

    return { ok: true, groomerSlug: updated.groomerSlug ?? normalized };
  } catch (error) {
    // A duplicate-key error from the unique index is a uniqueness conflict
    // that can race past the pre-check; surface it as the same "taken" message
    // (Requirement 15.6) rather than a generic failure.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      return { ok: false, error: 'That booking link is already taken.' };
    }
    console.error('updateGroomerSlug failed:', error);
    return {
      ok: false,
      error: "We couldn't update your booking link right now. Please try again.",
    };
  }
}
