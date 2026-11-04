# Email Verify Link Fails Bugfix Design

## Overview

A fresh verification link shows "Verification failed" because the `/verify-email` page sends the one-time token twice. The first `confirmEmailVerification` call verifies the user and deletes the token. The confirm effect in `VerifyEmailClient.tsx` lists `update` (from `useSession`) and `router` as dependencies. When the session finishes loading, `update` changes identity, the effect cleanup sets `cancelled = true` (which throws away the first call's success), and the effect runs again. The second call finds no token and returns the "invalid or expired" error.

Two related defects are fixed in the same change:

- A consumed token presented again by a signed-in user who is already verified returns an error instead of success.
- With no matching session, the server looks up the user with `User.findOne({ email: record.normalizedEmail })`. `record.normalizedEmail` is the canonical form (Gmail dots and `+tag` removed, `googlemail.com` rewritten to `gmail.com`), but `User.email` is only lowercased and trimmed, so stored addresses like `first.last@gmail.com` never match.

Fix strategy, kept to small diffs in two files plus two pure helper modules:

1. Client: confirm at most once per page load per token (a `useRef` guard), stop using a per-effect `cancelled` flag to discard results, and read `update`/`router` through refs so they no longer re-trigger the confirm.
2. Server, token missing: if the request has a signed-in user whose `emailVerifiedAt` is already set, return success. Otherwise return the same error as today. No Redis "consumed" marker is added (decision recorded in the requirements phase: the confirm runs from a client `useEffect` through a server action, so link scanners that don't run JavaScript can't burn the token).
3. Server, no matching session: find candidates whose stored email can canonicalize to the token's email (exact string for non-Gmail, an escaped anchored regex for Gmail), then confirm each candidate with `normalizeEmail(u.email) === record.normalizedEmail`. Exactly one match is verified. More than one match is refused.

## Glossary

- **Bug_Condition (C)**: The set of verification-page loads and confirm requests that end in the "invalid or expired" error even though the user is, or should become, verified. Formalized in `isBugCondition` below.
- **Property (P)**: The expected outcome for inputs in C: the token is sent at most once per page load, the user ends verified, the page shows "Email verified", the session is refreshed, and the user is routed to `/onboarding`.
- **Preservation**: Every input outside C (missing, malformed, never-issued, or expired tokens; unauthenticated or unverified replays; wrong-account sessions; Redis unconfigured; server errors; request/resend) behaves exactly as before.
- **F / F'**: The original and fixed code paths (`VerifyEmailClient` effect + `confirmEmailVerification`).
- **VerifyEmailClient**: The client component in `src/app/verify-email/VerifyEmailClient.tsx` that reads `?token=` and calls the server action.
- **confirmEmailVerification**: The server action in `src/actions/verification.ts` that reads `evf:{token}` from Redis, sets `User.emailVerifiedAt`, and deletes the token.
- **EmailVerifyRecord**: The Redis value `{ normalizedEmail }` stored under `keys.emailVerify(token)` by `requestEmailVerification`.
- **Canonical email**: The output of `normalizeEmail` in `src/lib/identity/email.ts`. For `gmail.com`/`googlemail.com` it strips local-part dots, drops everything from the first `+`, and rewrites the domain to `gmail.com`. Other domains are only lowercased and trimmed.
- **Stored email**: `User.email`, which the schema lowercases and trims (`lowercase: true, trim: true`) but does not canonicalize. There is no normalized-email field on `User`, and registration does not enforce canonical uniqueness, so two `User` rows can share a canonical email.
- **Replay**: A confirm request whose token no longer exists in Redis because it was already consumed (or expired).
- **Page load**: One mount of `VerifyEmailClient`, including React Strict Mode's simulated unmount/remount, which preserves refs.

## Bug Details

### Bug Condition

The bug shows up in three ways:

- **Effect re-run (1.1, 1.2)**: The confirm effect depends on `[token, update, router]`. `next-auth`'s `SessionProvider` rebuilds the context value (including `update`) when the session changes from `loading` to `authenticated`/`unauthenticated`. That re-runs the effect. The cleanup sets `cancelled = true` on the first run, so its successful result is dropped, and the second run sends the token again.
- **Replay by a verified owner (1.3)**: When `cacheGet(keys.emailVerify(token))` returns nothing, the action returns `reason: 'expired'` without checking whether the requester is already verified.
- **Gmail canonical mismatch (1.4)**: On the no-session (or other-session) path, `User.findOne({ email: record.normalizedEmail })` compares the canonical email to the stored email, so Gmail aliases with dots, `+tag`, or `googlemail.com` never match.

**Formal Specification:**
```
TYPE VerifyAttempt = {
  token:          string                 // value of ?token=
  tokenState:     'fresh' | 'consumed' | 'expired' | 'never_issued' | 'malformed' | 'missing'
  effectRuns:     integer >= 1           // times the confirm effect body runs in one page load
  session:        'none' | 'owner' | 'other'
  sessionUserVerified: boolean           // DB emailVerifiedAt of the session user is set
  ownerStoredEmail:    string            // User.email of the account the token was issued for
  canonicalMatches:    integer           // count of User rows with normalizeEmail(email) = record.normalizedEmail
}

FUNCTION isBugCondition(X)
  INPUT: X of type VerifyAttempt
  OUTPUT: boolean

  // 1.1 / 1.2: a fresh link whose confirm effect runs more than once
  effectRerun := X.tokenState = 'fresh' AND X.effectRuns > 1

  // 1.3: a consumed, well-formed token replayed by the signed-in owner who is already verified
  verifiedReplay := X.tokenState = 'consumed'
                    AND isWellFormedVerifyToken(X.token)
                    AND X.session = 'owner'
                    AND X.sessionUserVerified

  // 1.4: a fresh link on the no-session / other-session path for a Gmail alias
  gmailMismatch := X.tokenState = 'fresh'
                   AND X.session IN {'none', 'other'}
                   AND domainOf(X.ownerStoredEmail) IN {'gmail.com', 'googlemail.com'}
                   AND X.ownerStoredEmail != normalizeEmail(X.ownerStoredEmail)
                   AND NOT startsWith(X.ownerStoredEmail, '.')
                   AND X.canonicalMatches = 1

  RETURN effectRerun OR verifiedReplay OR gmailMismatch
END FUNCTION
```

The server cannot tell which account a deleted token belonged to, because the record is gone. The implementation therefore treats "signed-in user is already verified" as the stand-in for "the owner is verified" (Requirement 2.3 / 3.4). This verifies nobody and reveals nothing: the success message only restates the requester's own state.

### Examples

- **Effect re-run (production)**: A groomer signed in on the same browser clicks a fresh link. The network tab shows two `confirmEmailVerification` calls with the same token. Expected: one call, "Email verified", then `/onboarding`. Actual: "Verification failed — That verification link is invalid or has expired" and a "Request a new link" button, while `emailVerifiedAt` is set in the database.
- **Strict Mode (dev)**: The effect runs, cleans up, and runs again on mount. Expected: one server call and success. Actual: two calls; the first result is discarded and the second fails.
- **Re-opened link**: A verified, signed-in groomer opens the same link a second time. Expected: "Email verified" and `/onboarding`. Actual: "invalid or expired" error.
- **Gmail alias, other device**: A groomer registered as `first.last@gmail.com` opens a fresh link in a browser with no session. The token stores `firstlast@gmail.com`. Expected: the account is verified. Actual: `findOne({ email: 'firstlast@gmail.com' })` finds nothing and the page shows the error. The same happens for `name+tag@gmail.com` and `name@googlemail.com`.
- **Edge, ambiguous canonical email**: Two accounts `ab@gmail.com` and `a.b@gmail.com` exist and the link is opened with no session. Expected after the fix: refuse with the existing "invalid or expired" message and verify neither account. The groomer can sign in and open the link again, and the session path then verifies the right account.
- **Edge, verified user opens a garbage link**: `/verify-email?token=abc` while signed in and verified. Expected: unchanged error, because the token is not 64 lowercase hex characters.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A token that never existed, is malformed, or has expired shows "Verification failed — That verification link is invalid or has expired. Please request a new one." with "Request a new link" when the requester is not a signed-in, already-verified user (3.1).
- A missing or empty `?token=` shows the missing-token error and never calls the server action (3.2).
- A different signed-in account never has `emailVerifiedAt` set; only the account whose canonical email equals `record.normalizedEmail` can be verified (3.3).
- A replayed or consumed token from an unauthenticated request, or from a signed-in user who is not yet verified, returns the "invalid or expired" error and marks nobody verified (3.4).
- A successful confirm still sets `emailVerifiedAt` and deletes `evf:{token}` (3.5).
- Non-Gmail addresses, and Gmail addresses already stored in canonical form, are verified on both the session and no-session paths. The one change is the pathological case of two `User` rows sharing a canonical email, which is now refused on the no-session path instead of verifying the exact-string row (3.6).
- Redis not configured returns "Email verification isn't available right now", checked before any token or replay logic (3.7).
- Unexpected server errors return the "Something went wrong" message and never throw (3.8).
- `requestEmailVerification` and `resendEmailVerification` are not modified: same token creation, 60-second cooldown, and link format (3.9).

**Scope:**
All inputs where `isBugCondition` is false must behave as before. This includes:
- Fresh links whose effect runs exactly once with a matching session (already working today).
- Missing, empty, malformed, never-issued, and expired tokens for unauthenticated or unverified requesters.
- Replays by unauthenticated requests or unverified signed-in users.
- Fresh links opened while a different account is signed in, for non-Gmail or canonical-form Gmail owners.
- Redis-unconfigured and server-error paths.
- Request and resend actions.
- Page rendering: the three phases (`verifying`, `success`, `error`), their copy, and their links stay the same.

## Hypothesized Root Cause

1. **Effect dependencies re-trigger the confirm**: `React.useEffect(..., [token, update, router])`. `useSession().update` is part of the `SessionProvider` context value, which is recreated when the session status changes. `useRouter()` from `next/navigation` is not guaranteed stable either. Either change re-runs the effect body, which calls the action again.
   - The production network trace (two action calls with the same token, then a session request) matches this.
   - React Strict Mode in dev runs effects twice on mount, which hits the same path.

2. **Cleanup discards an in-flight success**: The `cancelled` flag is local to each effect run. When the first run is cleaned up, its result (`ok: true`) is ignored, so neither `setPhase(success)` nor `router.push('/onboarding')` happens. Only the second (failing) result is rendered.

3. **No replay handling on the server**: When the Redis record is missing, `confirmEmailVerification` returns `expired` immediately without looking at the session. A verified owner replaying the link is treated like an attacker with a stale token.

4. **Canonical-vs-stored email comparison**: The no-session lookup `User.findOne({ email: record.normalizedEmail })` assumes the stored email equals the canonical email. That is true for non-Gmail domains (where canonicalization is only lowercase and trim) and false for Gmail aliases. The code comment already describes "scan the small set and compare canonically", but the code doesn't do it.

## Correctness Properties

Property 1: Bug Condition - Verification link succeeds once and stays successful

_For any_ verification attempt where the bug condition holds (isBugCondition returns true), the fixed page and action SHALL send the token to the server at most once per page load and per token, mark the token's owner as verified (or report the already-verified owner as verified on a replay), render the "Email verified" success state, call the session `update()` once, and route to `/onboarding` once while the page is still mounted, regardless of how many times the confirm effect runs or in what order dependency changes arrive. For Gmail aliases on the no-session or other-session path, the single account whose `normalizeEmail(User.email)` equals the token's `normalizedEmail` SHALL be verified and the token deleted.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-buggy verification inputs behave as before

_For any_ verification attempt where the bug condition does NOT hold (isBugCondition returns false), the fixed code SHALL produce the same result envelope, rendered phase, message, and database/Redis side effects as the original code. That covers missing tokens (no server call), malformed/never-issued/expired tokens and replays from unauthenticated or unverified requesters (the "invalid or expired" error, nothing verified), Redis-unconfigured and unexpected-error envelopes, successful confirms that set `emailVerifiedAt` and delete the token, and unchanged request/resend behavior.

**Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

Property 3: Preservation - A token never verifies a different account

_For any_ token record and any set of stored `User` emails, the fixed no-session lookup SHALL select an account only when exactly one candidate satisfies `normalizeEmail(candidate.email) === record.normalizedEmail`, SHALL select nothing when zero or more than one candidate satisfies it, and the Gmail candidate pattern SHALL match a stored email (one not starting with `.`) if and only if that email canonicalizes to the token's `normalizedEmail`. The session path SHALL continue to update only the signed-in user, and only when that user's canonical email matches.

**Validates: Requirements 2.4, 3.3, 3.6**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct:

**File**: `src/lib/identity/email.ts` (pure, add exports)

**Functions**: `canonicalEmailFilter`, `pickCanonicalMatch`

**Specific Changes**:
1. **`canonicalEmailFilter(normalizedEmail: string): string | RegExp`**: Returns the Mongo `email` filter value for candidates that may canonicalize to `normalizedEmail`.
   - Non-Gmail canonical domain, or an empty canonical local part: return `normalizedEmail` as-is (exact match, same as today).
   - `gmail.com` canonical: split the local part into characters `c1..cn`, escape each with `s.replace(/[.*+?^${}()|[\]\\\-\/]/g, '\\$&')`, and build `^c1(\.*c2)...(\.*cn)\.*(\+.*)?@(gmail|googlemail)\.com$`. The literal first character gives Mongo an index-bounded prefix scan on the unique `email` index. The pattern has no nested quantifiers, and its length is bounded by the 254-character email limit.
   - Accepted limitation: stored addresses that start with `.` are not matched. Gmail does not issue such addresses, and they fail today anyway.
2. **`pickCanonicalMatch<T extends { email?: string }>(candidates: T[], normalizedEmail: string): { kind: 'none' } | { kind: 'one'; user: T } | { kind: 'ambiguous' }`**: Filters candidates with `normalizeEmail(c.email ?? '') === normalizedEmail` and returns `one` only for exactly one survivor. This is the authoritative check; the regex only narrows the query.

**File**: `src/lib/verification/email-confirm-flow.ts` (new, pure, no React or server imports)

**Functions**: `isWellFormedVerifyToken`, `claimConfirm`, `runEmailConfirm`

**Specific Changes**:
3. **`isWellFormedVerifyToken(token: string): boolean`**: `/^[0-9a-f]{64}$/.test(token)`, matching `randomBytes(32).toString('hex')`. It lives here (not in the `'use server'` file, which may only export async functions) so both the action and tests can import it.
4. **`claimConfirm(guard: { current: string | null }, token: string): boolean`**: Returns `false` if `guard.current === token`. Otherwise it sets `guard.current = token` and returns `true`.
5. **`runEmailConfirm(token, deps): Promise<void>`**: Moves the effect body out of the component with injected dependencies `{ confirm, refreshSession, navigate, isActive, setPhase }`, and exports the `Phase` type plus `MSG_SUCCESS`, `MSG_MISSING_TOKEN`, `MSG_CLIENT_UNEXPECTED`.
   - Empty or whitespace token: `setPhase(error, MSG_MISSING_TOKEN)` and return without calling `confirm`.
   - `confirm({ token })`; on throw, set the error phase to "Something went wrong. Please try again in a moment." if `isActive()`.
   - On `ok`: `setPhase(success)`, `await refreshSession()` (errors swallowed as today), then `navigate('/onboarding')` if `isActive()`.
   - On `!ok`: `setPhase(error, res.message)` if `isActive()`.

**File**: `src/app/verify-email/VerifyEmailClient.tsx`

**Function**: `VerifyEmailClient`

**Specific Changes**:
6. **Once-per-load guard**: `const confirmedTokenRef = React.useRef<string | null>(null)`. The confirm effect depends on `[token]` only and starts with `if (!claimConfirm(confirmedTokenRef, token)) return;`. Refs survive Strict Mode's simulated remount, so the second run is skipped.
7. **Stable callbacks through refs**: `updateRef`/`routerRef` are kept current by an effect with no dependency array (`updateRef.current = update; routerRef.current = router;`). The confirm passes `refreshSession: () => updateRef.current()` and `navigate: (href) => routerRef.current.push(href)`. `update` and `router` are removed from the confirm effect's dependencies.
8. **No result discarding on cleanup**: Replace the per-run `cancelled` flag with a `mountedRef` set to `true`/`false` by a `[]` effect declared before the confirm effect. `isActive = () => mountedRef.current && confirmedTokenRef.current === token`. Strict Mode sets `mountedRef` back to `true` on remount, so the in-flight success is applied. A real unmount, or a client navigation to a different token, suppresses stale navigation and state updates.
9. Render markup, copy, and links stay unchanged. The local `Phase` type and message constants are imported from the helper module.

**File**: `src/actions/verification.ts`

**Function**: `confirmEmailVerification`

**Specific Changes**:
10. **Replay as success for a verified signed-in user**: In the `!record?.normalizedEmail` branch, before returning `expired`, check `isWellFormedVerifyToken(token)`. If it passes, call `getServerSession(authOptions)`. When there is a `session.user.id`, run `connectDB()` and `User.findById(id).select('emailVerifiedAt').lean()`. If `emailVerifiedAt` is set, return `{ ok: true, message: MSG_EMAIL_VERIFIED }`. Every other case returns the existing `expired` envelope. Nothing is written. This logic goes in a non-exported async helper `isSessionUserAlreadyVerified()` inside the file.
11. **Canonical no-session lookup**: Replace `User.findOne({ email: record.normalizedEmail })` with `User.find({ email: canonicalEmailFilter(record.normalizedEmail) }).select('_id email').limit(2).lean()`, then `pickCanonicalMatch(...)`.
    - `one`: `updateOne({ _id }, { $set: { emailVerifiedAt: now } })` and `matched = true`.
    - `ambiguous`: **refuse**. Log `console.warn('[verification] confirmEmailVerification: ambiguous canonical email match, refusing')` with no email or token, and fall through to the existing `invalid_code` envelope. The token is not deleted, so the owner can sign in and reuse the link through the session path.
    - `none`: existing `invalid_code` envelope.
    - `limit(2)` is enough to detect ambiguity because the regex matches exactly the canonical-equivalent stored emails (Property 3).
12. The session path, the Redis-unconfigured check, token deletion on success, the `try/catch` envelope, and all other actions stay unchanged. Update the stale comment above the lookup.

## Testing Strategy

### Validation Approach

Testing has two phases. First, run tests against the unfixed code to produce counterexamples that confirm the root causes. Then verify that the fix satisfies Property 1 and leaves non-buggy inputs unchanged (Properties 2 and 3). Mongo-backed tests fail locally, so all automated tests are pure or use `vi.mock` (the pattern used in `tests/stripe-connect.test.ts` and `tests/verification-provider.test.ts`) for `next-auth`, `@/lib/db/connect`, `@/lib/db/models/user`, and `@/lib/redis`. Build checks are `npx tsc --noEmit` and `npm run build`; `npm test` runs `vitest run`.

### Exploratory Bug Condition Checking

**Goal**: Produce counterexamples that demonstrate the bug BEFORE implementing the fix, and confirm or refute the root cause analysis. If the analysis is refuted, re-hypothesize.

**Test Plan**: Use `vi.mock` to exercise `confirmEmailVerification` with an in-memory Redis map and an in-memory `User` array. Exercise the unfixed client logic by simulating the old effect: each run gets its own `cancelled` flag, and a dependency change triggers cleanup plus a re-run while the first call is still pending. Run these against the UNFIXED code.

**Test Cases**:
1. **Effect re-run discards success**: Simulate the old effect, resolve the first `confirm` after a dependency change, then run the second. Expect two calls and a final `error` phase (will fail on unfixed code).
2. **Strict Mode double effect**: Mount, clean up, re-mount with the old logic. Expect two server calls (will fail on unfixed code).
3. **Verified replay**: Signed-in user with `emailVerifiedAt` set, token absent from Redis. Expect `ok: false, reason: 'expired'` from the unfixed action (will fail the fixed expectation).
4. **Gmail alias, no session**: Stored `first.last@gmail.com`, token record `firstlast@gmail.com`, no session. Expect `invalid_code` and no update on unfixed code (will fail on unfixed code).
5. **googlemail + tag, no session**: Stored `name+promo@googlemail.com`, record `name@gmail.com` (may fail on unfixed code).

**Expected Counterexamples**:
- Two `confirm` calls with the same token, with the final phase `error` after a recorded `ok: true`.
- `expired` returned for a verified signed-in requester.
- `User.findOne` receiving the canonical email and returning `null` for a Gmail alias.
- Possible causes: effect dependency churn (`update`/`router`), per-run cancellation discarding results, missing replay handling, comparing canonical email to stored email.

### Fix Checking

**Goal**: Verify that for every input where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := runFixedFlow(X)          // fixed client flow + fixed action over mocked stores
  ASSERT result.serverCalls <= 1
  ASSERT result.finalPhase.kind = 'success'
  ASSERT result.refreshSessionCalls = 1 AND result.navigations = ['/onboarding']
  ASSERT ownerVerified(result.users)
  ASSERT onlyOwnerChanged(result.users)
END FOR
```

### Preservation Checking

**Goal**: Verify that for every input where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT originalFlow(X).envelope    = fixedFlow(X).envelope
  ASSERT originalFlow(X).finalPhase  = fixedFlow(X).finalPhase
  ASSERT originalFlow(X).users       = fixedFlow(X).users
  ASSERT originalFlow(X).redisKeys   = fixedFlow(X).redisKeys
END FOR
```

**Testing Approach**: Property-based testing (fast-check, already a dev dependency) is recommended for preservation checking because:
- It generates many test cases automatically across the input domain.
- It catches edge cases that manual unit tests might miss.
- It gives strong evidence that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe the unfixed code's behavior for non-buggy inputs (missing/malformed/expired tokens, unauthenticated and unverified replays, non-Gmail and canonical-form owners, Redis off, thrown errors), then write property tests that assert the fixed code matches.

**Test Cases**:
1. **Missing token preservation**: For empty and whitespace-only tokens, the action is never called and the phase is the missing-token error.
2. **Invalid/expired preservation**: For random tokens with no Redis record, requested by no session or an unverified session, the envelope is `{ ok: false, reason: 'expired', message: MSG_EMAIL_LINK_INVALID }` and no user is written. Malformed tokens get the same envelope even for a verified session.
3. **Non-Gmail and canonical Gmail preservation**: For random non-Gmail addresses, `canonicalEmailFilter` returns the exact string, and the no-session path verifies the same single account as the original code.
4. **Wrong-account session preservation**: With a different signed-in account, that account's `emailVerifiedAt` is never written.
5. **Successful confirm side effects**: `emailVerifiedAt` is set and `evf:{token}` is deleted.
6. **Redis unconfigured / thrown error**: Envelopes match the original messages exactly.

### Unit Tests

New file `tests/email-verify-link.test.ts`:
- `runEmailConfirm`: success path calls `confirm` once, sets success, calls `refreshSession` once, navigates to `/onboarding`. A rejected `refreshSession` still navigates. Error envelope sets the error phase with the server message. A thrown `confirm` sets the generic message. `isActive() === false` suppresses navigation.
- `claimConfirm`: the first claim for a token returns `true`, repeats return `false`, and a new token returns `true`. A simulated Strict Mode mount → cleanup → mount, plus a dependency change, results in exactly one `confirm` call and a final success phase.
- `isWellFormedVerifyToken`: accepts 64 lowercase hex characters; rejects empty, 63/65 characters, uppercase, and non-hex.
- `canonicalEmailFilter` / `pickCanonicalMatch`: examples `first.last@gmail.com`, `name+tag@gmail.com`, `name@googlemail.com`, `n.a.m.e+x@googlemail.com` match `name@gmail.com`-style records. `namex@gmail.com`, `nam@gmail.com`, `name@gmail.co`, and `name@evilgmail.com` do not. Local parts containing regex metacharacters (`a*b`, `a(b)`, `a$b`, `a[b]`, `a\b`, `a^b`) are escaped and match only themselves. Two canonical matches return `ambiguous`.
- `confirmEmailVerification` with `vi.mock`: verified replay → `ok: true` with no writes; unauthenticated or unverified replay → `expired`; Gmail alias with no session → verified and token deleted; ambiguous → `invalid_code` with no writes and the token kept; Redis off → `not_configured`.

### Property-Based Tests

New file `tests/properties/email-verify-link.test.ts`:
- **Property 1**: For any number of effect runs (1–5) and any interleaving of dependency changes and Strict Mode remounts before the confirm resolves, `confirm` is called exactly once and the final phase is success with one navigation. For any base local part, dot insertion, optional `+tag`, and `gmail.com`/`googlemail.com` host (reusing the generators from `tests/properties/email.test.ts`), the stored alias matches `canonicalEmailFilter(normalizeEmail(alias))`, and `pickCanonicalMatch` returns it.
- **Property 2**: For random non-bug inputs (missing/malformed/expired tokens, unauthenticated or unverified requesters, non-Gmail owners), the fixed mocked action returns the same envelope and side effects as a reference model of the original action.
- **Property 3**: For any canonical Gmail email `e` and any stored email `s` not starting with `.`, `canonicalEmailFilter(e).test(s) === (normalizeEmail(s) === e)`. For any random candidate list, `pickCanonicalMatch` returns `one` only when exactly one candidate canonicalizes to `e`, and never returns a candidate that doesn't.

### Integration Tests

- Manual check on a Vercel preview with Upstash and Mongo configured: sign up, click the link in the same browser, and confirm one `confirmEmailVerification` request in the Network tab, the "Email verified" state, then `/onboarding`.
- Manual: open the same link again while signed in and verified, and confirm "Email verified". Open it in a private window (no session), and confirm the existing error.
- Manual: register a `first.last+test@gmail.com` account, open the link in a different browser with no session, and confirm the account is verified (`emailVerifiedAt` set) and the middleware stops redirecting to `/verify-pending` after sign-in.
- `next dev` (Strict Mode on): load a fresh link and confirm a single server-action call.
- Optional, CI only: a `mongodb-memory-server` test of the no-session lookup to confirm the regex filter uses the `email` index. It is skipped locally because Mongo-backed tests fail on this machine.
