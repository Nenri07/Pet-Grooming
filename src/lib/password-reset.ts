/**
 * Pure helpers for the password-reset flow. No server, DB or React imports, so
 * they can be unit tested directly and used from both server actions and pages.
 */
import { createHash, randomBytes } from 'node:crypto';

/** User-facing messages. Never reveal whether an account exists. */
export const MSG_RESET_REQUESTED =
  'If an account exists for that email, we have sent a link to reset the password. It expires in 1 hour.';
export const MSG_RESET_INVALID_LINK =
  'This reset link is invalid or has expired. Please request a new one.';
export const MSG_RESET_DONE = 'Your password has been updated. You can now log in.';
export const MSG_RESET_BUSY = 'Too many attempts. Please wait a minute and try again.';
export const MSG_RESET_UNEXPECTED = 'Something went wrong. Please try again in a moment.';

/** A fresh reset token: 32 random bytes as 64 lowercase hex characters. */
export function newResetToken(): string {
  return randomBytes(32).toString('hex');
}

/** True for tokens shaped like {@link newResetToken} output. */
export function isWellFormedResetToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
}

/** SHA-256 of a token. Only this hash is stored, never the emailed token. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Absolute reset link for `token` under `baseUrl` (trailing slash tolerated). */
export function buildResetLink(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}
