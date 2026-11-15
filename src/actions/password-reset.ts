'use server';

/**
 * Password-reset server actions.
 *
 *   requestPasswordReset({ email })        -> emails a one-time link
 *   confirmPasswordReset({ token, password }) -> sets the new password
 *
 * Design notes:
 *  - Token storage mirrors the email-verification flow: a random token lives in
 *    Redis with a TTL. Only its SHA-256 is used as the key, so reading Redis
 *    never yields a usable link.
 *  - The token is consumed with an atomic GETDEL, so a link works exactly once
 *    even if two requests race.
 *  - `requestPasswordReset` answers identically whether or not the email has an
 *    account, so it cannot be used to discover who is registered.
 *  - The link host comes from env (NEXT_PUBLIC_APP_URL), never from request
 *    headers, which an attacker could forge to poison the emailed link.
 *  - Both actions are rate limited per IP; requests also have a per-email
 *    cooldown. They never throw: every path returns an `{ ok }` envelope.
 *  - A successful reset clears failed-login counters and any lockout. Existing
 *    JWT sessions are not revoked (sessions are stateless in this app).
 */
import { headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { sendPasswordResetEmail } from '@/lib/email/send';
import { authRateLimit, checkRateLimit } from '@/lib/ratelimit';
import { TTL, cacheSet, getRedis, isRedisConfigured, keys } from '@/lib/redis';
import { passwordSchema } from '@/lib/validators/auth';
import {
  MSG_RESET_BUSY,
  MSG_RESET_DONE,
  MSG_RESET_INVALID_LINK,
  MSG_RESET_REQUESTED,
  MSG_RESET_UNEXPECTED,
  buildResetLink,
  hashResetToken,
  isWellFormedResetToken,
  newResetToken,
} from '@/lib/password-reset';

const BCRYPT_SALT_ROUNDS = 12;
const MSG_UNAVAILABLE = "Password reset isn't available right now. Please try again later.";

export type PasswordResetResult = { ok: true; message: string } | { ok: false; message: string };

interface ResetRecord {
  userId: string;
}

const emailSchema = z.string().trim().toLowerCase().max(254).email();

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const first = h.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (first) return first;
    return h.get('x-real-ip')?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function requestPasswordReset(input: { email: string }): Promise<PasswordResetResult> {
  try {
    const parsed = emailSchema.safeParse(input?.email);
    if (!parsed.success) return { ok: false, message: 'Enter a valid email address.' };
    const email = parsed.data;

    const limit = await checkRateLimit(authRateLimit(), `pwreset:request:${await clientIp()}`);
    if (!limit.success) return { ok: false, message: MSG_RESET_BUSY };

    // Tokens live in Redis, so without it we cannot offer a reset at all.
    if (!isRedisConfigured()) return { ok: false, message: MSG_UNAVAILABLE };

    // One email per address per cooldown window. A repeat inside the window gets
    // the same success message, so the response never depends on prior requests.
    const claimed = await getRedis().set(keys.passwordResetCooldown(email), '1', {
      nx: true,
      ex: TTL.PASSWORD_RESET_COOLDOWN,
    });
    if (claimed !== 'OK') return { ok: true, message: MSG_RESET_REQUESTED };

    await connectDB();
    const user = await User.findOne({ email }).select('_id email passwordHash').lean();

    // Google-only accounts have no password to reset; stay silent for them too.
    if (user?.passwordHash) {
      const token = newResetToken();
      const record: ResetRecord = { userId: String(user._id) };
      await cacheSet(keys.passwordReset(hashResetToken(token)), record, TTL.PASSWORD_RESET);

      const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const sent = await sendPasswordResetEmail(user.email, buildResetLink(base, token));

      // Local convenience only: when email delivery isn't configured, print the
      // link to the server console so the flow can be tested. Never in production.
      if (!sent && process.env.NODE_ENV !== 'production') {
        const devBase = process.env.NEXTAUTH_URL || base;
        console.warn(`[password-reset] email not delivered; dev link: ${buildResetLink(devBase, token)}`);
      }
    }

    return { ok: true, message: MSG_RESET_REQUESTED };
  } catch (err) {
    console.error('[password-reset] request failed:', err);
    return { ok: false, message: MSG_RESET_UNEXPECTED };
  }
}

export async function confirmPasswordReset(input: {
  token: string;
  password: string;
}): Promise<PasswordResetResult> {
  try {
    if (!isWellFormedResetToken(input?.token)) return { ok: false, message: MSG_RESET_INVALID_LINK };

    // Validate the password BEFORE consuming the token, so a typo doesn't burn the link.
    const pw = passwordSchema.safeParse(input.password);
    if (!pw.success) {
      return { ok: false, message: pw.error.issues[0]?.message ?? 'Choose a stronger password.' };
    }

    const limit = await checkRateLimit(authRateLimit(), `pwreset:confirm:${await clientIp()}`);
    if (!limit.success) return { ok: false, message: MSG_RESET_BUSY };

    if (!isRedisConfigured()) return { ok: false, message: MSG_UNAVAILABLE };

    // Atomic read + delete: the link can be used exactly once.
    const raw = await getRedis().getdel<ResetRecord | string | null>(
      keys.passwordReset(hashResetToken(input.token))
    );
    if (raw == null) return { ok: false, message: MSG_RESET_INVALID_LINK };
    const record: ResetRecord = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!record?.userId) return { ok: false, message: MSG_RESET_INVALID_LINK };

    await connectDB();
    const passwordHash = await bcrypt.hash(pw.data, BCRYPT_SALT_ROUNDS);
    const res = await User.updateOne(
      { _id: record.userId },
      { $set: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }
    );
    if (res.matchedCount === 0) return { ok: false, message: MSG_RESET_INVALID_LINK };

    return { ok: true, message: MSG_RESET_DONE };
  } catch (err) {
    console.error('[password-reset] confirm failed:', err);
    return { ok: false, message: MSG_RESET_UNEXPECTED };
  }
}
