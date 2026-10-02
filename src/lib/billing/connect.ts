/**
 * Stripe Connect status mapping + booking-permission decision core
 * (Billing, Trial, and Payments — Requirements 15 & 17). PURE.
 *
 * This module turns the subset of a Stripe `Account` the webhook reads into the
 * single surfaced {@link ConnectStatus} enum, and decides whether a booking may
 * proceed given that status and whether the booking requires a deposit. It is
 * the SINGLE source of truth for both derivations so that:
 *   - the `account.updated` Connect webhook handler (task 13.3) and the
 *     GroomerProfile backfill (task 14.3) can never disagree about how a Stripe
 *     account becomes a `connectStatus`, and
 *   - the public booking page gate (task 14.2) and the direct-charge deposit
 *     creation (task 13.2) can never disagree about when a deposit booking is
 *     allowed.
 *
 * It imports NOTHING from Stripe / Mongoose / Redis — it reads a plain
 * {@link ConnectAccountView} shape (the fields it needs off a `Stripe.Account`)
 * so it is deterministic and trivially unit-tested with object literals.
 *
 * @see Requirement 15.1 — track the Connected_Account state as exactly one of:
 *   not started, pending, needs more info, complete, or disabled.
 * @see Requirement 15.4 — on `account.updated`, update the stored status (and
 *   the `chargesEnabled` flag at the call site) to match Stripe. `complete`
 *   corresponds to Stripe's `charges_enabled === true`.
 * @see Requirement 17.2 — a no-deposit booking is always allowed, even without
 *   a complete Connected_Account.
 * @see Requirement 17.3 — once onboarding is complete, deposit-requiring
 *   bookings are enabled with no further manual steps (i.e. the gate is purely
 *   `connectStatus === 'complete'`).
 */

/**
 * The five surfaced Connect onboarding states (R15.1).
 *
 * Mirrors the `GroomerProfile.connectStatus` enum (task 13.1) so this pure
 * module is the shared definition both the model and the webhook import.
 *
 *   - `not_started` — no account yet, or an account that has submitted nothing
 *     actionable and cannot charge.
 *   - `pending`     — details submitted, awaiting Stripe verification; cannot
 *     charge yet and nothing is currently required of the groomer.
 *   - `needs_info`  — Stripe is waiting on additional information
 *     (`requirements.currently_due` / `past_due` entries) before enabling.
 *   - `complete`    — charges are enabled; the groomer can receive deposits.
 *   - `disabled`    — Stripe has disabled the account
 *     (`requirements.disabled_reason` set); re-onboarding required.
 */
export type ConnectStatus =
  | 'not_started'
  | 'pending'
  | 'needs_info'
  | 'complete'
  | 'disabled';

/**
 * The subset of a `Stripe.Account` that {@link mapConnectStatus} reads.
 *
 * Declared as a plain structural shape (not `Stripe.Account`) so the mapping is
 * importable without the Stripe SDK and testable with object literals. The
 * webhook handler passes the real `Stripe.Account` (which is assignable to this
 * shape); tests pass literals.
 *
 * @property charges_enabled   Stripe's "can this account accept charges?" flag.
 *                             `true` is the sole condition for `complete`.
 * @property details_submitted Whether the account has finished the hosted
 *                             onboarding form. Distinguishes `pending`
 *                             (submitted, awaiting review) from `not_started`.
 * @property requirements      The account's outstanding requirements, if any.
 * @property requirements.currently_due  Fields Stripe needs now.
 * @property requirements.past_due        Fields Stripe needed and are overdue.
 * @property requirements.disabled_reason Non-empty when Stripe has disabled the
 *                             account (e.g. `rejected.fraud`, `requirements.*`).
 */
export interface ConnectAccountView {
  charges_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    currently_due?: string[] | null;
    disabled_reason?: string | null;
    past_due?: string[] | null;
  } | null;
}

/** True iff `value` is a non-empty string (after no trimming — Stripe sends
 *  machine codes, never whitespace, as `disabled_reason`). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True iff `list` is an array with at least one entry. */
function hasEntries(list: string[] | null | undefined): boolean {
  return Array.isArray(list) && list.length > 0;
}

/**
 * Map the Stripe account view into the surfaced {@link ConnectStatus} (R15.1,
 * R15.4). PURE, TOTAL, and IDEMPOTENT with respect to the derived status
 * (feeding the same account in twice always yields the same status).
 *
 * PRECEDENCE (first matching rule wins):
 *   1. `account == null`                       → `not_started`
 *      (no account yet — nothing has been created/stored).
 *   2. `charges_enabled === true`              → `complete`
 *      (the ONLY path to `complete`; `complete` iff `charges_enabled`). This is
 *      checked before `disabled`/`needs_info` so a fully-enabled account that
 *      still carries residual future-dated requirements is reported `complete`.
 *   3. `requirements.disabled_reason` non-empty → `disabled`
 *      (Stripe has actively disabled the account; it outranks `needs_info`
 *      because a disabled account cannot progress by merely supplying info).
 *   4. `currently_due` OR `past_due` non-empty  → `needs_info`
 *      (Stripe is blocking on information the groomer must supply).
 *   5. `details_submitted === true`             → `pending`
 *      (onboarding submitted, not yet charges-enabled, nothing due — awaiting
 *      Stripe review).
 *   6. otherwise                                → `not_started`.
 *
 * `complete` iff `charges_enabled === true` (rule 2 is the only producer of
 * `complete`, and any account with `charges_enabled === true` matches it before
 * any other rule). This is the exact gate {@link bookingAllowed} and the
 * direct-charge deposit path (task 13.2) key off of.
 *
 * @param account The subset of the Stripe account, or `null`/`undefined` when
 *                no Connected_Account exists yet.
 * @returns Exactly one {@link ConnectStatus}.
 */
export function mapConnectStatus(
  account: ConnectAccountView | null | undefined
): ConnectStatus {
  // Rule 1: no account at all.
  if (account == null) {
    return 'not_started';
  }

  // Rule 2: charges enabled is the sole, highest-priority path to `complete`.
  if (account.charges_enabled === true) {
    return 'complete';
  }

  const requirements = account.requirements;

  // Rule 3: Stripe has disabled the account.
  if (isNonEmptyString(requirements?.disabled_reason)) {
    return 'disabled';
  }

  // Rule 4: Stripe is waiting on information from the groomer.
  if (hasEntries(requirements?.currently_due) || hasEntries(requirements?.past_due)) {
    return 'needs_info';
  }

  // Rule 5: submitted but not yet charges-enabled and nothing is due.
  if (account.details_submitted === true) {
    return 'pending';
  }

  // Rule 6: default — nothing actionable yet.
  return 'not_started';
}

/**
 * Decide whether a booking may proceed given whether it requires a deposit and
 * the groomer's current Connect status (R17.2, R17.3). PURE and TOTAL.
 *
 * A booking is allowed iff it does NOT require a deposit, OR the groomer's
 * Connected_Account is `complete`:
 *
 *   `bookingAllowed(requiresDeposit, status) === (!requiresDeposit || status === 'complete')`
 *
 *   - No-deposit booking → always allowed, regardless of Connect status
 *     (R17.2 — the groomer need not have connected Stripe for a free booking).
 *   - Deposit-requiring booking → allowed only once `status === 'complete'`
 *     (R17.3 — completing onboarding enables deposit bookings with no further
 *     manual steps; any non-`complete` status blocks the paid booking, which the
 *     UI surfaces as the "online payments not set up yet" state, R17.1).
 *
 * @param requiresDeposit Whether this booking requires a deposit.
 * @param connectStatus   The groomer's current {@link ConnectStatus}.
 * @returns `true` if the booking may proceed, `false` if it must be blocked.
 */
export function bookingAllowed(
  requiresDeposit: boolean,
  connectStatus: ConnectStatus
): boolean {
  return !requiresDeposit || connectStatus === 'complete';
}
