/**
 * backfill-email-verified — one-off grandfathering migration for the
 * Email-Verification-Signup gate (task 9.1).
 *
 * -------------------------------------------------------------------------
 * WHAT & WHY
 * -------------------------------------------------------------------------
 * This feature makes a non-null `User.emailVerifiedAt` the account-activation
 * gate: an authenticated user whose `emailVerifiedAt` is null is held at the
 * verification-pending screen and cannot start a trial. Without a grandfather
 * step, deploying the gate would lock out every pre-existing active user whose
 * row predates the feature (their `emailVerifiedAt` is null). This script is
 * the chosen grandfathering mechanism (design §9), run once at deploy time —
 * it is NOT wired into any runtime path.
 *
 * For every active `User` (`isActive: true`) whose `emailVerifiedAt` is
 * null/absent, it sets `emailVerifiedAt = createdAt` via an aggregation-pipeline
 * update so each grandfathered user is stamped verified as of their own account
 * creation instant (R8.1, R8.2, R8.3). A second defensive pass stamps
 * `new Date()` for any matched row that still has a null `emailVerifiedAt` after
 * the pipeline (e.g. a legacy row missing `createdAt`), honoring the design's
 * "fallback to new Date()" note.
 *
 * Users who already have a non-null `emailVerifiedAt` are never matched by the
 * filter and are left unchanged (R8.4). Users created after deploy start with
 * `emailVerifiedAt: null` and are not grandfathered — they must verify through
 * the email-verification link flow (R8.5).
 *
 * IDEMPOTENT: it only matches active rows still missing `emailVerifiedAt`, so
 * re-running after a successful pass updates nothing (logs a count of 0).
 *
 * -------------------------------------------------------------------------
 * HOW TO RUN
 * -------------------------------------------------------------------------
 *   npm run backfill:email-verified
 *   # or directly:
 *   npx tsx scripts/backfill-email-verified.ts
 *   # preview without writing:
 *   npx tsx scripts/backfill-email-verified.ts --dry-run
 *
 * Requires `MONGODB_URI` in the environment (same connection the app uses).
 */
import type { FilterQuery } from 'mongoose';
import { connectDB } from '@/lib/db/connect';
import { User, type IUser } from '@/lib/db/models/user';

/**
 * Backfill `emailVerifiedAt` for existing active `User` rows that predate the
 * email-verification gate, grandfathering them so the deploy does not lock
 * anyone out.
 *
 * @param options.dryRun When true, report the would-be count without writing.
 * @returns A summary of how many rows matched and how many were updated.
 */
export async function backfillEmailVerified(
  options: { dryRun?: boolean } = {}
): Promise<{ matched: number; updated: number }> {
  const { dryRun = false } = options;

  await connectDB();

  // Rows that still need stamping: active AND `emailVerifiedAt` null/absent.
  // This filter is what makes the script idempotent (and preserves R8.4) —
  // once a row has a non-null `emailVerifiedAt` it never matches again.
  const filter: FilterQuery<IUser> = {
    isActive: true,
    $or: [{ emailVerifiedAt: null }, { emailVerifiedAt: { $exists: false } }],
  };

  const matched = await User.countDocuments(filter);

  if (dryRun) {
    console.log(
      `[backfill-email-verified] DRY RUN — ${matched} user(s) would be backfilled.`
    );
    return { matched, updated: 0 };
  }

  if (matched === 0) {
    console.log(
      '[backfill-email-verified] Nothing to do — no active users missing emailVerifiedAt.'
    );
    return { matched: 0, updated: 0 };
  }

  // Primary pass: aggregation-pipeline update so `emailVerifiedAt` is set to
  // each user's own `createdAt` instant (mongoose 8 supports pipeline updates).
  const result = await User.updateMany(filter, [
    { $set: { emailVerifiedAt: '$createdAt' } },
  ]);

  // Defensive fallback: any row still null after the pipeline (e.g. a legacy
  // row with no `createdAt`) is stamped with the current time so no matched
  // user is left unverified. Normally matches nothing.
  const fallback = await User.updateMany(
    { isActive: true, $or: [{ emailVerifiedAt: null }, { emailVerifiedAt: { $exists: false } }] },
    { $set: { emailVerifiedAt: new Date() } }
  );

  const updated = (result.modifiedCount ?? 0) + (fallback.modifiedCount ?? 0);

  console.log(
    `[backfill-email-verified] Backfilled ${updated} of ${matched} matched user(s)` +
      (fallback.modifiedCount
        ? ` (${fallback.modifiedCount} via new Date() fallback).`
        : '.')
  );
  return { matched, updated };
}

/**
 * CLI entry: run the backfill, then exit. Only executes when invoked directly
 * (not when imported), so the exported function stays reusable from tests/other
 * scripts.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  try {
    await backfillEmailVerified({ dryRun });
    process.exit(0);
  } catch (error) {
    console.error('[backfill-email-verified] Failed:', error);
    process.exit(1);
  }
}

// `import.meta.url` vs the invoked file: run main() only as a direct script.
// Guard with a try/catch-free check that works under tsx/node ESM.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /backfill-email-verified(\.ts|\.js)?$/.test(process.argv[1] ?? '');

if (invokedDirectly) {
  void main();
}
