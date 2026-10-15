/**
 * backfill-trial-subscription - one-off migration for PRE-FIX accounts.
 *
 * Accounts registered before the trial-persistence fix have a User +
 * GroomerProfile but NO Subscription row, so the entitlements layer fell
 * back to a 'now + 14 days' view that never expired. This script gives each
 * such active user a REAL trialing Subscription so their trial counts down
 * and expires like new signups.
 *
 * Deadline policy: trialDeadline = computeTrialDeadline(user.createdAt, tz)
 * - i.e. the trial is anchored to when they ACTUALLY signed up (not reset to
 * today). If that 14-day window has already elapsed, the row is created in a
 * state that reads as EXPIRED on the next entitlements resolve (correct -
 * their trial genuinely ran out).
 *
 * IDEMPOTENT: only users with NO Subscription row are matched, so re-running
 * after a successful pass updates nothing.
 *
 * HOW TO RUN (requires MONGODB_URI in the environment, same as the app):
 *   # preview how many would be backfilled, no writes:
 *   npx tsx scripts/backfill-trial-subscription.ts --dry-run
 *   # backfill ALL pre-fix active accounts:
 *   npx tsx scripts/backfill-trial-subscription.ts
 *   # backfill ONLY one account (your test account):
 *   npx tsx scripts/backfill-trial-subscription.ts --email=you@example.com
 */
import './_load-env';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Subscription } from '@/lib/db/models/subscription';
import { computeTrialDeadline } from '@/lib/billing/trial';
import { PLANS } from '@/lib/plans';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

export async function backfillTrialSubscriptions(
  options: { dryRun?: boolean; email?: string } = {}
): Promise<{ matched: number; created: number }> {
  const { dryRun = false, email } = options;
  await connectDB();

  // Candidate users: active, and (when --email given) that one address.
  const userFilter: Record<string, unknown> = { isActive: true };
  if (email) userFilter.email = email.trim().toLowerCase();

  const users = await User.find(userFilter)
    .select('_id email createdAt')
    .lean<Array<{ _id: unknown; email?: string; createdAt?: Date }>>();

  // Which of them already have a Subscription (skip those).
  const ids = users.map((u) => String(u._id));
  const existing = await Subscription.find({ groomerId: { $in: ids } })
    .select('groomerId')
    .lean<Array<{ groomerId: unknown }>>();
  const haveSub = new Set(existing.map((s) => String(s.groomerId)));

  const todo = users.filter((u) => !haveSub.has(String(u._id)));
  console.log(`[backfill-trial-subscription] ${users.length} active user(s) in scope; ${todo.length} missing a Subscription.`);

  if (dryRun) {
    for (const u of todo) console.log('  would create for:', u.email);
    return { matched: todo.length, created: 0 };
  }

  let created = 0;
  for (const u of todo) {
    const groomerId = String(u._id);
    const profile = await GroomerProfile.findOne({ userId: groomerId })
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    const tz = profile?.timezone || 'UTC';
    const startedAt = u.createdAt ? new Date(u.createdAt) : new Date();
    const trialDeadline = computeTrialDeadline(startedAt, tz);

    await Subscription.findOneAndUpdate(
      { groomerId },
      {
        $set: {
          plan: 'trial',
          status: 'trialing',
          trialStartedAt: startedAt,
          trialDeadline,
          trialEndsAt: trialDeadline,
          smsIncluded: PLANS.trial.sms,
        },
        $setOnInsert: { groomerId },
      },
      { upsert: true }
    );
    created++;
    const expired = Date.now() >= trialDeadline.getTime();
    console.log(`  created: ${u.email}  deadline=${trialDeadline.toISOString()}  ${expired ? '(ALREADY EXPIRED)' : '(active)'}`);
  }

  console.log(`[backfill-trial-subscription] Done. Created ${created} subscription(s).`);
  return { matched: todo.length, created };
}

async function main(): Promise<void> {
  try {
    await backfillTrialSubscriptions({ dryRun: hasFlag('dry-run'), email: arg('email') });
    process.exit(0);
  } catch (e) {
    console.error('[backfill-trial-subscription] Failed:', e);
    process.exit(1);
  }
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /backfill-trial-subscription(\.ts|\.js)?$/.test(process.argv[1] ?? '');
if (invokedDirectly) { void main(); }
