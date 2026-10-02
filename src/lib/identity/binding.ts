/**
 * Identity-binding + velocity decision core (Billing, Trial, and Payments —
 * Requirements 11 and 12).
 *
 * This module is the PURE heart of the trial-abuse-prevention pipeline's final
 * two gates. It turns a loaded {@link BindingView} (or its absence) into a
 * single "has this identity already consumed its trial?" boolean, and turns a
 * velocity counter into a single "should this attempt be flagged?" boolean.
 *
 * It imports NOTHING from Mongoose / Stripe / Redis / Twilio. `now`, `count`,
 * and `threshold` are always explicit arguments so every function is
 * deterministic and trivially unit-tested. All the I/O — loading the
 * `IdentityBinding` row by phone hash, reading/incrementing the Redis velocity
 * counters, and deciding the overall allow/record policy — lives in the
 * {@link https Abuse-Prevention Pipeline} (`src/actions/trial.ts ::
 * startTrialGated`, task 9.2), NOT here.
 *
 * Co-location note: per design.md the velocity decision ({@link
 * shouldFlagVelocity}) lives in THIS file alongside {@link
 * identityConsumedTrial} rather than a sibling `velocity.ts`. Both are tiny,
 * import-free, pipeline-stage decision helpers (gate 5 and gate 6), so keeping
 * them together keeps the pure identity core in one place.
 *
 * @see Requirement 11.2 (decline a new trial when the verified phone identity
 *   is already bound to a prior trial), 11.3 (a deleted-and-re-registered
 *   account with the same phone is still "already consumed"), 12.2 (flag an
 *   attempt when the per-device/per-IP velocity count exceeds the threshold),
 *   12.3 (default policy is FLAG, not block — a flagged attempt still proceeds).
 */

/**
 * The minimal subset of an `IdentityBinding` row that the trial-consumed
 * decision reads. Accepting a plain shape (not a Mongoose document) keeps the
 * decision pure and trivially testable — the DB layer passes a `.lean()`
 * projection, tests pass literals.
 *
 * @property firstTrialAt      When the identity first provisioned a trial. Kept
 *                             on the view for operator/audit context; the
 *                             consumed decision itself does not read it.
 * @property bindingExpiresAt  Optional "phone recycling" horizon. When set, the
 *                             binding is only treated as consuming the trial
 *                             while `now < bindingExpiresAt`; once that instant
 *                             passes the phone is considered recycled and the
 *                             identity may trial again. When `null`/omitted the
 *                             binding never expires (consumed forever).
 */
export interface BindingView {
  firstTrialAt: Date;
  bindingExpiresAt?: Date | null;
}

/**
 * Whether this identity has ALREADY consumed its trial as of `now`. PURE.
 *
 * Decision (Requirements 11.2, 11.3):
 *
 *   identityConsumedTrial(binding, now) ===
 *     binding != null && (binding.bindingExpiresAt == null || now < binding.bindingExpiresAt)
 *
 * Cases:
 *   - `binding == null`                       → `false` — no binding exists for
 *     this identity, so it may start a trial (R11.2: only decline when a prior
 *     binding exists).
 *   - binding with `bindingExpiresAt == null` → `true` forever — the identity
 *     consumed its trial and the binding never expires (the default; R11.2/11.3
 *     — deleting and re-registering with the same phone still reads as
 *     consumed because the binding persists independently of the account row).
 *   - binding with a `bindingExpiresAt`       → `true` only while
 *     `now < bindingExpiresAt`; `false` once `now >= bindingExpiresAt`, i.e. the
 *     phone has been recycled and the identity may trial again (refined R11).
 *
 * EXPIRY BOUNDARY (resolved per design.md Property 10): the comparison is
 * STRICT (`now < bindingExpiresAt`). At the exact boundary `now == bindingExpiresAt`
 * the function returns `false` — the binding is treated as EXPIRED / AVAILABLE
 * the instant its expiry is reached, not one tick later. So:
 *   - `now <  bindingExpiresAt` → `true`  (still within the binding window)
 *   - `now == bindingExpiresAt` → `false` (expired, available again)
 *   - `now >  bindingExpiresAt` → `false` (expired, available again)
 *
 * This is a fail-CLOSED gate in the pipeline: a `true` result withholds the new
 * trial (R11.2). The pipeline resolves double-submit races via the unique
 * `phoneHash` index — the losing writer is treated as "already consumed" — but
 * that race resolution is a pipeline concern, not part of this pure decision.
 *
 * @param binding The loaded identity binding for the verified phone identity,
 *                or `null` when no binding exists yet.
 * @param now     The reference time (injected for determinism/tests).
 * @returns `true` iff a binding exists and has not expired as of `now`.
 */
export function identityConsumedTrial(binding: BindingView | null, now: Date): boolean {
  if (binding == null) {
    return false;
  }
  if (binding.bindingExpiresAt == null) {
    return true;
  }
  // Strict `<`: at `now == bindingExpiresAt` the binding is expired/available.
  return now < binding.bindingExpiresAt;
}

/**
 * Whether a trial attempt should be FLAGGED for exceeding the velocity
 * threshold. PURE.
 *
 * Decision (Requirement 12.2):
 *
 *   shouldFlagVelocity(count, threshold) === count > threshold
 *
 * The comparison is STRICTLY greater-than: a count exactly AT the threshold is
 * NOT flagged; only a count that exceeds it is. With the default policy of
 * "more than 3 creations per device/IP within the window", a threshold of `3`
 * flags the 4th and later attempts (`count === 4` ⇒ `true`), leaving the first
 * three un-flagged (`count === 3` ⇒ `false`).
 *
 * DEFAULT POLICY IS FLAG, NOT BLOCK (Requirement 12.3): a `true` result from
 * this function only means the attempt is RECORDED as flagged for operator
 * review — under the stated default policy the trial still PROCEEDS (the
 * pipeline returns an allow decision carrying `flagged: true`). Hard-blocking on
 * a flag is a configurable escalation that is intentionally NOT the default.
 * This pure function decides ONLY the flag; the allow/record/escalate policy —
 * and the velocity counters themselves, which fail-OPEN when the signal store
 * is unavailable (R12.5) — live in the pipeline (task 9.2), not here.
 *
 * @param count     The number of trial creations observed from the single
 *                  device fingerprint or single IP within the configured window.
 * @param threshold The configurable flag threshold (e.g. default `3`).
 * @returns `true` iff `count > threshold` (strictly greater).
 */
export function shouldFlagVelocity(count: number, threshold: number): boolean {
  return count > threshold;
}
