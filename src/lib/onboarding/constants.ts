/**
 * Onboarding wizard constants.
 *
 * This is a plain (non-'use server') module so runtime values like
 * {@link ONBOARDING_TOTAL_STEPS} can be exported and shared by both server
 * actions and client components. A 'use server' file may only export async
 * functions, so this constant lives here rather than in
 * `src/actions/onboarding.ts`.
 */

/** Total number of steps in the onboarding wizard (Requirement 2.1). */
export const ONBOARDING_TOTAL_STEPS = 5;
