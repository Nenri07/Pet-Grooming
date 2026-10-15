/**
 * age-trial - TEST UTILITY to simulate trial expiry.
 *
 * The trial deadline is a STORED instant on the Subscription row, so you
 * can test the expiry -> lockout/upgrade flow by moving it into the past
 * instead of waiting 14 real days. This script finds a user by email and
 * sets their trialDeadline + trialEndsAt to (now + <days>). Use a negative
 * number to make the trial already expired.
 *
 * HOW TO RUN (requires MONGODB_URI in the environment, same as the app):
 *   # show the user's current subscription:
 *   npx tsx scripts/age-trial.ts --email=you@example.com --show
 *   # make the trial expire in 1 day:
 *   npx tsx scripts/age-trial.ts --email=you@example.com --days=1
 *   # make the trial ALREADY expired (yesterday) -> should trigger lockout:
 *   npx tsx scripts/age-trial.ts --email=you@example.com --days=-1
 *
 * After running, reload /dashboard or /billing in the app: an expired trial
 * should lock the portal and show the 'Choose a plan' upgrade screen.
 */
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { Subscription } from '@/lib/db/models/subscription';

const DAY_MS = 24 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main(): Promise<void> {
  const email = (arg('email') || '').trim().toLowerCase();
  if (!email) {
    console.error('Missing --email=<address>');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email }).select('_id email').lean<{ _id: unknown; email?: string } | null>();
  if (!user?._id) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  const groomerId = String(user._id);

  const show = async () => {
    const sub: any = await Subscription.findOne({ groomerId }).lean();
    if (!sub) { console.log('Subscription: NONE (fallback trial — register persists one now)'); return; }
    console.log('Subscription:');
    console.log('  plan           =', sub.plan);
    console.log('  status         =', sub.status);
    console.log('  trialStartedAt =', sub.trialStartedAt ? new Date(sub.trialStartedAt).toISOString() : 'null');
    console.log('  trialEndsAt    =', sub.trialEndsAt ? new Date(sub.trialEndsAt).toISOString() : 'null');
    console.log('  trialDeadline  =', sub.trialDeadline ? new Date(sub.trialDeadline).toISOString() : 'null');
    const d = sub.trialDeadline ?? sub.trialEndsAt;
    if (d) console.log('  -> expired?    =', Date.now() >= new Date(d).getTime());
  };

  console.log(`\nUser: ${email} (${groomerId})`);
  console.log('--- BEFORE ---');
  await show();

  if (hasFlag('show')) { process.exit(0); }

  const daysRaw = arg('days');
  if (daysRaw === undefined) {
    console.log('\nNo --days given; nothing changed. Pass --days=-1 to expire, --days=7 to extend, or --show.');
    process.exit(0);
  }
  const days = Number(daysRaw);
  if (!Number.isFinite(days)) { console.error('--days must be a number'); process.exit(1); }

  const target = new Date(Date.now() + days * DAY_MS);
  const res = await Subscription.findOneAndUpdate(
    { groomerId },
    { $set: { plan: 'trial', status: 'trialing', trialDeadline: target, trialEndsAt: target }, $setOnInsert: { groomerId } },
    { upsert: true, new: true }
  );
  console.log(`\nSet trialDeadline + trialEndsAt to ${target.toISOString()} (now ${days >= 0 ? '+' : ''}${days}d).`);
  console.log('(Note: the app caches entitlements ~60s; wait a moment or hard-reload.)');
  console.log('--- AFTER ---');
  await show();
  void res;
  process.exit(0);
}

main().catch((e) => { console.error('age-trial failed:', e); process.exit(1); });
