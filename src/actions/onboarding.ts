'use server';

/**
 * Onboarding wizard server actions.
 *
 * These run only on the server ('use server'). Every action authenticates the
 * caller via NextAuth and scopes each query to the authenticated groomer
 * (`userId: session.user.id`) so one groomer can never read or mutate another
 * groomer's onboarding state.
 *
 *  - `getOnboardingState` returns the groomer's current `onboardingStep` and
 *    whether onboarding is `complete`, so the wizard can resume from the last
 *    incomplete step on the next login (Requirement 2.2 / 2.5).
 *  - `saveOnboardingStep` persists the highest step the groomer has completed
 *    onto the GroomerProfile so an abandoned wizard resumes correctly. The
 *    stored step never moves backwards (a resume + re-save of an earlier step
 *    must not lose later progress) (Requirement 2.2 / 2.5).
 *  - `completeOnboarding` marks the profile as complete (`onboardingComplete`)
 *    and flips the User's `isActive` flag to true so the account is fully
 *    provisioned, after which the wizard redirects to the dashboard
 *    (Requirement 2.3).
 *
 * All actions RETURN a typed result envelope rather than throwing, so the UI
 * can surface errors as toasts and decide when to advance / redirect.
 *
 * _Requirements: 2.2, 2.3, 2.5_
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/constants';

/** The serializable onboarding state returned to the wizard. */
export interface OnboardingState {
  /** The last completed step index (0-based). 0 means "nothing completed yet". */
  step: number;
  /** Whether the groomer has finished the entire wizard. */
  complete: boolean;
}

/** Result envelope returned by {@link getOnboardingState}. */
export type GetOnboardingStateResult =
  | { ok: true; state: OnboardingState }
  | { ok: false; error: string };

/** Result envelope returned by {@link saveOnboardingStep}. */
export type SaveOnboardingStepResult =
  | { ok: true; step: number }
  | { ok: false; error: string };

/** Result envelope returned by {@link completeOnboarding}. */
export type CompleteOnboardingResult =
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// getOnboardingState
// ---------------------------------------------------------------------------

/**
 * Load the authenticated groomer's onboarding progress so the wizard can
 * resume from the last incomplete step (Requirement 2.5). Returns a zeroed
 * state when the profile has no progress recorded yet.
 */
export async function getOnboardingState(): Promise<GetOnboardingStateResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to continue onboarding.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('onboardingStep onboardingComplete')
      .lean();

    if (!profile) {
      return { ok: false, error: 'Business profile not found.' };
    }

    return {
      ok: true,
      state: {
        step: profile.onboardingStep ?? 0,
        complete: profile.onboardingComplete ?? false,
      },
    };
  } catch (error) {
    console.error('getOnboardingState failed:', error);
    return {
      ok: false,
      error: "We couldn't load your onboarding progress right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// saveOnboardingStep
// ---------------------------------------------------------------------------

/**
 * Persist the highest step the groomer has completed so an abandoned wizard
 * resumes at the last incomplete step on next login (Requirement 2.2 / 2.5).
 *
 * The stored `onboardingStep` only ever moves forward: if the groomer resumes
 * and re-saves an earlier step, we keep the previously recorded (higher) step
 * so later progress is never lost. `step` is clamped to
 * `[0, ONBOARDING_TOTAL_STEPS]`.
 */
export async function saveOnboardingStep(
  step: number
): Promise<SaveOnboardingStepResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to continue onboarding.' };
  }

  if (!Number.isInteger(step) || step < 0 || step > ONBOARDING_TOTAL_STEPS) {
    return { ok: false, error: 'Invalid onboarding step.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('onboardingStep')
      .lean();

    if (!profile) {
      return { ok: false, error: 'Business profile not found.' };
    }

    // Only advance the stored step; never regress on resume/re-save.
    const nextStep = Math.max(profile.onboardingStep ?? 0, step);

    const updated = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      { $set: { onboardingStep: nextStep } },
      { new: true }
    )
      .select('onboardingStep')
      .lean();

    if (!updated) {
      return { ok: false, error: 'Business profile not found.' };
    }

    return { ok: true, step: updated.onboardingStep ?? nextStep };
  } catch (error) {
    console.error('saveOnboardingStep failed:', error);
    return {
      ok: false,
      error: "We couldn't save your progress right now. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// completeOnboarding
// ---------------------------------------------------------------------------

/**
 * Mark onboarding complete: set `onboardingComplete = true` and
 * `onboardingStep = ONBOARDING_TOTAL_STEPS` on the GroomerProfile, and flip the
 * owning User's `isActive` flag to true so the account is fully provisioned
 * (Requirement 2.3). After this succeeds the wizard redirects to the dashboard.
 */
export async function completeOnboarding(): Promise<CompleteOnboardingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to finish onboarding.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      {
        $set: {
          onboardingComplete: true,
          onboardingStep: ONBOARDING_TOTAL_STEPS,
        },
      },
      { new: true }
    )
      .select('_id')
      .lean();

    if (!profile) {
      return { ok: false, error: 'Business profile not found.' };
    }

    // Activate the groomer's account (Requirement 2.3).
    await User.updateOne(
      { _id: session.user.id },
      { $set: { isActive: true } }
    );

    return { ok: true };
  } catch (error) {
    console.error('completeOnboarding failed:', error);
    return {
      ok: false,
      error: "We couldn't finish onboarding right now. Please try again.",
    };
  }
}
