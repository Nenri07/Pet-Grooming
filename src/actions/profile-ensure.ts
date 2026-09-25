'use server';

/**
 * Profile-provisioning safety net.
 *
 * `ensureGroomerProfile` guarantees the authenticated groomer has a paired
 * `GroomerProfile`. It exists as a defensive guard: normally a profile is
 * created at registration (`registerGroomer`) or at Google sign-in (the auth
 * `signIn`/`jwt` callbacks in `@/lib/auth/config`), but if a profile is somehow
 * missing — a partially-provisioned OAuth account, a transient DB error during
 * sign-in, or legacy data — every profile-scoped query would miss and the
 * groomer would be trapped bouncing to /onboarding with nothing to render.
 *
 * The onboarding page calls this before rendering the wizard so it never draws
 * against missing data (see `src/app/onboarding/page.tsx`).
 *
 * The upsert is idempotent: an existing profile is left untouched
 * (`$setOnInsert` only writes on insert), so calling this repeatedly is safe.
 *
 * _Requirements: 2.1, 2.2, 2.5_
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';

/** Result envelope for {@link ensureGroomerProfile}. */
export type EnsureGroomerProfileResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string };

/**
 * Ensure a `GroomerProfile` exists for the current session user.
 *
 * Returns `{ ok: true, created }` where `created` is true only when this call
 * inserted a new profile. Auth-scoped: the profile is keyed to
 * `session.user.id`, so a caller can only ever provision their own profile.
 */
export async function ensureGroomerProfile(): Promise<EnsureGroomerProfileResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to continue onboarding.' };
  }

  const userId = session.user.id;

  try {
    await connectDB();

    // Did a profile already exist before this upsert?
    const existing = await GroomerProfile.findOne({ userId }).select('_id').lean();

    if (existing) {
      return { ok: true, created: false };
    }

    // Idempotent upsert: only writes the seed fields on insert. A concurrent
    // upsert that wins the race is caught below and treated as "already there".
    await GroomerProfile.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: {
          userId,
          onboardingStep: 0,
          onboardingComplete: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return { ok: true, created: true };
  } catch (error) {
    // A concurrent insert can trip the unique `userId` index between our check
    // and the upsert; that just means the profile now exists, which is success.
    if (isDuplicateKeyError(error)) {
      return { ok: true, created: false };
    }
    console.error('ensureGroomerProfile failed:', error);
    return {
      ok: false,
      error: "We couldn't set up your business profile right now. Please try again.",
    };
  }
}

/** MongoDB duplicate-key error code (unique-index violation). */
const DUPLICATE_KEY_ERROR_CODE = 11000;

/** Narrow an unknown thrown value to a MongoDB duplicate-key error. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}
