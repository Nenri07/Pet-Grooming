/**
 * verify-user - TEST UTILITY to mark a user's email as verified and activate
 * the account, so you can reach the portal during local testing without
 * clicking the emailed verification link.
 *
 * Sets User.emailVerifiedAt = now and isActive = true for the given email.
 *
 * HOW TO RUN (uses MONGODB_URI / MONGODB_URI_DIRECT like the other scripts):
 *   npx tsx scripts/verify-user.ts --email=umarbashir2002@gmail.com
 */
import './_load-env';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}

async function main(): Promise<void> {
  const email = (arg('email') || '').trim().toLowerCase();
  if (!email) { console.error('Usage: --email=<addr>'); process.exit(1); }
  await connectDB();
  const res = await User.updateOne(
    { email },
    { $set: { emailVerifiedAt: new Date(), isActive: true } }
  );
  if (res.matchedCount === 0) { console.error(`No user found for ${email}`); process.exit(1); }
  console.log(`Marked ${email} as email-verified + active. Log out/in to refresh the session, then open the portal.`);
  process.exit(0);
}

main().catch((e) => { console.error('verify-user failed:', e); process.exit(1); });
