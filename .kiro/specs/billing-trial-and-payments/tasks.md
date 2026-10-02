# Implementation Plan: Billing, Trial, and Payments

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Each task builds on the previous ones, follows the design's pure-core-first convention (pure functions + their tests, then the I/O adapters that use them, then the UI), names the exact files from the design, and ends in a working, type-checked, tested, committable state. The three phases are built and verified in order so `main` always stays working: Phase 1 (trial + hard lockout + auto-renewal), Phase 2 (trial abuse prevention), Phase 3 (Stripe Connect direct charges).

## Tasks

- [x] 1. Phase 1 foundation — config + Subscription model extension
  - [x] 1.1 Add new billing env vars to the env example and placeholder-aware config
    - In `.env.example`, add `STRIPE_PLATFORM_FEE_PERCENT=0`, `STRIPE_CONNECT_WEBHOOK_SECRET`, and document the existing `STRIPE_WEBHOOK_SECRET` covering Connect by default.
    - Add a parsed accessor for `STRIPE_PLATFORM_FEE_PERCENT` (clamp to `[0,100]`, default `0`) wired through the shared `isSet` placeholder classifier so a placeholder/empty value yields the default.
    - Do not add Phase 2/3-only vars yet (those land in their phases); keep this change compile-only.
    - _Requirements: 16.2, 19.4_ — Design: Configuration / Environment
  - [x] 1.2 Extend the `Subscription` model with trial/grace fields
    - In `src/lib/db/models/subscription.ts`, add additive fields `trialStartedAt: Date|null`, `trialDeadline: Date|null`, `pastDueSince: Date|null` to `ISubscription` and `subscriptionSchema` (all default `null`). Keep `trialEndsAt` for backward compatibility with `resolveEntitlements`.
    - No index changes required; existing `stripeCustomerId`/`stripeSubscriptionId` sparse indexes remain.
    - _Requirements: 1.1, 1.2, 3.1, 5.4_ — Design: Data Models (reuse existing Subscription)

- [x] 2. Phase 1 pure core — trial math + access decision (PURE + property tests)
  - [x] 2.1 Implement trial math pure functions
    - Create `src/lib/billing/trial.ts` with `computeTrialDeadline(startedAt, timezone)` (noon in groomer tz on day 14, UTC Date out, via date-fns-tz) and `trialDaysRemaining(now, deadline, timezone)` (whole days, never negative, `0` once deadline passed).
    - Pure only — import nothing from Mongoose/Stripe/Redis.
    - _Requirements: 1.2, 2.1, 2.2, 2.4_ — Design: Pure Functions → `trial.ts`
  - [x]* 2.2 Write property tests for trial math (PURE + TEST)
    - Add `tests/properties/trial.test.ts` (fast-check, `numRuns >= 100`, tagged `Feature: billing-trial-and-payments`).
    - **Property 2: computeTrialDeadline** — local wall-clock is 12:00 and local date is start local date + 14 days, across supported IANA tz; include a DST-boundary example.
    - **Property 3: trialDaysRemaining** — `>= 0` always, `0` when `now >= deadline`, monotonic non-increasing for `now1 <= now2`; boundary examples (noon exactly, 3-days-left emphasize flag).
    - _Requirements: 1.2, 2.1, 2.2, 2.4_
  - [x] 2.3 Implement the access/lockout decision pure functions
    - Create `src/lib/billing/access.ts` with `AccessState`, `AccessInput`, `AccessDecision`, `evaluateAccess(input)` (state machine: active→allow; trialing & `now<deadline`→allow; trialing expired→lockout `trial_expired`; past_due within `GRACE_PERIOD_DAYS` of `pastDueSince`→allow; past_due beyond grace→lockout `inactive`; canceled|none→lockout `inactive`), plus `AccessClaim`, `toAccessClaim(sub)`, `accessFromClaim(claim, now)`.
    - Reuse the same `GRACE_PERIOD_DAYS` as `resolveEntitlements` so lockout and feature-gating never disagree.
    - _Requirements: 3.1, 3.3, 3.4_ — Design: Pure Functions → `access.ts`
  - [x]* 2.4 Write property tests for `evaluateAccess` (PURE + TEST)
    - Add `tests/properties/access.test.ts`.
    - **Property 4: evaluateAccess** — allow iff active / trialing-before-deadline / past_due-within-grace; lockout otherwise; **monotonic in time** (lockout at `t` ⇒ lockout at every `t' > t` with same other fields). Add per-status examples.
    - Also assert `accessFromClaim(toAccessClaim(x), now)` agrees with `evaluateAccess(x)` (claim round-trip).
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 3. Phase 1 middleware + JWT lockout integration
  - [x] 3.1 Extend `resolveRedirect` with the lockout rule
    - In `src/middleware.ts`, add optional `access?: AccessDecision` to `resolveRedirect` params and append the lockout rule LAST (after auth/onboarding rules): authenticated + onboarded + `!access.allow` ⇒ auth routes pass, `/billing`(+nested) passes, other portal routes redirect to `/billing`. Preserve the no-self-redirect invariant verbatim. Wire the middleware body to derive `access` via `accessFromClaim(token.access, new Date())`.
    - Keep public routes (`/book`, marketing) passing through so a locked groomer's booking page stays up (R3.6).
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_ — Design: Middleware Lockout Integration
  - [x]* 3.2 Write unit/property tests for the extended `resolveRedirect` (PURE + TEST)
    - Add/extend `tests/properties/resolveRedirect.test.ts`.
    - **Property 5: no-self-redirect** — returns `null` or a path `!= pathname` for any pathname/auth/onboarding/access combination; locked groomer on `/billing` or an auth route is never redirected away.
    - Examples: locked on portal route → `/billing`; locked on `/billing` → `null`; locked on `/login` → `null`; allow-state leaves prior behavior unchanged.
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [x] 3.3 Stamp the compact access claim in the JWT callback
    - In `src/lib/auth/config.ts`, in the `jwt` callback (Node runtime), load the groomer's subscription and stamp `token.access = toAccessClaim(...)` alongside the existing `onboardingComplete` claim. Mirror the existing refresh logic: restamp at sign-in, on `trigger === 'update'`, and on a short time-based TTL (~5 min). Fail-open: a missing/unresolvable billing state must never lock out (default to the entitlements trial view).
    - _Requirements: 3.1, 3.4_ — Design: New JWT claim(s)
  - [x] 3.4 Add the shared server access guard for /api and server actions
    - Create `src/lib/billing/access-guard.ts` with `assertPortalAccess(groomerId)` (load subscription via the existing entitlements Redis cache, apply the pure `evaluateAccess`) and `PortalLockedError extends AppError` (callers map to 402/403 upgrade prompt). This covers routes the middleware matcher excludes (`/api`).
    - _Requirements: 3.1, 3.3_ — Design: API-route behavior / shared server guard

- [x] 4. Phase 1 trial provisioning + subscription webhooks
  - [x] 4.1 Add the `mapStripeSubStatus` pure helper (PURE)
    - In the webhook helpers module used by `src/app/api/webhooks/stripe/route.ts` (e.g. `src/app/api/webhooks/stripe/helpers.ts`), add `mapStripeSubStatus(stripeStatus) -> SubscriptionStatus` (total mapping into `{trialing, active, past_due, canceled, expired}`).
    - _Requirements: 5.2, 5.3, 5.4_ — Design: Stripe Flows (c)
  - [x]* 4.2 Write property test for `mapStripeSubStatus` (PURE + TEST)
    - Add `tests/properties/subStatus.test.ts`.
    - **Property 11: subscription-status mapping is total** — any input string lands in the local enum; add targeted assertions that `invoice.payment_failed`→`past_due` and `invoice.paid`→`active` effect paths map correctly.
    - _Requirements: 5.2, 5.3, 5.4_
  - [x] 4.3 Implement local trial provisioning action
    - Create `src/actions/trial.ts` with a Phase-1 `startTrial`-style entry that computes `computeTrialDeadline`, upserts the `Subscription` (`status: trialing`, `trialStartedAt`, `trialDeadline`, mirror `trialEndsAt`), and delegates Stripe trial recording to the existing `BillingProvider.startTrial`. Returns a typed `{ ok }` envelope and still records local `trialing` when Stripe Billing is Not_Configured. (The abuse-gate pipeline is added in Phase 2; here provision directly for an authenticated groomer.)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_ — Design: Stripe Flows (a)
  - [x] 4.4 Add subscription lifecycle event routing to the webhook
    - In `src/app/api/webhooks/stripe/route.ts`, after signature verify + `idempotencyOnce(event.id)`, route platform `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end` to new handlers that set local status via `mapStripeSubStatus`, set `currentPeriodEnd`, set/clear `pastDueSince`, record trial-ending, and `invalidateEntitlements(groomerId)` on every change. Return 5xx on transient failure. Leave existing `payment_intent.*` deposit fulfilment untouched.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3_ — Design: Stripe Flows (c) + webhook routing
  - [x]* 4.5 Write webhook integration + confluence tests (TEST)
    - Add `tests/` integration coverage: 400 on missing/invalid signature (R6.1/6.2); existing deposit fulfilment stays green (R6.3); duplicate subscription events converge to the same final state.
    - **Property 12: lifecycle idempotence/confluence** — a sequence with arbitrary duplicates yields the same final status/period state as the duplicate-free sequence.
    - _Requirements: 5.6, 6.1, 6.2, 6.3_
  - [x] 4.6 Verify subscription checkout + customer portal wiring (reuse existing)
    - Confirm `src/actions/billing.ts` / `StripeBilling` `createCheckout` and customer-portal link are scoped to `session.user.id` and return `not_configured` envelopes without throwing; add only the minimal glue needed so a completed checkout flips the local Subscription to `active` (via webhook) and triggers a NextAuth `update()` so the lockout lifts.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 3.4_ — Design: Stripe Flows (b)

- [x] 5. Phase 1 UI — trial countdown + lockout/upgrade state
  - [x] 5.1 Build the trial countdown component
    - Create a portal trial-countdown component rendering `trialDaysRemaining`, emphasized state with an Upgrade link when `<= 3` days, and a "trial ended" state past the deadline. DaisyUI theme tokens, WCAG 2.1 AA contrast, 44px touch targets. Wire it into the portal shell.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_ — Design: UI
  - [x] 5.2 Build the lockout/upgrade state on `/billing` and not-configured billing state
    - On the `/billing` page, render the upgrade/lockout view (reachable during lockout) with subscribe actions, and a labelled "billing not set up yet" state when Stripe Billing is Not_Configured. DaisyUI tokens, WCAG AA, 44px targets.
    - _Requirements: 3.2, 4.1, 18.1, 18.4_ — Design: Error Handling & Degradation
  - [x] 5.3 Backfill/migration for existing subscriptions without `trialDeadline`
    - Add a one-off backfill (script or lazy on-read defaulting) that derives `trialDeadline`/`trialStartedAt` for existing rows from `trialEndsAt` so legacy trialing rows lock out correctly; ensure read paths treat a null `trialDeadline` safely (fail-open to entitlements default).
    - _Requirements: 1.2, 3.1_ — Design: Data Models

- [-] 6. Phase 1 verification gate
  - Verify phase: run `npx tsc --noEmit`, `npm test -- --run`, and `npm run build`; fix any failures; commit. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Phase 2 config + identity pure core (PURE + property tests)
  - [~] 7.1 Add Phase 2 env vars to the env example and placeholder-aware config
    - Add `IDENTITY_PHONE_PEPPER`, `TWILIO_VERIFY_SERVICE_SID`, `DISPOSABLE_DOMAINS_SOURCE`, `TRIAL_VELOCITY_THRESHOLD` (default 3), `TRIAL_VELOCITY_WINDOW_HOURS` (default 24), and email-verify settings to `.env.example`, each `isSet`-aware (placeholder ⇒ Not_Configured_State / documented fail policy).
    - _Requirements: 13.1, 19.4_ — Design: Configuration / Environment
  - [~] 7.2 Implement email normalization + disposable-domain pure functions
    - Create `src/lib/identity/email.ts` with `normalizeEmail(email)` (lowercase/trim; Gmail/googlemail: strip local-part dots and drop `+tag`; idempotent) and `isDisposableDomain(domain, blocklist: ReadonlySet<string>)` (pure membership over an injected Set; loader is a separate I/O concern).
    - _Requirements: 8.1, 8.3, 9.1, 9.2, 9.3, 9.4_ — Design: Pure Functions → `email.ts`
  - [ ]* 7.3 Write property tests for email functions (PURE + TEST)
    - Add `tests/properties/email.test.ts`.
    - **Property 6: idempotency** — `normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)`.
    - **Property 7: Gmail aliases collapse** — inserting dots / appending `+tag` doesn't change the result; two dot/tag variants map to the same canonical email; non-Gmail unchanged examples.
    - **Property 8: disposable check** — `true` iff lowercased domain ∈ blocklist, using the normalized email's domain.
    - _Requirements: 8.1, 8.3, 9.1, 9.3_
  - [~] 7.4 Implement phone canonicalization pure function
    - Create `src/lib/identity/phone.ts` with `normalizePhoneE164(input, defaultRegion)` (strip formatting, apply default region for national input, return canonical E.164 or `null` when implausible; idempotent on canonical input).
    - _Requirements: 10.5_ — Design: Pure Functions → `phone.ts`
  - [ ]* 7.5 Write property test for phone canonicalization (PURE + TEST)
    - Add `tests/properties/phone.test.ts`.
    - **Property 9: format-invariant + idempotent** — all formatting variants of a valid number normalize to the same E.164; idempotent on canonical input; invalid → `null` example.
    - _Requirements: 10.5_
  - [~] 7.6 Implement identity-binding + velocity pure decisions
    - Create `src/lib/identity/binding.ts` with `BindingView`, `identityConsumedTrial(binding|null, now)` (true iff binding exists AND (`bindingExpiresAt` null OR `now < bindingExpiresAt`)). Add `shouldFlagVelocity(count, threshold)` (true iff `count > threshold`) in the velocity helper.
    - _Requirements: 11.2, 11.3, 12.2, 12.3_ — Design: Pure Functions → `binding.ts`, Abuse-Prevention Pipeline
  - [ ]* 7.7 Write property tests for binding + velocity (PURE + TEST)
    - Add `tests/properties/binding.test.ts`.
    - **Property 10: identityConsumedTrial expiry boundary** — true iff binding exists and not expired; `false` for null and for `now >= bindingExpiresAt`; boundary case `now == expiry`.
    - **Property 15: shouldFlagVelocity** — `true` iff `count > threshold`; flagged attempts still return allow (`flagged: true`) under default policy.
    - _Requirements: 11.2, 11.3, 12.2, 12.3_

- [ ] 8. Phase 2 persistence + verification provider seam
  - [~] 8.1 Create the `IdentityBinding` model
    - Create `src/lib/db/models/identity-binding.ts` per design: `normalizedEmail`, `phoneHash` (sha256(E.164+pepper)), `firstTrialAt`, optional `bindingExpiresAt`, `deviceFingerprints[]`, masked `ips[]`. Unique index on `phoneHash`, secondary index on `normalizedEmail`. Persisted independently of the account so deletion doesn't remove it.
    - _Requirements: 11.1, 11.4, 12.4, 19.1_ — Design: Data Models → IdentityBinding (+ PII handling)
  - [~] 8.2 Add Redis keys/TTLs for OTP, velocity, and email-verify tokens
    - In `src/lib/redis.ts`, add key builders + TTLs: `otp:{phoneHash}`, `otp:rl:{phoneHash}`, `vel:dev:{fingerprint}`, `vel:ip:{maskedIp}` (24h configurable), `evf:{token}` (~30 min). Fail-open when Redis is unavailable.
    - _Requirements: 10.4, 12.1, 12.2, 12.5, 7.1_ — Design: OTP + velocity storage
  - [~] 8.3 Implement the `VerificationProvider` seam
    - Create `src/lib/verification/provider.ts` with the interface, `isVerificationConfigured()` (placeholder-aware), and `getVerificationProvider()` factory returning `TwilioVerifyProvider` when `TWILIO_VERIFY_SERVICE_SID` set, else `OtpSmsProvider` (code in Redis, send via existing `SmsProvider`) when SMS configured, else `NoopVerificationProvider`. Never throws; typed envelopes.
    - _Requirements: 10.2, 10.3, 10.4, 13.1, 13.2, 13.4, 19.1_ — Design: VerificationProvider seam
  - [ ]* 8.4 Write provider-selection + Noop tests (TEST)
    - Assert `getVerificationProvider()` picks the impl by config and `NoopVerificationProvider` returns `not_configured` envelopes without throwing.
    - _Requirements: 13.1, 18.3_

- [ ] 9. Phase 2 verification actions + gated trial pipeline
  - [~] 9.1 Implement verification server actions
    - Create `src/actions/verification.ts` with `requestPhoneOtp({ phone })` and `confirmPhoneOtp({ phone, code })` (scoped to `session.user.id`, delegate to `VerificationProvider`, apply Redis rate limits), plus `requestEmailVerification()` / `confirmEmailVerification(token)` reusing the existing Resend email seam and recording `User.emailVerifiedAt`. Typed envelopes; user-safe messages (no provider internals).
    - _Requirements: 7.1, 7.3, 7.4, 10.1, 10.2, 10.3, 10.4, 13.2, 13.3, 13.4_ — Design: New server actions
  - [~] 9.2 Wire the ordered abuse-gate pipeline into `startTrialGated`
    - Extend `src/actions/trial.ts` to run the ordered pipeline before provisioning: normalize email → disposable check (fail-open on load failure) → email verified (fail-closed) → phone OTP verified (fail-closed on wrong/expired, degraded when provider down) → velocity flag (fail-open, flag-not-block) → `identityConsumedTrial` (fail-closed) → provision `Subscription` + insert `IdentityBinding`. Resolve double-submit races via the unique `phoneHash` index (loser treated as already-consumed). Store device fingerprint (opaque) + masked IP; increment velocity counters.
    - _Requirements: 1.1, 1.4, 7.1, 7.2, 8.1, 8.4, 10.1, 11.1, 11.2, 12.1, 12.2, 12.3, 12.5_ — Design: Abuse-Prevention Pipeline
  - [~] 9.3 Add the client device-fingerprint lib
    - Create `src/lib/identity/fingerprint.client.ts` computing an opaque, non-PII hash from stable browser signals, submitted with the trial-start request; pipeline proceeds if omitted.
    - _Requirements: 12.1, 12.4, 12.5_ — Design: Abuse-Prevention Pipeline
  - [ ]* 9.4 Write IdentityBinding persistence/integration tests (TEST)
    - DB-backed (`isDbAvailable()`-guarded): a binding survives account deletion and still blocks a new trial for the same phone identity; a consumed identity declines a second trial.
    - _Requirements: 11.2, 11.3, 11.4, 1.4_

- [ ] 10. Phase 2 UI — email-verify + phone-OTP in the registration/trial-start flow
  - [~] 10.1 Build email-verify + phone-OTP UI
    - Add the email-verification and phone-OTP steps to the registration/trial-start flow (request/confirm OTP, resend within rate limit, labelled Not_Configured_State when a provider is unavailable, user-safe error messages). DaisyUI theme tokens, WCAG 2.1 AA, 44px touch targets.
    - _Requirements: 7.1, 10.1, 10.2, 10.3, 10.4, 13.1, 13.4_ — Design: UI

- [~] 11. Phase 2 verification gate
  - Verify phase: run `npx tsc --noEmit`, `npm test -- --run`, and `npm run build`; fix any failures; commit. Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Phase 3 config + fee pure core (PURE + property tests)
  - [~] 12.1 Implement the application-fee pure function
    - Create `src/lib/billing/fees.ts` with `computeApplicationFee(amountMinor, currency, ratePercent)` — zero-decimal-currency aware, returns an integer in minor units with `0 <= fee <= amountMinor`, `fee === 0` when `ratePercent === 0`, non-decreasing in `ratePercent`. Reads launch default `0` from `STRIPE_PLATFORM_FEE_PERCENT` at the call site (function stays pure).
    - _Requirements: 16.2_ — Design: Pure Functions → `fees.ts`
  - [ ]* 12.2 Write property test for `computeApplicationFee` (PURE + TEST)
    - Add `tests/properties/fees.test.ts`.
    - **Property 1: fee bounds** — integer, `0 <= fee <= amountMinor` for any rate in `[0,100]` and any supported currency (incl. zero-decimal jpy/krw); `fee === 0` at rate 0; non-decreasing in rate. Examples: rate 0, rate 100, amount 0.
    - _Requirements: 16.2_
  - [~] 12.3 Add Connect status + booking-permission pure helpers
    - Add `mapConnectStatus(account) -> ConnectStatus` (`{not_started,pending,needs_info,complete,disabled}`; `complete` iff `charges_enabled`) and `bookingAllowed(requiresDeposit, connectStatus)` (true iff `!requiresDeposit || connectStatus === 'complete'`) in the appropriate pure helper modules.
    - _Requirements: 15.1, 15.4, 17.2, 17.3_ — Design: Data Models (ConnectStatus), Stripe Flows (d)
  - [ ]* 12.4 Write property tests for Connect status + booking permission (PURE + TEST)
    - Add `tests/properties/connect.test.ts`.
    - **Property 13: connect status mapping** — total, `complete` iff `charges_enabled`, idempotent (same account twice ⇒ same `connectStatus` + `chargesEnabled`).
    - **Property 14: bookingAllowed** — true iff `requiresDeposit === false` OR `connectStatus === 'complete'`.
    - _Requirements: 15.1, 15.4, 15.5, 17.2, 17.3_

- [ ] 13. Phase 3 Connect model + direct-charge deposit + webhook routing
  - [~] 13.1 Add `connectStatus` to the GroomerProfile model
    - In `src/lib/db/models/groomer-profile.ts`, add `connectStatus: ConnectStatus` enum (default `not_started`) alongside the existing `stripeConnectAccountId` / `stripeConnectChargesEnabled` boolean (kept as the fast "can I charge?" flag).
    - _Requirements: 15.1, 15.4_ — Design: Data Models (ConnectStatus)
  - [~] 13.2 Extend deposit PaymentIntent creation to a direct charge
    - In `src/lib/stripe/helpers.ts`, extend `createDepositPaymentIntent` to load `connectStatus`+`stripeConnectAccountId`, block with a labelled result when not `complete`, else create the PI **on the connected account** (`{ stripeAccount: acct_... }`) with `application_fee_amount = computeApplicationFee(amountMinor, currency, STRIPE_PLATFORM_FEE_PERCENT)` and `automatic_payment_methods`. Persist `PendingBooking` keyed by intent id (unchanged). Reuse `fulfilBookingByPaymentIntentId` unchanged.
    - _Requirements: 16.1, 16.2, 16.4, 17.1_ — Design: Stripe Flows (e)
  - [~] 13.3 Route Connect (account) events in the webhook without breaking deposits
    - In `src/app/api/webhooks/stripe/route.ts`, route by `event.type` AND presence of `event.account`: `account.updated` (Connect) → `handleAccountUpdated` mapping `mapConnectStatus` into `connectStatus` + syncing `stripeConnectChargesEnabled`; direct-charge `payment_intent.succeeded/payment_failed` (now Connect events) still flow to the UNCHANGED deposit fulfilment (keys off PI id regardless of account). Try `STRIPE_WEBHOOK_SECRET` first, fall back to `STRIPE_CONNECT_WEBHOOK_SECRET` only if configured. Reuse `idempotencyOnce(event.id)`.
    - _Requirements: 6.1, 6.2, 6.3, 15.4, 15.5, 16.3, 16.5_ — Design: webhook routing
  - [~] 13.4 Confirm Connect onboarding account-link action (reuse existing)
    - Verify/extend `createConnectAccountLink` to create an Express account (if none) + account link, return the hosted URL, store only `accountId`, optimistically refresh via `accounts.retrieve` on return, and return `connect_not_configured` without throwing when Connect is unconfigured.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_ — Design: Stripe Flows (d)
  - [ ]* 13.5 Write direct-charge + connect webhook integration tests (TEST)
    - Direct-charge PI example fulfils one booking even on duplicate delivery (R16.5); `account.updated` updates `connectStatus`+`chargesEnabled` idempotently; deposit blocked when `connectStatus != complete`.
    - _Requirements: 16.3, 16.5, 15.4, 15.5, 17.1_

- [ ] 14. Phase 3 UI — Connect status card + booking "not set up" state
  - [~] 14.1 Build the Connect status card in Settings
    - Add a Settings card showing the current `connectStatus` (not started / pending / needs info / complete / disabled) with a re-onboarding link that opens hosted onboarding when `needs_info`/`disabled`, and a labelled "payouts not set up yet" state when Connect is unconfigured. DaisyUI tokens, WCAG 2.1 AA, 44px targets.
    - _Requirements: 15.1, 15.2, 15.3, 15.6, 18.2_ — Design: UI
  - [~] 14.2 Add the "online payments not set up yet" state to the public booking page
    - On the public booking page, block deposit-requiring bookings when the groomer's `connectStatus != complete` and show the labelled state; allow no-deposit bookings to proceed; enable deposit bookings automatically once Connect is complete. DaisyUI tokens, WCAG 2.1 AA, 44px targets.
    - _Requirements: 17.1, 17.2, 17.3, 17.4_ — Design: Decision Points Resolved (R17)
  - [~] 14.3 Backfill `connectStatus` for existing profiles
    - Derive `connectStatus` for existing profiles from `stripeConnectChargesEnabled` (`true ⇒ complete`, else `not_started`) via a one-off backfill or lazy on-read default so legacy profiles surface a correct status.
    - _Requirements: 15.1, 15.4_ — Design: Data Models

- [~] 15. Phase 3 verification gate
  - Verify phase: run `npx tsc --noEmit`, `npm test -- --run`, and `npm run build`; fix any failures; commit. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but every pure function in this design has a dedicated property-test task because the correctness properties are the core guarantees.
- Each pure-function task is paired with a `*` property-test task listing the exact invariants (fast-check, `numRuns >= 100`, tagged `Feature: billing-trial-and-payments, Property N: ...`).
- The three phases are gated: do not start a later phase until the prior phase's verification task passes `npx tsc --noEmit`, `npm test -- --run`, and `npm run build` and is committed.
- The webhook extension is additive: existing `payment_intent.*` deposit fulfilment is never modified; new routing is added around it with the event-id idempotency fast-path reused.
- Each task references specific requirement sub-clauses and the design section for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.3", "7.2", "7.4", "7.6", "12.1", "12.3"] },
    { "id": 1, "tasks": ["2.2", "2.4", "7.3", "7.5", "7.7", "12.2", "12.4", "3.1", "4.1", "8.1", "8.2", "13.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.2", "8.3", "13.2", "13.4"] },
    { "id": 3, "tasks": ["4.3", "4.4", "8.4", "9.1", "9.3", "13.3"] },
    { "id": 4, "tasks": ["4.5", "4.6", "9.2", "13.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "9.4", "10.1", "14.1", "14.2", "14.3"] }
  ]
}
```

---

## Operator prerequisites (out of scope for code)

These are operator/setup steps that must be completed outside the codebase; they are intentionally **not** numbered buildable tasks, listed here so nothing is forgotten:

- Register the US-LLC platform entity and enable Stripe Connect on the platform account.
- Provision production Stripe keys (platform secret, webhook signing secret, optional separate Connect webhook secret) and the subscription Price IDs.
- Create the Twilio Verify service (for `TWILIO_VERIFY_SERVICE_SID`) and/or confirm the existing Twilio SMS service for the OTP fallback.
- Configure the live Stripe webhook endpoint(s) in the Stripe Dashboard (platform + Connect events).
- Set up the domain/DNS for `pawxis.app` and the production `NEXT_PUBLIC_APP_URL`.
- Choose/host the maintainable disposable-domains source referenced by `DISPOSABLE_DOMAINS_SOURCE`.
