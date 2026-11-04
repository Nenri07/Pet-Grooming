# Implementation Plan: Email Verify Link Fails

## Overview

Live-site fix for fresh verification links showing "invalid or expired". Tests first (exploration, then preservation), then the fix in priority order: the client double-call fix (`email-confirm-flow` helper + `VerifyEmailClient`), the verified-replay server fix, and finally the Gmail canonical lookup. All automated tests are pure or use `vi.mock`; no Mongo-backed tests.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Verification link succeeds once and stays successful
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: The bug is deterministic, so scope each property to the concrete failing cases from `isBugCondition` in design
  - Create `tests/properties/email-verify-link.test.ts` with fast-check, using `vi.mock` for `next-auth`, `@/lib/db/connect`, `@/lib/db/models/user`, and `@/lib/redis` (in-memory Redis map and in-memory `User` array, same pattern as `tests/verification-provider.test.ts`). No Mongo.
  - Client harness: route all effect simulation through one `effectUnderTest(token, deps)` adapter in the test file. On unfixed code the adapter reproduces the current `VerifyEmailClient` effect body exactly (deps `[token, update, router]`, per-run `cancelled` flag set in cleanup). Task 3.2 repoints this adapter at the fixed wiring; the assertions do not change.
  - effectRerun (`tokenState = 'fresh' AND effectRuns > 1`): for 2–5 effect runs with dependency changes and Strict Mode mount → cleanup → mount interleaved before the first `confirm` resolves, assert `confirm` called exactly once, final phase `success`, `refreshSession` called once, navigations equal `['/onboarding']`
  - verifiedReplay (consumed, well-formed 64-hex token, session = owner, `emailVerifiedAt` set): call `confirmEmailVerification` with no Redis record and assert `{ ok: true }` with no user writes
  - gmailMismatch (fresh token, session `none`/`other`, stored Gmail alias differing from its canonical form, not starting with `.`, exactly one canonical match): reuse the generators from `tests/properties/email.test.ts` (dots, optional `+tag`, `gmail.com`/`googlemail.com`), store the alias, put `{ normalizedEmail: normalizeEmail(alias) }` in Redis, and assert the owner gets `emailVerifiedAt` set, the token is deleted, and no other user changes. Include concrete cases `first.last@gmail.com`, `name+promo@googlemail.com`
  - Run `npx vitest run tests/properties/email-verify-link.test.ts` on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (expected: two `confirm` calls with final phase `error` after an `ok: true`; `expired` for a verified signed-in requester; `User.findOne` called with the canonical email and returning `null` for a Gmail alias)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-buggy verification inputs behave as before
  - **IMPORTANT**: Follow observation-first methodology. Run the UNFIXED action and effect harness for inputs where `isBugCondition` is false, record the outputs, then assert them
  - Add a `Property 2` and a `Property 3` describe block to `tests/properties/email-verify-link.test.ts`, using the same mocks and `effectUnderTest` adapter as task 1
  - Observe and assert: empty or whitespace-only token → missing-token error phase, `confirm` never called (3.2)
  - Observe and assert: random token with no Redis record, requested with no session or an unverified session → `{ ok: false, reason: 'expired', message: MSG_EMAIL_LINK_INVALID }`, no user written; malformed tokens (wrong length, uppercase, non-hex) get the same envelope even for a verified session (3.1, 3.4)
  - Observe and assert: fresh token for a non-Gmail owner, or a Gmail owner stored in canonical form, verifies that one account on both the session and no-session paths, sets `emailVerifiedAt`, and deletes `evf:{token}` (3.5, 3.6). Generators exclude user sets with two rows sharing a canonical email, since that case intentionally changes
  - Observe and assert: Redis unconfigured → "Email verification isn't available right now"; a throwing `User` mock → "Something went wrong" envelope, no throw (3.7, 3.8)
  - **Property 3: Preservation** - A token never verifies a different account
  - Observe and assert: for any token record and random set of stored users, with a different account signed in, the signed-in account's `emailVerifiedAt` is never written, and no account whose `normalizeEmail(email)` differs from `record.normalizedEmail` is ever written (3.3)
  - Run `npx vitest run tests/properties/email-verify-link.test.ts -t "Property 2|Property 3"` on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Fix for verification link showing "invalid or expired" after a successful verify

  - [x] 3.1 Add the pure confirm-flow helper module
    - Create `src/lib/verification/email-confirm-flow.ts` with no React or server imports
    - `isWellFormedVerifyToken(token)`: `/^[0-9a-f]{64}$/.test(token)`
    - `claimConfirm(guard, token)`: return `false` when `guard.current === token`, otherwise set `guard.current = token` and return `true`
    - `runEmailConfirm(token, { confirm, refreshSession, navigate, isActive, setPhase })`: empty/whitespace token → missing-token error without calling `confirm`; thrown `confirm` → generic "Something went wrong" error if `isActive()`; `ok` → `setPhase(success)`, `await refreshSession()` with errors swallowed, then `navigate('/onboarding')` if `isActive()`; `!ok` → error phase with `res.message` if `isActive()`
    - Export the `Phase` type and `MSG_SUCCESS`, `MSG_MISSING_TOKEN`, `MSG_CLIENT_UNEXPECTED`, copied verbatim from `VerifyEmailClient.tsx`
    - Add unit tests in `tests/email-verify-link.test.ts` for `runEmailConfirm`, `claimConfirm`, and `isWellFormedVerifyToken` as listed under Unit Tests in design
    - _Bug_Condition: isBugCondition(X) where X.tokenState = 'fresh' AND X.effectRuns > 1_
    - _Expected_Behavior: at most one server call per page load and token; success phase; one refreshSession; one navigation to /onboarding (Property 1)_
    - _Preservation: missing-token error without a server call; same phase copy and messages (Property 2)_
    - _Requirements: 2.1, 2.2, 3.2_

  - [x] 3.2 Rewire `VerifyEmailClient` to confirm once per page load
    - In `src/app/verify-email/VerifyEmailClient.tsx`, add `confirmedTokenRef`, `mountedRef`, `updateRef`, `routerRef`
    - A `[]` effect declared before the confirm effect sets `mountedRef.current = true` and resets it to `false` in cleanup; an effect with no dependency array keeps `updateRef`/`routerRef` current
    - The confirm effect depends on `[token]` only, starts with `if (!claimConfirm(confirmedTokenRef, token)) return;`, and calls `runEmailConfirm` with `refreshSession: () => updateRef.current()`, `navigate: (href) => routerRef.current.push(href)`, and `isActive: () => mountedRef.current && confirmedTokenRef.current === token`
    - Remove the per-run `cancelled` flag; import `Phase` and the message constants from the helper; leave markup, copy, and links unchanged
    - Repoint the `effectUnderTest` adapter in `tests/properties/email-verify-link.test.ts` to the same ref wiring plus `claimConfirm`/`runEmailConfirm` (assertions unchanged)
    - _Bug_Condition: isBugCondition(X) where X.tokenState = 'fresh' AND X.effectRuns > 1_
    - _Expected_Behavior: Property 1 from design (single confirm, success state, session refresh, route to /onboarding)_
    - _Preservation: three phases, their copy, and their links unchanged (Property 2)_
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.2_

  - [x] 3.3 Treat a replay by a verified signed-in user as success
    - In `src/actions/verification.ts`, add a non-exported async helper `isSessionUserAlreadyVerified()`: `getServerSession(authOptions)`; if `session.user.id`, `connectDB()` and `User.findById(id).select('emailVerifiedAt').lean()`; return whether `emailVerifiedAt` is set
    - In the `!record?.normalizedEmail` branch of `confirmEmailVerification`, return `{ ok: true, message: MSG_EMAIL_VERIFIED }` only when `isWellFormedVerifyToken(token)` and `isSessionUserAlreadyVerified()` are both true; every other case returns the existing `expired` envelope. No writes
    - Keep the Redis-unconfigured check ahead of this logic and keep the existing `try/catch` envelope
    - Add `confirmEmailVerification` unit cases to `tests/email-verify-link.test.ts`: verified replay → `ok: true` with no writes; unauthenticated or unverified replay → `expired`; Redis off → `not_configured`
    - _Bug_Condition: isBugCondition(X) where X.tokenState = 'consumed' AND isWellFormedVerifyToken(X.token) AND X.session = 'owner' AND X.sessionUserVerified_
    - _Expected_Behavior: ok: true with MSG_EMAIL_VERIFIED; nothing written (Property 1)_
    - _Preservation: unauthenticated/unverified/malformed replays still return expired and verify nobody; Redis-unconfigured and error envelopes unchanged (Property 2)_
    - _Requirements: 1.3, 2.3, 3.1, 3.4, 3.7, 3.8_

  - [x] 3.4 Add canonical Gmail lookup helpers
    - In `src/lib/identity/email.ts`, export `canonicalEmailFilter(normalizedEmail): string | RegExp`: exact string for non-Gmail domains or an empty local part; for `gmail.com`, escape each local-part character and build `^c1(\.*c2)...(\.*cn)\.*(\+.*)?@(gmail|googlemail)\.com$`
    - Export `pickCanonicalMatch(candidates, normalizedEmail)`: filter by `normalizeEmail(c.email ?? '') === normalizedEmail`; return `{ kind: 'one', user }` only for exactly one survivor, `{ kind: 'ambiguous' }` for more, `{ kind: 'none' }` for zero
    - Add the `canonicalEmailFilter`/`pickCanonicalMatch` example tests from design to `tests/email-verify-link.test.ts` (aliases that match, near-misses that don't, regex metacharacters `a*b`, `a(b)`, `a$b`, `a[b]`, `a\b`, `a^b`, ambiguous pair)
    - Add helper-level Property 3 properties to `tests/properties/email-verify-link.test.ts`: for any canonical Gmail `e` and stored `s` not starting with `.`, `canonicalEmailFilter(e).test(s) === (normalizeEmail(s) === e)`; for any candidate list, `pickCanonicalMatch` returns `one` only for exactly one canonical match and never returns a non-matching candidate
    - _Bug_Condition: isBugCondition(X) where gmailMismatch holds (fresh token, session none/other, Gmail alias stored, canonicalMatches = 1)_
    - _Expected_Behavior: the regex matches exactly the canonical-equivalent stored emails (Property 1, Property 3)_
    - _Preservation: non-Gmail returns the exact string, same as today (Property 2, Property 3)_
    - _Requirements: 2.4, 3.3, 3.6_

  - [x] 3.5 Use the canonical lookup on the no-session path
    - In `confirmEmailVerification`, replace `User.findOne({ email: record.normalizedEmail })` with `User.find({ email: canonicalEmailFilter(record.normalizedEmail) }).select('_id email').limit(2).lean()` and `pickCanonicalMatch(...)`
    - `one`: `updateOne({ _id }, { $set: { emailVerifiedAt: now } })`, set `matched = true`, token deleted by the existing success path
    - `ambiguous`: `console.warn('[verification] confirmEmailVerification: ambiguous canonical email match, refusing')` with no email or token, return the existing `invalid_code` envelope, keep the token
    - `none`: existing `invalid_code` envelope
    - Update the stale comment above the lookup; leave the session path and `requestEmailVerification`/`resendEmailVerification` untouched
    - Add unit cases: Gmail alias with no session → verified and token deleted; ambiguous → `invalid_code`, no writes, token kept
    - _Bug_Condition: isBugCondition(X) where gmailMismatch holds_
    - _Expected_Behavior: the single account with normalizeEmail(User.email) = record.normalizedEmail is verified and the token deleted (Property 1)_
    - _Preservation: only the canonical owner can be verified; non-Gmail and canonical-form Gmail still verify on both paths; request/resend unchanged (Property 2, Property 3)_
    - _Requirements: 1.4, 2.4, 3.3, 3.5, 3.6, 3.9_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Verification link succeeds once and stays successful
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test (only the `effectUnderTest` adapter was repointed in 3.2)
    - Run `npx vitest run tests/properties/email-verify-link.test.ts -t "Property 1"`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-buggy verification inputs behave as before
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run `npx vitest run tests/properties/email-verify-link.test.ts -t "Property 2|Property 3"`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run `npx tsc --noEmit` and fix any type errors
  - Run `npm run build` and confirm it succeeds
  - Run `npx vitest run tests/email-verify-link.test.ts tests/properties/email-verify-link.test.ts` only. Do not run the full suite; DB-backed tests fail locally for environmental reasons
  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. Commit and push to main
  - In PowerShell, chain with `;`, not `&&`
  - Run `git status` and confirm `.env` and `.env.bak` are not staged
  - Stage only the changed files by name: `git add src/lib/verification/email-confirm-flow.ts src/lib/identity/email.ts src/app/verify-email/VerifyEmailClient.tsx src/actions/verification.ts tests/email-verify-link.test.ts tests/properties/email-verify-link.test.ts .kiro/specs/email-verify-link-fails/`
  - Never stage `.env` or `.env.bak`; do not use `git add -A` or `git add .`
  - `git commit -m "fix(verify-email): confirm token once, accept verified replay, canonical Gmail lookup"`; `git push origin main`

## Notes

- Tasks run sequentially because 3.3 and 3.5 both edit `src/actions/verification.ts`, and 3.2 repoints the shared test adapter.
- Property tests use `fast-check` with Vitest. Run only the two new test files; DB-backed suites fail locally for environmental reasons.
- Manual checks on a Vercel preview (single network call, re-opened link, Gmail alias on another device) are listed under Integration Tests in design and are not automated tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["3.5"] },
    { "id": 7, "tasks": ["3.6", "3.7"] },
    { "id": 8, "tasks": ["4"] },
    { "id": 9, "tasks": ["5"] }
  ]
}
```
