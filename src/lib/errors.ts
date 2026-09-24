/**
 * Application error handling primitives.
 *
 * Provides:
 *  - {@link AppError}: a typed, *expected* error whose `message` is safe to show
 *    to end users (e.g. "That time slot is no longer available"). Carries a
 *    machine-readable `code` and an HTTP-ish `statusCode` for callers that want
 *    to branch on it.
 *  - {@link safeAction}: a wrapper for server actions / async operations that
 *    normalises the two error classes into a `{ data?, error? }` envelope:
 *      • an {@link AppError} surfaces its (user-safe) message, while
 *      • any other/unexpected error is logged server-side with full detail and
 *        replaced with a single generic, non-technical message so we never leak
 *        stack traces, database internals, or third-party error text to users.
 *
 * This satisfies Requirement 21.4: on an unexpected server error, show a
 * non-technical message that the operation could not be completed and log the
 * error details server-side.
 *
 * _Requirements: 21.1, 21.4, 21.5, 21.6_
 */

/**
 * A known, user-safe application error.
 *
 * Throw this from server actions / library code when the failure is expected
 * and its `message` can be shown directly to the user. `safeAction` returns the
 * message verbatim; anything that is NOT an `AppError` is treated as unexpected
 * and hidden behind a generic message.
 */
export class AppError extends Error {
  /** Machine-readable error code (e.g. "SLOT_TAKEN", "NOT_FOUND"). */
  public readonly code: string;
  /** HTTP-style status code for callers that map errors to responses. */
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    // Restore prototype chain for `instanceof` when compiled to ES5-ish targets.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Generic, non-technical message shown for any unexpected failure (Req 21.4). */
export const GENERIC_ERROR_MESSAGE =
  'The operation could not be completed. Please try again.';

/** Result envelope returned by {@link safeAction}. */
export interface ActionResult<T> {
  data?: T;
  error?: string;
}

/**
 * Run `fn` and normalise its outcome into a `{ data?, error? }` envelope.
 *
 * - On success: `{ data }`.
 * - On an {@link AppError}: `{ error: err.message }` (message is user-safe).
 * - On any other error: the error is logged server-side and `{ error }` carries
 *   the generic {@link GENERIC_ERROR_MESSAGE} so no internal detail leaks.
 *
 * @param fn The async operation to guard.
 * @returns A promise of the result envelope. This never rejects.
 */
export async function safeAction<T>(
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { data };
  } catch (err) {
    if (err instanceof AppError) {
      return { error: err.message };
    }
    // Unexpected: log full detail server-side, return a generic message (Req 21.4).
    console.error('[safeAction] Unexpected error:', err);
    return { error: GENERIC_ERROR_MESSAGE };
  }
}
