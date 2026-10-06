# Requirements Document

## Introduction

This feature makes email verification the account-activation gate for Pawxis
signups. Pawxis already ships a magic-**link** email verification flow
(`requestEmailVerification` / `confirmEmailVerification`, backed by the
`/verify-email` page and the `User.emailVerifiedAt` field), but today that flow
is not wired into registration and nothing blocks an unverified user from using
the portal. The link flow stays as-is — this spec **wires** it so that:

- A new registrant automatically receives a verification link.
- An authenticated user whose email is unverified is blocked from portal
  routes, onboarding, and starting a trial, and is routed to a
  verification-pending screen with a rate-limited resend action.
- Clicking a valid link verifies the account and lets the user proceed without
  being forced to manually log out and back in.
- Google OAuth users are treated as email-verified (Google asserts the email).
- The trial pipeline keeps **email verification REQUIRED**, but makes the
  **phone (Twilio Verify) gate OPTIONAL** — it enforces only when Twilio is
  configured and otherwise degrades instead of hard-blocking.
- Existing active users are grandfathered so the deploy does not lock anyone out.

This is a wiring and gating change. It reuses the existing magic-link flow,
Resend, and Upstash Redis (all already configured). Twilio is **not** configured
in the launch environment, which is the degraded case the phone gate must
tolerate. All existing abuse protections (disposable-domain block, velocity
flagging, one-trial-per-identity binding, Redis rate limits, login lockout)
remain unchanged.

## Glossary

- **Pawxis_System**: The Pawxis Next.js application (app-router + TypeScript),
  including its server actions, NextAuth layer, route middleware, and MongoDB
  (Mongoose) persistence, deployed on Vercel.
- **Registrant**: A person completing the credentials registration form
  (`registerGroomer`).
- **Groomer**: An authenticated user with a `User` record and paired
  `GroomerProfile`.
- **Verified_User**: A `Groomer` whose `User.emailVerifiedAt` is a non-null
  timestamp.
- **Unverified_User**: An authenticated `Groomer` whose `User.emailVerifiedAt`
  is null and who is not grandfathered or OAuth-verified.
- **Email_Verification_Link**: The URL-safe, single-use magic link
  (`${NEXT_PUBLIC_APP_URL}/verify-email?token=…`) produced by
  `requestEmailVerification`, whose token is stored in Redis under
  `keys.emailVerify(token)` with TTL `getEmailVerificationTtlMin()` (default 30
  minutes).
- **Verification_Pending_Screen**: The screen shown to an `Unverified_User`
  after authentication that displays their email, resend action, and status.
- **Access_Gate**: The combined route-protection logic (NextAuth JWT claims
  read by `src/middleware.ts` plus any server-side check) that decides whether a
  request may reach portal/onboarding routes.
- **Portal_Routes**: The private groomer routes guarded by `src/middleware.ts`
  (`/dashboard`, `/clients`, `/pets`, `/appointments`, `/services`,
  `/availability`, `/analytics`, `/settings`, `/calendar`, `/inbox`, `/billing`,
  `/start-trial`).
- **Onboarding_Flow**: The groomer onboarding wizard rooted at `/onboarding`.
- **Trial_Pipeline**: The ordered gate pipeline in `startTrialGated`
  (`src/actions/trial.ts`) that provisions a free trial.
- **Email_Gate**: Gate 4 of the `Trial_Pipeline`, which requires a non-null
  `User.emailVerifiedAt`.
- **Phone_Gate**: Gate 5 of the `Trial_Pipeline`, which currently requires a
  verified E.164 phone number.
- **Twilio_Configured**: The state in which Twilio Verify credentials are
  present, as reported by `isTwilioVerifyConfigured()`
  (`src/lib/identity/config.ts`).
- **Resend_Provider**: The transactional email provider (Resend) used by
  `sendEmailVerification`.
- **Redis_Store**: The Upstash Redis instance holding verification tokens and
  rate-limit counters.
- **Grandfathered_User**: A pre-existing `User` created before this feature's
  deploy who must be treated as email-verified so the deploy does not lock them
  out.
- **Resend_Cooldown**: The minimum interval the `Pawxis_System` enforces between
  two Email_Verification_Link resend requests for the same identity.

## Requirements

### Requirement 1: Send a verification link on registration

**User Story:** As a Registrant, I want to receive an email-verification link
right after I sign up, so that I can activate my account without hunting for how
to request one.

#### Acceptance Criteria

1. WHEN a Registrant completes credentials registration successfully, THE Pawxis_System SHALL send an Email_Verification_Link to the Registrant's email address.
2. WHEN the registration-triggered send runs, THE Pawxis_System SHALL execute the send after the Registrant's session is established, so the session requirement of `requestEmailVerification` is satisfied.
3. WHILE the Resend_Provider is unconfigured or unavailable, THE Pawxis_System SHALL complete registration and route the Registrant to the Verification_Pending_Screen rather than failing registration.
4. WHEN the Email_Verification_Link is sent at registration, THE Pawxis_System SHALL store the token in the Redis_Store under `keys.emailVerify(token)` with TTL `getEmailVerificationTtlMin()`.
5. IF the Redis_Store is unavailable when the registration-triggered send runs, THEN THE Pawxis_System SHALL route the Registrant to the Verification_Pending_Screen with a resend option rather than discarding the account.

### Requirement 2: Block unverified users from portal, onboarding, and trial

**User Story:** As the app owner, I want unverified users held at a pending
screen, so that only people with a confirmed email can use the portal or start a
trial.

#### Acceptance Criteria

1. WHILE a request belongs to an Unverified_User, THE Access_Gate SHALL deny access to Portal_Routes and redirect the request to the Verification_Pending_Screen.
2. WHILE a request belongs to an Unverified_User, THE Access_Gate SHALL deny access to the Onboarding_Flow and redirect the request to the Verification_Pending_Screen.
3. WHEN an Unverified_User invokes `startTrialGated`, THE Trial_Pipeline SHALL reject the request at the Email_Gate with reason `email_unverified`.
4. WHILE a request belongs to a Verified_User, THE Access_Gate SHALL allow the normal routing to proceed (onboarding when incomplete, otherwise the portal).
5. WHEN an Unverified_User requests the Verification_Pending_Screen, THE Access_Gate SHALL allow that request through.
6. WHEN an Unverified_User requests the `/verify-email` link-confirmation page, THE Access_Gate SHALL allow that request through.

### Requirement 3: Verification-pending screen with resend

**User Story:** As an Unverified_User, I want a clear screen showing my email
with a resend button, so that I can recover if the first link never arrived.

#### Acceptance Criteria

1. WHEN the Verification_Pending_Screen renders for an Unverified_User, THE Pawxis_System SHALL display the email address associated with that user's account.
2. THE Verification_Pending_Screen SHALL present a resend action that invokes `requestEmailVerification`.
3. WHEN an Unverified_User triggers the resend action and the Resend_Cooldown has elapsed, THE Pawxis_System SHALL send a new Email_Verification_Link and display a confirmation state.
4. IF an Unverified_User triggers the resend action before the Resend_Cooldown has elapsed, THEN THE Pawxis_System SHALL reject the resend and display the remaining cooldown time without sending a new link.
5. WHILE a resend request is in flight, THE Verification_Pending_Screen SHALL disable the resend action to prevent duplicate submissions.
6. WHEN `requestEmailVerification` returns `delivered:false` because the Resend_Provider is unconfigured, THE Verification_Pending_Screen SHALL display a state indicating the request was accepted but delivery could not be confirmed.
7. WHEN `requestEmailVerification` returns reason `not_configured` because the Redis_Store is unavailable, THE Verification_Pending_Screen SHALL display a recoverable error state inviting a later retry.

### Requirement 4: Confirm the link and proceed

**User Story:** As an Unverified_User, I want clicking the link to verify my
account and let me continue, so that I reach onboarding immediately after
verifying.

#### Acceptance Criteria

1. WHEN an Unverified_User opens a valid, unexpired Email_Verification_Link, THE Pawxis_System SHALL set `User.emailVerifiedAt` to the verification timestamp via `confirmEmailVerification`.
2. WHEN `confirmEmailVerification` succeeds, THE Pawxis_System SHALL burn the token so the same Email_Verification_Link cannot be reused.
3. WHEN verification succeeds for an authenticated user, THE Pawxis_System SHALL route the now-Verified_User into the Onboarding_Flow.
4. IF an Unverified_User opens an expired or invalid Email_Verification_Link, THEN THE Pawxis_System SHALL display a recoverable state that offers a resend action.
5. IF an Email_Verification_Link token has already been burned, THEN THE Pawxis_System SHALL display the same recoverable expired/invalid state and SHALL NOT alter any account.

### Requirement 5: Access gate reflects verification without forced re-login

**User Story:** As a newly Verified_User, I want the portal to recognize my
verification right away, so that I do not have to log out and back in to get past
the pending screen.

#### Acceptance Criteria

1. WHEN a user's verification state is unverified, THE Access_Gate SHALL route the user to the Verification_Pending_Screen.
2. WHEN a user's verification state is verified, THE Access_Gate SHALL route the user through the normal portal/onboarding flow.
3. WHEN an Unverified_User completes verification during an active session, THE Access_Gate SHALL recognize the verified state and allow portal/onboarding access without requiring the user to manually sign out and sign back in.
4. WHERE verification state is carried on the NextAuth JWT, THE Pawxis_System SHALL refresh that claim after verification so the Access_Gate observes the verified state within the active session.
5. THE Access_Gate SHALL apply the verification check without weakening the existing authentication, onboarding-completeness, and billing-lockout rules in `src/middleware.ts`.

### Requirement 6: Trial pipeline keeps email required, makes phone optional

**User Story:** As the app owner launching without Twilio, I want the trial to
still require a verified email but not block on phone verification, so that users
can start trials while Twilio is unconfigured.

#### Acceptance Criteria

1. WHEN `startTrialGated` runs for a user whose `User.emailVerifiedAt` is null, THE Trial_Pipeline SHALL reject the request at the Email_Gate.
2. WHILE Twilio_Configured is true, THE Trial_Pipeline SHALL enforce the Phone_Gate exactly as it does today, rejecting the request when no verified E.164 phone is present.
3. WHILE Twilio_Configured is false, THE Trial_Pipeline SHALL skip the Phone_Gate and proceed without a verified phone number.
4. WHEN the Phone_Gate is skipped because Twilio_Configured is false, THE Trial_Pipeline SHALL continue to run the remaining gates (velocity, identity-binding, provisioning) unchanged.
5. THE Trial_Pipeline SHALL preserve the disposable-domain block, velocity flagging, one-trial-per-identity binding, and Redis rate limits regardless of Twilio_Configured state.

### Requirement 7: Google OAuth users are treated as verified

**User Story:** As a Google sign-in user, I want my Google-verified email to count
as verified, so that I am not wrongly held at the pending screen.

#### Acceptance Criteria

1. WHEN a user signs in through Google OAuth, THE Pawxis_System SHALL treat that user's email as verified for the purposes of the Access_Gate and the Email_Gate.
2. WHEN a Google OAuth user is provisioned or linked, THE Pawxis_System SHALL set `User.emailVerifiedAt` to a non-null timestamp if it is currently null.
3. WHEN a Google OAuth user reaches the Access_Gate, THE Access_Gate SHALL route the user through the normal portal/onboarding flow rather than to the Verification_Pending_Screen.

### Requirement 8: Backward compatibility for existing users

**User Story:** As an existing active user, I want to keep using the portal after
this change ships, so that the new gate does not lock me out of my account.

#### Acceptance Criteria

1. WHEN the feature is deployed, THE Pawxis_System SHALL treat each pre-existing active `User` (`isActive` true) as a Grandfathered_User that passes the Access_Gate verification check.
2. WHEN the feature is deployed, THE Pawxis_System SHALL treat each pre-existing active `User` as satisfying the Email_Gate of the Trial_Pipeline.
3. WHERE a one-time backfill is chosen as the grandfathering mechanism, THE Pawxis_System SHALL set `User.emailVerifiedAt` to a non-null timestamp for every pre-existing active `User` whose `emailVerifiedAt` is null.
4. WHEN the grandfathering rule is applied, THE Pawxis_System SHALL leave `User.emailVerifiedAt` unchanged for users who already have a non-null value.
5. IF a `User` is created after the feature's deploy, THEN THE Pawxis_System SHALL require that user to verify email through the Email_Verification_Link flow and SHALL NOT grandfather that user.

### Requirement 9: Non-functional constraints and graceful degradation

**User Story:** As the app owner, I want this to run on the services I already pay
for and degrade gracefully, so that an email outage never traps a user with no way
forward.

#### Acceptance Criteria

1. THE Pawxis_System SHALL implement this feature using only the Resend_Provider and Redis_Store that are already configured, introducing no new paid dependency.
2. WHILE the Resend_Provider is unavailable, THE Pawxis_System SHALL still render the Verification_Pending_Screen with a resend action so the user retains a path forward.
3. WHEN the Resend_Cooldown is enforced, THE Pawxis_System SHALL back it with the Redis_Store so the limit holds across the serverless (Vercel) runtime.
4. WHERE Twilio_Configured becomes true later, THE Pawxis_System SHALL re-enforce the Phone_Gate without requiring code changes to the email-verification path.
5. THE Pawxis_System SHALL confine the verification identity key to the normalized email form while sending delivery to the user's original display email, preserving the current `requestEmailVerification` behavior.

### Requirement 10: Resend abuse and token-lifecycle edge cases

**User Story:** As the app owner, I want resend and token handling to resist abuse
and odd flows, so that the gate stays reliable across devices and repeat logins.

#### Acceptance Criteria

1. WHEN an Unverified_User repeatedly triggers the resend action, THE Pawxis_System SHALL rate-limit the requests via the Resend_Cooldown backed by the Redis_Store.
2. WHEN an Unverified_User logs in again later without verifying, THE Access_Gate SHALL continue to route the user to the Verification_Pending_Screen and SHALL allow a fresh resend subject to the Resend_Cooldown.
3. WHEN an Unverified_User opens the Email_Verification_Link in a different browser or device than the active session, THE Pawxis_System SHALL verify the account whose canonical email matches the token even without a matching session, consistent with `confirmEmailVerification`.
4. IF the registration-triggered send cannot run immediately because the session is not yet established, THEN THE Pawxis_System SHALL ensure the Registrant still reaches the Verification_Pending_Screen from which a resend can be issued once the session exists.
5. WHEN a token is successfully consumed, THE Pawxis_System SHALL reject any subsequent use of the same token as expired/invalid, with no change to account state.
