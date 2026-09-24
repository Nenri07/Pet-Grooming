/**
 * Generic retry helper for best-effort external calls.
 *
 * Used by the calendar sync layer (and other external-service callers) to
 * retry transient failures a bounded number of times with a fixed delay
 * between attempts (Requirement 14.5 — retry up to 3 times).
 *
 * The function re-throws the LAST error once all attempts are exhausted; it is
 * the caller's responsibility to decide whether to swallow that error (e.g.
 * best-effort calendar work) or propagate it.
 *
 * _Requirements: 14.5_
 */

/** Await `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke `fn`, retrying on rejection up to `attempts` total tries.
 *
 * @param fn       The async operation to run.
 * @param attempts Maximum number of attempts (default 3). Values < 1 are
 *                 treated as 1.
 * @param delayMs  Delay between attempts, in milliseconds (default 1000).
 * @returns The resolved value of `fn`.
 * @throws  The last error encountered if every attempt fails.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1000
): Promise<T> {
  const maxAttempts = attempts < 1 ? 1 : attempts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
