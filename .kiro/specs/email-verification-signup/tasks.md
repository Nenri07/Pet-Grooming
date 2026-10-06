# Implementation Plan: Email Verification Signup Gate

## Overview

Wire the existing magic-link email verification into signup and route
protection. Build the session claim and middleware gate first (the foundation
everything else routes through), then the verification-pending screen and its
resend action, then the registration/verify-email wiring, then the trial
pipeline change and the one-time backfill. The language is TypeScript (the
design uses the existing TS codebase — no pseudocode).

Each sub-task names the file(s) it touches and the requirement(s) it satisfies.
Test sub-tasks are marked `*` (optional). Property tests reference the design's
Correctness Properties.

## Tasks

- [x] 1. Add the `emailVerified` session claim
  - [x] 1.1 Augment NextAuth types with `emailVerified`
    - In `src/types/next-auth.d.ts`, add `emailVerified: boolean` to `Session.user` and `emailVerified?: boolean` to the `JWT` interface, with doc comments.
    - _Requirements: 5.4_

  - [x] 1.2 Stamp `emailVerified` in the jwt + session callbacks
    - In `src/lib/auth/config.ts`, add a refresh block in the `jwt` callback that reads `User.emailVerifiedAt` and sets `token.emailVerified` whenever `!!user || trigger === 'update' || token.emailVerified !== true`; catch errors without throwing. Project `token.emailVerified` onto `session.user.emailVerified` in the `session` callback.
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ]* 1.3 Unit test the jwt stamp flip
    - Assert an unverified token flips to verified on `trigger === 'update'` and stays verified without re-querying afterward.
    - _Requirements: 5.4_

- [x] 2. Extend the middleware access gate
  - [x] 2.1 Add verification-route helpers and the `emailVerified` rule to `resolveRedirect`
    - In `src/middleware.ts`, add `/verify-pending` + `/verify-email` route helpers, add an `emailVerified: boolean | undefined` param to `resolveRedirect`, insert the unverified→`/verify-pending` rule after the auth-route rule and before the onboarding rule, make the auth-route branch prefer `/verify-pending` when unverified, and preserve the no-self-redirect invariant. Pass `token?.emailVerified` from the `withAuth` wrapper and add `/verify-pending` to the matcher.
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 5.1, 5.2, 5.5_

  - [ ]* 2.2 Property test: unverified users always routed to pending
    - **Property 1: Unverified authenticated users are always routed to the pending screen**
    - **Validates: Requirements 2.1, 2.2, 5.1**

  - [ ]* 2.3 Property test: verification routes allowed through
    - **Property 2: Verification routes are always allowed through for unverified users**
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 2.4 Property test: verified routing unchanged + no self-redirect
    - **Property 3: Verified routing is never weakened**
    - **Property 4: The redirect function never redirects a path to itself**
    - **Validates: Requirements 2.4, 5.2, 5.5**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure the type augmentation, callbacks, and middleware compile and all tests pass; ask the user if questions arise.

- [x] 4. Resend cooldown action + Redis key
  - [x] 4.1 Add the resend-cooldown Redis key and TTL
    - In `src/lib/redis.ts`, add `emailVerifyResend: (normalizedEmail) => \`evf:rl:${normalizedEmail}\`` to `keys` and `EMAIL_VERIFY_RESEND: 60` to `TTL`.
    - _Requirements: 9.3, 10.1_

  - [x] 4.2 Implement `resendEmailVerification` wrapper
    - In `src/actions/verification.ts`, add `resendEmailVerification()` that requires a session, normalizes the user's email, does `SET NX EX 60` on the resend key (returning `{ ok:false, reason:'cooldown', retryAfterSec }` when not acquired), fails open if Redis is unavailable, then delegates to `requestEmailVerification` and maps its envelope. Export the `ResendCooldownResult` type.
    - _Requirements: 3.3, 3.4, 9.3, 10.1_

  - [ ]* 4.3 Property test: resend cooldown idempotent within window
    - **Property 6: Resend cooldown is idempotent within the window**
    - **Validates: Requirements 3.4, 10.1, 9.3**

- [x] 5. Verification-pending screen
  - [x] 5.1 Create the server shell `src/app/verify-pending/page.tsx`
    - Resolve the session, load the user's email, render `VerifyPendingClient` with the email; `dynamic = 'force-dynamic'`; public shell mirroring `verify-email/page.tsx`.
    - _Requirements: 3.1_

  - [x] 5.2 Create `src/app/verify-pending/VerifyPendingClient.tsx`
    - Client component: auto-invoke `resendEmailVerification` once on mount (ref-guarded against StrictMode double-mount), show the email, a resend button disabled while in flight and during cooldown (with remaining-seconds countdown), and map envelopes to states (`delivered`, `delivered:false` accepted-unconfirmed, `cooldown`, `not_configured` recoverable).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 1.3, 1.5, 10.4_

  - [ ]* 5.3 Unit test the pending-screen state machine
    - Auto-send-once, resend disabled in flight, cooldown countdown, each envelope → state mapping.
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 6. Wire registration and link-confirmation redirects
  - [x] 6.1 Point registration at the pending screen
    - In `src/app/(auth)/register/RegisterForm.tsx`, change the post-signIn `router.push(onboardingUrl)` to `router.push('/verify-pending')`; keep the Google `callbackUrl` claim handling unchanged.
    - _Requirements: 1.1, 1.2, 10.4_

  - [x] 6.2 Refresh session and route after link confirmation
    - In `src/app/verify-email/VerifyEmailClient.tsx`, on success call `update()` from `next-auth/react` then `router.push('/onboarding')`; repoint the invalid/expired recovery link from `/start-trial` to `/verify-pending`.
    - _Requirements: 4.3, 4.4, 5.3, 5.4_

- [x] 7. Google OAuth verified-at-provision
  - [x] 7.1 Set `emailVerifiedAt` in `provisionGoogleUser`
    - In `src/lib/auth/config.ts`, set `emailVerifiedAt: new Date()` on OAuth user create, and set it when an existing/linked user's `emailVerifiedAt` is null; leave non-null values unchanged.
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 7.2 Unit test provisionGoogleUser verified stamping
    - Create sets it; link-when-null sets it; non-null preserved.
    - _Requirements: 7.2_

- [x] 8. Trial pipeline: email required, phone conditional
  - [x] 8.1 Make Gate 5 conditional on `isTwilioVerifyConfigured()`
    - In `src/actions/trial.ts`, import `isTwilioVerifyConfigured`; when configured, enforce the phone gate as today and compute `phoneHash`; when unconfigured, skip the gate and set `phoneHash = null`. Keep Gate 4 (email) as a hard requirement. Adjust Gate 7 identity-binding to bind on normalized email when `phoneHash` is null so the one-trial-per-identity guarantee holds without a phone.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 9.4_

  - [ ]* 8.2 Property test: phone gate tracks Twilio config
    - **Property 5: Phone gate enforcement tracks Twilio configuration**
    - Extract the gate decision into a pure helper so it can be tested without pipeline I/O.
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 8.3 Integration test: remaining gates run when phone skipped
    - With Twilio unconfigured, verify velocity/identity-binding/provisioning still run and disposable/rate-limit protections remain.
    - _Requirements: 6.4, 6.5_

- [x] 9. Grandfathering backfill
  - [x] 9.1 Write `scripts/backfill-email-verified.ts`
    - Mirror `scripts/backfill-trial-deadline.ts`: connect to Mongo, `updateMany` users where `isActive:true` and `emailVerifiedAt` is null/absent, setting it to `createdAt` (fallback `new Date()`); leave non-null unchanged; log the modified count and exit.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 9.2 Integration test the backfill selection
    - Against a test DB: only active+null users updated; non-null preserved; inactive untouched.
    - _Requirements: 8.3, 8.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass and the build compiles; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property tests use `fast-check` (do not hand-roll generators), run minimum 100 iterations, and are tagged `Feature: email-verification-signup, Property N: {property text}`.
- The backfill script (9.1) is run once at deploy time; it is not wired into any runtime path.
- No schema changes: the feature reuses `User.emailVerifiedAt` and existing Redis keys.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "7.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "4.2", "8.1", "7.2", "9.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "5.1", "8.2", "8.3", "4.3"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "5.2", "6.1", "6.2"] },
    { "id": 4, "tasks": ["5.3"] }
  ]
}
```
