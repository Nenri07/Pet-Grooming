/**
 * backfill-connect-status — one-off migration for Billing/Connect (task 14.3).
 *
 * -------------------------------------------------------------------------
 * WHAT & WHY
 * -------------------------------------------------------------------------
 * Phase 3 added the richer `connectStatus` enum to the GroomerProfile model
 * (task 13.1) alongside the legacy `stripeConnectChargesEnabled` boolean. The
 * READ paths already fail-safe for legacy rows that predate the enum: the
 * deposit gate's `effectiveConnectStatus` (`src/lib/stripe/helpers.ts`) prefers
 * the stored `connectStatus` when present and otherwise falls back to a COARSE
 * status derived from the boolean (`true` → treat as `complete`, else
 * `not_started`). A legacy profile is therefore NEVER wrongly allowed to take
 * deposits, and a complete one is never wrongly blocked. This script is thus
 * NOT required for correctness; it is an explicit data-convergence step so
 * stored rows carry the enum and future code can read `connectStatus` directly
 * without the fallback.
 *
 * For every GroomerProfile where `connectStatus` is null/absent, it sets:
 *   connectStatus = stripeConnectChargesEnabled === true ? 'complete'
 *                                                        : 'not_started'
 *
 * This exactly mirrors the read-side fallback and the model contract that
 * `connectStatus === 'complete'` iff charges are enabled (R15.4). Note a
 * groomer mid-onboarding whose boolean is still false converges to
 * 'not_started' here; that is intentional and self-healing — the next real
 * signal (the `account.updated` webhook / `refreshConnectStatus`) promotes it
 * to the accurate pending/needs_info/complete/disabled state, mapping Stripe's
 * `charges_enabled`/`details_submitted`/`requirements` into the enum.
 *
 * IDEMPOTENT: it only matches rows still missing `connectStatus`, so re-running
 * after a successful pass updates nothing (logs a count of 0).
 *
 * SAFE READ PATH: a null `connectStatus` is already handled by the read-side
 * fallback (see above), so running or NOT running this script never changes the
 * gate decision for a legacy profile.
 *
 * -------------------------------------------------------------------------
 * HOW TO RUN
 * -------------------------------------------------------------------------
 *   npm run backfill:connect-status
 *   # or directly:
 *   npx tsx scripts/backfill-connect-status.ts
 *   # preview without writing:
 *   npx tsx scripts/backfill-connect-status.ts --dry-run
 *
 * Requires `MONGODB_URI` in the environment (same connection the app uses).
 */
import type { FilterQuery } from 'mongoose';
import { connectDB } from '@/lib/db/connect';
import {
  GroomerProfile,
  type IGroomerProfile,
  type ConnectStatus,
} from '@/lib/db/models/groomer-profile';

/**
 * Backfill `connectStatus` for existing GroomerProfile rows from the legacy
 * `stripeConnectChargesEnabled` boolean.
 *
 * @param options.dryRun When true, report the would-be count without writing.
 * @returns A summary of how many rows matched and how many were updated.
 */
export async function backfillConnectStatus(
  options: { dryRun?: boolean } = {}
): Promise<{ matched: number; updated: number }> {
  const { dryRun = false } = options;

  await connectDB();

  // Rows that still need the stored enum: `connectStatus` null/absent. This
  // filter is what makes the script idempotent — once a row has a
  // `connectStatus` it never matches again.
  const filter: FilterQuery<IGroomerProfile> = {
    $or: [{ connectStatus: null }, { connectStatus: { $exists: false } }],
  };

  const matched = await GroomerProfile.countDocuments(filter);

  if (dryRun) {
    console.log(
      `[backfill-connect-status] DRY RUN — ${matched} profile(s) would be backfilled.`
    );
    return { matched, updated: 0 };
  }

  if (matched === 0) {
    console.log(
      '[backfill-connect-status] Nothing to do — no legacy rows missing connectStatus.'
    );
    return { matched: 0, updated: 0 };
  }

  // Process in a cursor so a large collection doesn't load into memory at once.
  const cursor = GroomerProfile.find(filter)
    .select('stripeConnectChargesEnabled connectStatus')
    .cursor();

  let updated = 0;
  for await (const doc of cursor) {
    // Mirror the read-side fallback and the model contract: 'complete' iff
    // charges are enabled, otherwise the default 'not_started'.
    const connectStatus: ConnectStatus =
      doc.stripeConnectChargesEnabled === true ? 'complete' : 'not_started';

    await GroomerProfile.updateOne({ _id: doc._id }, { $set: { connectStatus } });
    updated += 1;
  }

  console.log(
    `[backfill-connect-status] Backfilled ${updated} of ${matched} matched profile(s).`
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
    await backfillConnectStatus({ dryRun });
    process.exit(0);
  } catch (error) {
    console.error('[backfill-connect-status] Failed:', error);
    process.exit(1);
  }
}

// `import.meta.url` vs the invoked file: run main() only as a direct script.
// Guard with a try/catch-free check that works under tsx/node ESM.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /backfill-connect-status(\.ts|\.js)?$/.test(process.argv[1] ?? '');

if (invokedDirectly) {
  void main();
}
