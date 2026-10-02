/**
 * backfill-trial-deadline — one-off migration for Billing/Trial (task 5.3).
 *
 * -------------------------------------------------------------------------
 * WHAT & WHY
 * -------------------------------------------------------------------------
 * Phase 1 added the stored `trialDeadline` / `trialStartedAt` fields to the
 * Subscription model (task 1.2). The READ paths already fail-open for legacy
 * rows that predate those fields: both `subscriptionToAccessInput`
 * (`src/lib/billing/access.ts`) and the NextAuth `jwt` callback
 * (`src/lib/auth/config.ts`) evaluate access via `trialDeadline ?? trialEndsAt`,
 * so a legacy `trialing` row is NEVER wrongly locked out — it is judged against
 * its real `trialEndsAt` instant. This script is therefore NOT required for
 * correctness; it is an explicit convergence step so stored data carries the
 * new fields and future code can rely on `trialDeadline` directly without the
 * fallback.
 *
 * For every Subscription where `trialDeadline` is null/absent AND `trialEndsAt`
 * is set, it:
 *   - sets `trialDeadline = trialEndsAt` (same instant — the two must never
 *     drift, per the model contract), and
 *   - sets `trialStartedAt = trialEndsAt - TRIAL_DAYS` ONLY when `trialStartedAt`
 *     is absent (never overwrites an existing anchor).
 *
 * IDEMPOTENT: it only matches rows still missing `trialDeadline`, so re-running
 * after a successful pass updates nothing (logs a count of 0).
 *
 * SAFE READ PATH: a null `trialDeadline` is already handled fail-open by the
 * read layer (see above) and by the no-row fresh-trial default, so running or
 * NOT running this script never locks out a legitimate groomer.
 *
 * -------------------------------------------------------------------------
 * HOW TO RUN
 * -------------------------------------------------------------------------
 *   npm run backfill:trial-deadline
 *   # or directly:
 *   npx tsx scripts/backfill-trial-deadline.ts
 *   # preview without writing:
 *   npx tsx scripts/backfill-trial-deadline.ts --dry-run
 *
 * Requires `MONGODB_URI` in the environment (same connection the app uses).
 */
import type { FilterQuery } from 'mongoose';
import { connectDB } from '@/lib/db/connect';
import { Subscription, type ISubscription } from '@/lib/db/models/subscription';
import { TRIAL_DAYS } from '@/lib/billing/entitlements';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backfill `trialDeadline` (and, when absent, `trialStartedAt`) for existing
 * Subscription rows from the legacy `trialEndsAt` field.
 *
 * @param options.dryRun When true, report the would-be count without writing.
 * @returns A summary of how many rows matched and how many were updated.
 */
export async function backfillTrialDeadlines(
  options: { dryRun?: boolean } = {}
): Promise<{ matched: number; updated: number }> {
  const { dryRun = false } = options;

  await connectDB();

  // Rows that still need the stored deadline: `trialDeadline` null/absent AND
  // `trialEndsAt` present. This filter is what makes the script idempotent —
  // once a row has a `trialDeadline` it never matches again.
  const filter: FilterQuery<ISubscription> = {
    $and: [
      { $or: [{ trialDeadline: null }, { trialDeadline: { $exists: false } }] },
      { trialEndsAt: { $ne: null } },
      { trialEndsAt: { $exists: true } },
    ],
  };

  const matched = await Subscription.countDocuments(filter);

  if (dryRun) {
    console.log(
      `[backfill-trial-deadline] DRY RUN — ${matched} subscription(s) would be backfilled.`
    );
    return { matched, updated: 0 };
  }

  if (matched === 0) {
    console.log(
      '[backfill-trial-deadline] Nothing to do — no legacy rows missing trialDeadline.'
    );
    return { matched: 0, updated: 0 };
  }

  // Process in a cursor so a large collection doesn't load into memory at once.
  const cursor = Subscription.find(filter)
    .select('trialEndsAt trialStartedAt trialDeadline')
    .cursor();

  let updated = 0;
  for await (const doc of cursor) {
    const trialEndsAt = doc.trialEndsAt;
    if (!(trialEndsAt instanceof Date)) continue; // defensive: filter guarantees set

    const update: { trialDeadline: Date; trialStartedAt?: Date } = {
      // Same instant as the legacy field — the model requires they never drift.
      trialDeadline: trialEndsAt,
    };

    // Only derive the start anchor when it's missing; never clobber a real one.
    if (doc.trialStartedAt == null) {
      update.trialStartedAt = new Date(trialEndsAt.getTime() - TRIAL_DAYS * DAY_MS);
    }

    await Subscription.updateOne({ _id: doc._id }, { $set: update });
    updated += 1;
  }

  console.log(
    `[backfill-trial-deadline] Backfilled ${updated} of ${matched} matched subscription(s).`
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
    await backfillTrialDeadlines({ dryRun });
    process.exit(0);
  } catch (error) {
    console.error('[backfill-trial-deadline] Failed:', error);
    process.exit(1);
  }
}

// `import.meta.url` vs the invoked file: run main() only as a direct script.
// Guard with a try/catch-free check that works under tsx/node ESM.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /backfill-trial-deadline(\.ts|\.js)?$/.test(process.argv[1] ?? '');

if (invokedDirectly) {
  void main();
}
