# Bugfix Requirements Document

## Introduction

On the live site (pawxis.app), a new groomer who clicks the "Verify" link in their verification email (`/verify-email?token=<64 hex>`) sees "Verification failed — That verification link is invalid or has expired. Please request a new one." even when the link is fresh. The browser's Network tab shows two server-action calls with the same token, then a session request, then a prefetch of `/verify-pending`.

The verification page sends the token twice. The first call succeeds: it sets the user's verified timestamp and burns the one-time token. The page throws that success result away when the confirm effect re-runs, which happens when the session finishes loading and its `update` function changes identity. The second call finds the token already used and returns the "invalid or expired" error. The user is verified in the database but is told the link failed, and is pointed at "Request a new link" instead of onboarding.

The same failure appears whenever a used token is replayed: email link scanners, double-clicks, re-opening the link, or React Strict Mode double effects. A separate defect affects Gmail users who open the link with no session (another browser or device). The token stores the canonical email (dots and `+tag` removed for Gmail), but the user lookup compares it to the stored email, which is only lowercased and trimmed. An address like `first.last@gmail.com` never matches, so the link fails.

Impact: new groomers are blocked or confused at the first step of onboarding, and some open a support request or abandon the trial.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a groomer opens a fresh, valid verification link and the page's confirm effect runs more than once for the same token (for example, because the session finishes loading after mount) THEN the system discards the successful first confirmation, sends the same token a second time, and shows "Verification failed — That verification link is invalid or has expired" even though the account is now verified

1.2 WHEN a groomer opens a fresh, valid verification link and the page's confirm effect runs more than once for the same token THEN the system offers "Request a new link" (to `/verify-pending`) instead of routing the now-verified user to `/onboarding`

1.3 WHEN a verification token that was already consumed is presented again for an account that is already verified (re-opening the link, a double-click, an email link scanner pre-fetching it, or a Strict Mode double effect) THEN the system returns the "invalid or expired" error instead of reporting the account as verified

1.4 WHEN a valid verification link is opened with no signed-in session (or with a session for a different account) and the account's email is a Gmail-equivalent address whose stored form differs from its canonical form (for example `first.last@gmail.com`, `name+tag@gmail.com`, or `name@googlemail.com`) THEN the system fails to find the account and returns the "invalid or expired" error without verifying the email

### Expected Behavior (Correct)

2.1 WHEN a groomer opens a fresh, valid verification link and the page's confirm effect runs more than once for the same token THEN the system SHALL send the token to the server at most once per page load, verify the email, and show the "Email verified" success state

2.2 WHEN a groomer opens a fresh, valid verification link and verification succeeds THEN the system SHALL refresh the session so it reflects the verified email and route the user to `/onboarding`, without showing the error state

2.3 WHEN a verification token that was already consumed is presented again by a request whose signed-in user is the account that token verified, and that account is already verified THEN the system SHALL return a success result and show the "Email verified" state rather than an error

2.4 WHEN a valid verification link is opened with no signed-in session (or with a session for a different account) and the account's stored email has the same canonical form as the token's normalized email THEN the system SHALL verify that account, including Gmail-equivalent addresses with dots, `+tag` suffixes, or the `googlemail.com` domain

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a verification link carries a token that never existed, is malformed, or has passed its expiry, and no already-verified account owned by the requester can be matched to it THEN the system SHALL CONTINUE TO show "Verification failed — That verification link is invalid or has expired. Please request a new one." with the "Request a new link" action

3.2 WHEN a verification link has no token or an empty token THEN the system SHALL CONTINUE TO show the missing-token error without calling the server action

3.3 WHEN a valid token is confirmed while a different account is signed in THEN the system SHALL CONTINUE TO never set the verified timestamp on the signed-in account, and SHALL only ever verify the account whose canonical email matches the token's normalized email

3.4 WHEN a replayed or consumed token is presented by an unauthenticated request or by a signed-in account that is not yet verified THEN the system SHALL CONTINUE TO return the "invalid or expired" error and SHALL NOT mark any account as verified

3.5 WHEN a valid token is confirmed successfully THEN the system SHALL CONTINUE TO set the user's verified timestamp and delete the one-time token so it cannot verify an account a second time

3.6 WHEN a valid token is confirmed for a non-Gmail address, or for a Gmail address whose stored form already equals its canonical form, THEN the system SHALL CONTINUE TO verify the matching account on both the signed-in and the no-session paths

3.7 WHEN email verification storage (Redis) is not configured THEN the system SHALL CONTINUE TO return the "Email verification isn't available right now" message

3.8 WHEN the confirm action hits an unexpected server error THEN the system SHALL CONTINUE TO return the user-safe "Something went wrong" message without throwing or exposing internal details

3.9 WHEN a signed-in user requests or resends a verification email THEN the system SHALL CONTINUE TO create a new token, apply the 60-second resend cooldown, and send the link exactly as it does today
