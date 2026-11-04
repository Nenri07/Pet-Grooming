/**
 * Pure confirm-flow helpers for the `/verify-email` page.
 *
 * The confirm logic lives here (instead of inside `VerifyEmailClient`'s effect)
 * so it can be unit tested without React and so the client can guard it to run
 * at most once per page load per token. This module has no React, Next.js, or
 * server imports.
 *
 * _Requirements: 2.1, 2.2, 3.2_
 */

export type Phase =
  | { kind: 'verifying' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export const MSG_SUCCESS = 'Your email is verified — you can close this tab and continue.';
export const MSG_MISSING_TOKEN =
  'This verification link is missing its token. Please request a new one.';
export const MSG_CLIENT_UNEXPECTED = 'Something went wrong. Please try again in a moment.';

/** Structural shape of the `confirmEmailVerification` envelope used here. */
export type ConfirmResult = { ok: true; message?: string } | { ok: false; message: string };

export interface EmailConfirmDeps {
  confirm: (input: { token: string }) => Promise<ConfirmResult>;
  refreshSession: () => Promise<unknown>;
  navigate: (href: string) => void;
  isActive: () => boolean;
  setPhase: (phase: Phase) => void;
}

/** True for tokens shaped like `randomBytes(32).toString('hex')`. */
export function isWellFormedVerifyToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

/**
 * Claims the confirm for `token`. Returns `false` if this guard already
 * claimed the same token (a re-run or Strict Mode remount), otherwise records
 * the token and returns `true`.
 */
export function claimConfirm(guard: { current: string | null }, token: string): boolean {
  if (guard.current === token) return false;
  guard.current = token;
  return true;
}

/**
 * Runs one confirm attempt. A missing token short-circuits to an error without
 * calling the server. Results are applied only while `isActive()` is true, so a
 * real unmount or a token change suppresses stale updates and navigation.
 */
export async function runEmailConfirm(token: string, deps: EmailConfirmDeps): Promise<void> {
  const { confirm, refreshSession, navigate, isActive, setPhase } = deps;

  if (token.trim() === '') {
    setPhase({ kind: 'error', message: MSG_MISSING_TOKEN });
    return;
  }

  let res: ConfirmResult;
  try {
    res = await confirm({ token });
  } catch {
    if (isActive()) setPhase({ kind: 'error', message: MSG_CLIENT_UNEXPECTED });
    return;
  }

  if (!isActive()) return;

  if (res.ok) {
    setPhase({ kind: 'success', message: MSG_SUCCESS });
    // Refresh the JWT so middleware sees `emailVerified`. A failed refresh must
    // not strand the user; the navigation below re-runs the jwt callback anyway.
    try {
      await refreshSession();
    } catch {
      // swallowed on purpose
    }
    if (isActive()) navigate('/onboarding');
  } else {
    setPhase({ kind: 'error', message: res.message });
  }
}
