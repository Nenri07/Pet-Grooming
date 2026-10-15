/**
 * set-password - TEST UTILITY to (re)set a user's password by email.
 *
 * For local testing when you forget a test account's password. Hashes the
 * new password with bcrypt (same cost as registration) and writes it to the
 * User. Also clears any lockout counters so you can log in immediately.
 *
 * HOW TO RUN (uses MONGODB_URI / MONGODB_URI_DIRECT like the other scripts):
 *   npx tsx scripts/set-password.ts --email=test@test.com --password=Test@12345
 */
import './_load-env';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';

const BCRYPT_SALT_ROUNDS = 12;

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}

async function main(): Promise<void> {
  const email = (arg('email') || '').trim().toLowerCase();
  const password = arg('password') || '';
  if (!email || !password) {
    console.error('Usage: --email=<addr> --password=<newPassword>');
    process.exit(1);
  }
  await connectDB();
  const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const res = await User.updateOne(
    { email },
    { $set: { passwordHash: hash, failedLoginAttempts: 0, lockedUntil: null } }
  );
  if (res.matchedCount === 0) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  console.log(`Password reset for ${email}. You can now log in with the new password.`);
  process.exit(0);
}

main().catch((e) => { console.error('set-password failed:', e); process.exit(1); });
