'use server';

/**
 * Waitlist (coming-soon early access) server action.
 *
 * Runs only on the server ('use server'). Validates the email, upserts a
 * `PrelaunchSignup` (unique email → idempotent, no duplicates), and fires a
 * best-effort Resend notification to the business. Returns a typed envelope and
 * NEVER throws, so the coming-soon form can render inline success/error without
 * a try/catch at the call site.
 *
 * Privacy: stores only the email the visitor volunteers plus a source tag.
 */
import { z } from 'zod';

import { connectDB } from '@/lib/db/connect';
import { PrelaunchSignup } from '@/lib/db/models/prelaunch-signup';
import { sendWaitlistNotification } from '@/lib/email/send';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Please enter a valid email address.' })
  .max(254, { message: 'That email is too long.' });

export type JoinWaitlistResult =
  | { ok: true; alreadyJoined: boolean; message: string }
  | { ok: false; error: string };

/**
 * Add an email to the pre-launch waitlist.
 *
 * @param rawEmail The visitor-entered email (validated + normalized here).
 */
export async function joinWaitlist(rawEmail: unknown): Promise<JoinWaitlistResult> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please enter a valid email address.',
    };
  }
  const email = parsed.data;

  try {
    await connectDB();

    // Upsert keyed on the unique email so a repeat signup is idempotent.
    const existing = await PrelaunchSignup.findOne({ email }).select('_id').lean();
    const alreadyJoined = Boolean(existing);

    if (!alreadyJoined) {
      await PrelaunchSignup.create({ email, source: 'coming-soon' });
      // Best-effort notification; a failure must not fail the signup.
      void sendWaitlistNotification(email).catch(() => {});
    }

    return {
      ok: true,
      alreadyJoined,
      message: alreadyJoined
        ? "You're already on the list — we'll be in touch soon."
        : "You're on the list! We'll email you the moment we launch.",
    };
  } catch (error) {
    // A concurrent insert can trip the unique index between check and create;
    // treat it as a successful (already-joined) signup rather than an error.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    ) {
      return {
        ok: true,
        alreadyJoined: true,
        message: "You're already on the list — we'll be in touch soon.",
      };
    }
    console.error('joinWaitlist failed:', error);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }
}
