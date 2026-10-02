# Requirements Document

## Introduction

This feature set delivers the launch-critical billing and payments surface for **Pawxis**, a mobile pet-grooming SaaS. It covers three connected systems that must ship together:

1. **Trial, hard lockout, and auto-renewal** — Pawxis's own subscription revenue, collected from groomers via Stripe Billing. A 14-day no-card free trial, a daily countdown, a hard lockout once the trial expires without a paid subscription, and Stripe-driven auto-renewal.
2. **Free-trial abuse prevention without collecting a card** — layered friction (email verification, disposable-domain blocking, Gmail-alias normalization, phone OTP as the primary gate, and device/IP velocity signals) that binds a trial to a verified identity so re-registration cannot farm endless trials.
3. **Client → groomer payments via Stripe Connect** — groomers receive client booking deposits directly through Stripe Connect **Express** accounts using **direct charges**. Pawxis is never the merchant of record for client deposits and never holds the funds. The application-fee plumbing is built now with a fee of 0 so a percentage can be enabled later without re-architecting.

The work builds on existing seams: the `BillingProvider` abstraction (`src/lib/billing/provider.ts`), the billing server actions (`src/actions/billing.ts`), the Stripe webhook handler (`src/app/api/webhooks/stripe/route.ts`), the route-protection middleware (`src/middleware.ts`), and the `GroomerProfile` model (which already carries `stripeConnectAccountId` and `stripeConnectChargesEnabled`). All third parties remain behind the provider pattern, every money move is idempotent and webhook-driven, and everything degrades safely to a clear "not configured" state when Stripe or a verification provider is absent (e.g. local dev).

The following product and architecture decisions are **locked** and are expressed below as requirements rather than open questions: 14-day no-card trial; hard lockout after 12:00 on day 14; Stripe Billing for Pawxis revenue; Stripe Connect Express + direct charges for client deposits; platform fee of 0 with fee plumbing built in; phone OTP as the primary abuse gate with identity binding; US-LLC platform entity.

## Glossary

- **Pawxis**: The SaaS platform. The entity operating Pawxis will be a **US LLC** so that Stripe Connect is available (the platform must be registered in a Stripe-supported country; Pakistan is not supported, hence the US LLC).
- **Groomer**: A paying (or trialing) business user who runs their grooming business through the Pawxis portal. Identified by `session.user.id` (the Mongo profile User id).
- **Pawxis_Operator**: A person or role operating the Pawxis business, concerned with revenue collection and abuse prevention.
- **Client**: An end customer of a Groomer who books a grooming appointment and pays a deposit.
- **Groomer_Portal**: The authenticated area of the application (routes such as `/dashboard`, `/clients`, `/appointments`, `/settings`, `/billing`, etc.).
- **Public_Booking_Page**: A Groomer's unauthenticated, client-facing booking page (e.g. `/book/{groomerSlug}` and related public token pages).
- **Trial**: A 14-day period during which a Groomer may use paid Groomer_Portal features without an active paid Subscription and without providing a credit card.
- **Trial_Deadline**: The precise instant the Trial ends: **12:00 (noon) in the Groomer's configured timezone on the 14th day** after the Trial start date.
- **Hard_Lockout**: The state after the Trial_Deadline in which a Groomer has no active paid Subscription; the Groomer is prevented from accessing Groomer_Portal features and is redirected to the Upgrade_Page.
- **Upgrade_Page**: The billing/upgrade route (`/billing`) that remains reachable during Hard_Lockout so the Groomer can subscribe.
- **Subscription**: The local, authoritative record of a Groomer's billing state (`trialing`, `active`, `past_due`, `canceled`, etc.), kept in sync with Stripe via webhooks.
- **Auto_Renewal**: Stripe Billing automatically charging the Groomer's payment method at each billing period boundary to extend an active Subscription.
- **Stripe_Billing**: Stripe's subscription product used to collect Pawxis's own revenue from Groomers on the Pawxis platform account. Separate from Stripe Connect.
- **Stripe_Connect**: Stripe's product for routing payments to third parties (the Groomers).
- **Connected_Account**: A Groomer's Stripe Connect **Express** account that receives Client deposits. Pawxis stores only its `accountId` and connection status.
- **Express_Account**: A Stripe Connect account type with Stripe-hosted onboarding and a Stripe-hosted dashboard, requiring no API-key handling by the Groomer.
- **Direct_Charge**: A Stripe charge created on the Connected_Account so funds land directly in the Groomer's balance; Pawxis never holds the funds.
- **Application_Fee**: The portion of a Direct_Charge that Stripe routes to the Pawxis platform account. Set to 0 at launch; the plumbing is built so a non-zero percentage can be enabled by configuration later.
- **MoR (Merchant of Record)**: The entity legally selling to the customer and responsible for tax/refunds. For Client→Groomer deposits under Direct_Charge, the Groomer (via their Connected_Account) is the merchant; **Pawxis is NOT the MoR** for Client deposits. (For Pawxis's own subscription revenue, Pawxis bills the Groomer directly through Stripe_Billing.)
- **Device_Fingerprint**: A non-PII signal derived from a browser/device used to detect one device creating many Trial accounts.
- **IP_Velocity**: The rate of Trial-account creation originating from a single IP address within a time window.
- **Disposable_Email**: An email address at a temporary/throwaway domain (e.g. Mailinator, 10MinuteMail-type) maintained in a configurable blocklist.
- **Email_Normalization**: Collapsing provider-specific aliasing (Gmail dots and `+tags`) so that aliases of one mailbox map to a single canonical identity.
- **Identity_Binding**: Associating a Trial entitlement with a verified identity (primarily a verified phone number, secondarily Device_Fingerprint/IP signals) rather than only the account row, so deleting and re-registering does not reset the Trial.
- **Verified_Phone**: A phone number proven to belong to the registrant via a one-time-passcode (OTP) challenge.
- **Verification_Provider**: An external service used for phone OTP (and related verification). Behind a provider seam like Stripe.
- **Not_Configured_State**: A clearly-labeled degraded UI/behavior shown when Stripe or a Verification_Provider is unavailable or unconfigured; the application must not crash.

---

## Requirements

### Requirement 1: Start a no-card free trial

**User Story:** As a Groomer, I want to start a 14-day free trial without entering a credit card, so that I can evaluate Pawxis before paying.

#### Acceptance Criteria

1. WHEN a Groomer with a verified identity requests to start a Trial AND the Groomer has no prior Trial bound to their identity, THE Pawxis_System SHALL create a local Subscription with status `trialing` and record the Trial start timestamp.
2. WHEN a Trial is created, THE Pawxis_System SHALL set the Trial_Deadline to 12:00 in the Groomer's configured timezone on the 14th day after the Trial start date.
3. THE Pawxis_System SHALL start a Trial without requiring the Groomer to provide a credit card or payment method.
4. IF a Groomer requests to start a Trial while an identity-bound Trial has already been consumed for that identity, THEN THE Pawxis_System SHALL decline to start a new Trial and SHALL return a message stating that the Trial has already been used.
5. WHERE Stripe_Billing is in the Not_Configured_State, THE Pawxis_System SHALL still record the local `trialing` Subscription so that Trial evaluation works in development.

### Requirement 2: Daily trial countdown in the portal

**User Story:** As a Groomer, I want to see how many trial days I have left, so that I know when I need to subscribe.

#### Acceptance Criteria

1. WHILE a Groomer has a `trialing` Subscription, THE Groomer_Portal SHALL display the whole number of Trial days remaining until the Trial_Deadline.
2. THE Groomer_Portal SHALL compute Trial days remaining relative to the current date in the Groomer's configured timezone.
3. WHILE the Trial days remaining is 3 or fewer, THE Groomer_Portal SHALL display the countdown with a visually emphasized state and a link to the Upgrade_Page.
4. WHEN the Trial_Deadline has passed, THE Groomer_Portal SHALL display that the Trial has ended instead of a negative or zero countdown.
5. THE Trial countdown UI SHALL use DaisyUI theme tokens and SHALL meet WCAG 2.1 AA color-contrast requirements.

### Requirement 3: Hard lockout after the trial deadline

**User Story:** As a Pawxis_Operator, I want portal access to stop after an unpaid trial expires, so that groomers must subscribe to keep using paid features.

#### Acceptance Criteria

1. WHEN a Groomer requests any Groomer_Portal route AND the Trial_Deadline has passed AND the Groomer has no `active` paid Subscription, THE Pawxis_System SHALL redirect the request to the Upgrade_Page.
2. WHILE a Groomer is in Hard_Lockout, THE Pawxis_System SHALL permit access to the Upgrade_Page, the authentication routes, and the sign-out action.
3. WHILE a Groomer is in Hard_Lockout, THE Pawxis_System SHALL deny access to the dashboard and all other Groomer_Portal features by redirecting to the Upgrade_Page.
4. WHEN a Groomer in Hard_Lockout completes a successful subscription checkout AND the Subscription status becomes `active`, THE Pawxis_System SHALL restore access to the Groomer_Portal.
5. THE Hard_Lockout redirect logic SHALL preserve the existing middleware no-self-redirect invariant so that no request is redirected to its own path.
6. **[DECISION POINT — Public booking pages during lockout]** WHILE a Groomer is in Hard_Lockout, THE Pawxis_System SHALL keep that Groomer's Public_Booking_Page available to Clients by default, so that the Groomer's existing clients are not disrupted. *(Stated default: public booking stays up. The alternative — also disabling public booking during lockout — is recorded here as the rejected default and may be revisited in design.)*

### Requirement 4: Subscribe to a paid plan

**User Story:** As a Groomer, I want to subscribe to a paid plan, so that I can keep using Pawxis after my trial.

#### Acceptance Criteria

1. WHEN a Groomer initiates subscription checkout for a selected plan and interval, THE Pawxis_System SHALL create a Stripe_Billing Checkout session scoped to the Groomer and SHALL return the hosted Checkout URL.
2. WHEN Stripe_Billing confirms a successful subscription payment via webhook, THE Pawxis_System SHALL set the local Subscription status to `active`.
3. THE Pawxis_System SHALL provide a Stripe Customer Portal link so that a Groomer can manage the payment method and cancel the Subscription.
4. IF subscription checkout cannot be created because Stripe_Billing is in the Not_Configured_State, THEN THE Pawxis_System SHALL return a result with reason `not_configured` and a user-safe message, without throwing.
5. THE Pawxis_System SHALL scope every subscription operation to the authenticated `session.user.id`.

### Requirement 5: Auto-renewal and subscription lifecycle sync

**User Story:** As a Pawxis_Operator, I want subscriptions to auto-renew and local state to mirror Stripe, so that revenue is recurring and billing state is always authoritative.

#### Acceptance Criteria

1. THE Pawxis_System SHALL configure Stripe_Billing subscriptions so that Auto_Renewal charges the Groomer's payment method at each billing-period boundary.
2. WHEN a `customer.subscription.created`, `customer.subscription.updated`, or `customer.subscription.deleted` event is received, THE Pawxis_System SHALL update the local Subscription status to match the Stripe subscription state.
3. WHEN an `invoice.paid` event is received for a Subscription, THE Pawxis_System SHALL set the local Subscription status to `active` and SHALL record the current period end.
4. WHEN an `invoice.payment_failed` event is received, THE Pawxis_System SHALL set the local Subscription status to `past_due`.
5. WHEN a `customer.subscription.trial_will_end` event is received, THE Pawxis_System SHALL record that the Trial end is imminent for use by the countdown and notifications.
6. WHEN any subscription lifecycle webhook event is received more than once, THE Pawxis_System SHALL process the effect at most once (idempotent handling).
7. WHEN a received subscription webhook cannot be processed due to a transient error, THE Pawxis_System SHALL respond with a 5xx status so that Stripe retries delivery.
8. THE Pawxis_System SHALL treat the webhook-derived Subscription state as the source of truth over any client-reported state.

### Requirement 6: Webhook signature verification and separation of billing concerns

**User Story:** As a Pawxis_Operator, I want all Stripe events verified and routed correctly, so that billing and deposit flows stay secure and independent.

#### Acceptance Criteria

1. WHEN a request is received at the Stripe webhook endpoint, THE Pawxis_System SHALL verify the Stripe signature using the configured signing secret before processing the event.
2. IF the Stripe signature is missing or invalid, THEN THE Pawxis_System SHALL reject the request with a 400 status and SHALL NOT process the event.
3. THE Pawxis_System SHALL process subscription lifecycle events (Stripe_Billing) without altering the existing deposit fulfilment behavior for `payment_intent.succeeded` and `payment_intent.payment_failed`.
4. THE Pawxis_System SHALL NOT write Stripe secret keys or webhook payloads containing secrets to application logs.

### Requirement 7: Email verification required before trial provisioning

**User Story:** As a Pawxis_Operator, I want email verification before a trial is provisioned, so that trials are tied to reachable, real email addresses.

#### Acceptance Criteria

1. WHEN a Groomer registers, THE Pawxis_System SHALL require email verification before a Trial is provisioned.
2. WHILE a Groomer's email is unverified, THE Pawxis_System SHALL withhold the Trial entitlement.
3. WHEN a Groomer verifies their email, THE Pawxis_System SHALL record the email as verified and SHALL allow the remaining Trial gates to proceed.
4. THE Pawxis_System SHALL store the canonical normalized email (per Requirement 9) alongside the verification state.

### Requirement 8: Block disposable email domains

**User Story:** As a Pawxis_Operator, I want throwaway email domains blocked, so that abusers cannot cycle temporary addresses to farm trials.

#### Acceptance Criteria

1. WHEN a Groomer submits an email whose domain is on the Disposable_Email blocklist, THE Pawxis_System SHALL reject the registration with a message indicating a permanent email is required.
2. THE Pawxis_System SHALL load the Disposable_Email blocklist from a maintainable source that can be updated without a code change to control flow.
3. THE Pawxis_System SHALL perform the Disposable_Email check against the domain of the normalized email (per Requirement 9).
4. IF the Disposable_Email blocklist cannot be loaded, THEN THE Pawxis_System SHALL allow registration to proceed and SHALL record a diagnostic signal, so that legitimate Groomers are not blocked by an infrastructure fault.

### Requirement 9: Email normalization to collapse Gmail aliases

**User Story:** As a Pawxis_Operator, I want Gmail dot and plus-tag aliases collapsed to one identity, so that a single mailbox cannot register as many distinct trial accounts.

#### Acceptance Criteria

1. WHEN an email at a Gmail-equivalent domain is submitted, THE Pawxis_System SHALL produce a canonical form by removing dots in the local part and discarding any `+tag` suffix.
2. THE Pawxis_System SHALL use the canonical normalized email as the uniqueness key for detecting whether an identity has already consumed a Trial.
3. WHEN two submitted emails produce the same canonical normalized email, THE Pawxis_System SHALL treat them as the same email identity.
4. THE Pawxis_System SHALL preserve the Groomer's originally submitted email for display and delivery while using the normalized form for identity checks.

### Requirement 10: Phone OTP verification as the primary trial gate

**User Story:** As a Groomer, I want to verify my phone number by one-time code, so that I can start my trial; and as a Pawxis_Operator, I want the phone to be the primary gate so trials bind to a real identity.

#### Acceptance Criteria

1. WHEN a Groomer requests to start a Trial, THE Pawxis_System SHALL require a Verified_Phone before provisioning the Trial.
2. WHEN a Groomer submits a phone number, THE Pawxis_System SHALL send a one-time passcode to that number via the Verification_Provider.
3. WHEN a Groomer submits the correct one-time passcode within the validity window, THE Pawxis_System SHALL mark the phone number as a Verified_Phone.
4. IF the submitted passcode is incorrect or expired, THEN THE Pawxis_System SHALL reject verification and SHALL allow the Groomer to request a new passcode subject to a configurable rate limit.
5. THE Pawxis_System SHALL store the phone number in a normalized canonical form so that formatting variations of one number map to a single identity.

### Requirement 11: Trial entitlement bound to a verified identity

**User Story:** As a Pawxis_Operator, I want each trial bound to a verified phone identity, so that deleting and re-registering with the same phone cannot reset the trial clock.

#### Acceptance Criteria

1. WHEN a Trial is provisioned, THE Pawxis_System SHALL record an Identity_Binding associating the Trial with the canonical Verified_Phone and the canonical normalized email.
2. WHEN a Groomer requests to start a Trial using a Verified_Phone that is already bound to a prior Trial, THE Pawxis_System SHALL decline to start a new Trial.
3. WHEN a Groomer deletes their account and re-registers using the same Verified_Phone, THE Pawxis_System SHALL continue to treat the Trial as already consumed for that identity.
4. THE Pawxis_System SHALL persist Identity_Binding records independently of the account row so that account deletion does not remove the binding.

### Requirement 12: Device fingerprint and IP velocity signals

**User Story:** As a Pawxis_Operator, I want to detect one device or IP spinning up many trials, so that I can flag or block coordinated abuse.

#### Acceptance Criteria

1. WHEN a Groomer registers or starts a Trial, THE Pawxis_System SHALL record a Device_Fingerprint signal and the originating IP address associated with the attempt.
2. WHEN the count of Trial-account creations from a single Device_Fingerprint or single IP within a configurable time window exceeds a configurable threshold, THE Pawxis_System SHALL mark the attempt as flagged.
3. **[DECISION POINT — flag vs block thresholds]** WHEN an attempt is flagged for exceeding the velocity threshold, THE Pawxis_System SHALL by default allow the Trial to proceed while recording the flag for Pawxis_Operator review, rather than hard-blocking. *(Stated default: flag, do not block. Hard-block remains a configurable escalation. Default thresholds: more than 3 Trial creations per Device_Fingerprint or per IP within 24 hours — all values configurable.)*
4. THE Pawxis_System SHALL store the Device_Fingerprint as a non-PII signal.
5. IF Device_Fingerprint or IP_Velocity signals cannot be collected, THEN THE Pawxis_System SHALL allow the Trial flow to proceed, so that legitimate Groomers are not blocked by a signal-collection fault.

### Requirement 13: Verification degrades safely

**User Story:** As a Groomer, I want verification to fail gracefully when a provider is down, so that I am not permanently blocked by an outage.

#### Acceptance Criteria

1. WHERE the Verification_Provider is in the Not_Configured_State, THE Pawxis_System SHALL present a clearly-labeled Not_Configured_State for phone verification and SHALL NOT crash.
2. IF the Verification_Provider is unavailable at the time of an OTP request, THEN THE Pawxis_System SHALL return a user-safe retry message and SHALL record a diagnostic signal.
3. THE Pawxis_System SHALL define and apply a degraded policy that avoids permanently blocking a legitimate Groomer when verification cannot complete due to a provider fault.
4. THE Pawxis_System SHALL NOT reveal provider error internals or secrets in messages shown to the Groomer.

### Requirement 14: One-click Stripe Connect onboarding

**User Story:** As a Groomer, I want a one-click "Connect payouts" button that opens Stripe-hosted onboarding, so that I can get paid without handling API keys.

#### Acceptance Criteria

1. WHEN a Groomer selects "Connect payouts" in Settings, THE Pawxis_System SHALL create a Stripe_Connect Express account link and SHALL return the Stripe-hosted onboarding URL.
2. THE Pawxis_System SHALL use Express_Account onboarding so that account setup and the account dashboard are hosted by Stripe.
3. THE Pawxis_System SHALL NOT require the Groomer to enter or paste any Stripe API keys.
4. WHEN Stripe-hosted onboarding returns the Groomer to the application, THE Pawxis_System SHALL store the Connected_Account `accountId` on the Groomer's profile.
5. THE Pawxis_System SHALL store only the Connected_Account `accountId` and connection status and SHALL NOT store the Groomer's Stripe keys.
6. IF Stripe_Connect is in the Not_Configured_State, THEN THE Pawxis_System SHALL return a result with reason `connect_not_configured` and a user-safe message, without throwing.

### Requirement 15: Connect onboarding state tracking and surfacing

**User Story:** As a Groomer, I want to see my payout-connection status and fix issues, so that I know whether I can receive client payments.

#### Acceptance Criteria

1. THE Pawxis_System SHALL track the Connected_Account state as one of: not started, pending, needs more info, complete, or disabled.
2. THE Groomer_Portal SHALL display the current Connected_Account state in Settings.
3. WHILE the Connected_Account state is "needs more info" or "disabled", THE Groomer_Portal SHALL present a re-onboarding link that opens Stripe-hosted onboarding.
4. WHEN an `account.updated` Connect event is received, THE Pawxis_System SHALL update the stored connection status and the `chargesEnabled` flag to match Stripe.
5. WHEN an `account.updated` event is received more than once, THE Pawxis_System SHALL apply the status update idempotently.
6. THE Connected_Account status UI SHALL use DaisyUI theme tokens and SHALL meet WCAG 2.1 AA requirements.

### Requirement 16: Client deposit as a direct charge on the connected account

**User Story:** As a Client, I want my booking deposit to go directly to the groomer, so that the groomer receives my payment without Pawxis holding the funds.

#### Acceptance Criteria

1. WHEN a Client confirms a booking that requires a deposit AND the Groomer has a complete Connected_Account, THE Pawxis_System SHALL create the deposit PaymentIntent as a Direct_Charge on the Groomer's Connected_Account.
2. THE Pawxis_System SHALL include Application_Fee plumbing on the Direct_Charge configured to 0 at launch, with the fee amount derived from a configurable rate so a non-zero percentage can be enabled without re-architecting.
3. WHEN a Direct_Charge deposit succeeds, THE Pawxis_System SHALL fulfil the booking using the existing idempotent fulfilment path guarded by the Transaction unique index.
4. THE Pawxis_System SHALL route Client deposit funds to the Groomer's Connected_Account balance so that Pawxis does not hold the funds and is not the MoR for the deposit.
5. WHEN a deposit webhook event is received more than once, THE Pawxis_System SHALL fulfil the booking at most once.

### Requirement 17: Booking behavior when the groomer has not connected Stripe

**User Story:** As a Pawxis_Operator, I want a defined behavior when a groomer has no connected account, so that bookings handle the "payments not set up" case cleanly.

#### Acceptance Criteria

1. **[DECISION POINT — booking without a connected account]** WHILE a Groomer does not have a complete Connected_Account, THE Pawxis_System SHALL by default block deposit-requiring bookings on that Groomer's Public_Booking_Page and SHALL display a clear "online payments not set up yet" state to the Client. *(Stated default: block paid bookings until Connect is complete. The alternative — allowing a booking with an unpaid/"pay later" deposit state — is recorded as the rejected default and may be revisited in design.)*
2. WHILE a Groomer does not have a complete Connected_Account AND the Groomer's booking configuration does not require a deposit, THE Pawxis_System SHALL allow the no-deposit booking to proceed.
3. WHEN a Groomer completes Connected_Account onboarding, THE Pawxis_System SHALL enable deposit-requiring bookings on that Groomer's Public_Booking_Page without further manual steps.
4. THE "online payments not set up yet" state SHALL use DaisyUI theme tokens and SHALL meet WCAG 2.1 AA requirements.

### Requirement 18: Safe degradation when Stripe is not configured

**User Story:** As a developer, I want the app to run without Stripe configured, so that local development and partial deployments do not crash.

#### Acceptance Criteria

1. WHERE Stripe_Billing is in the Not_Configured_State, THE Groomer_Portal SHALL render a clearly-labeled "billing not set up yet" state instead of failing.
2. WHERE Stripe_Connect is in the Not_Configured_State, THE Groomer_Portal SHALL render a clearly-labeled "payouts not set up yet" state instead of failing.
3. THE Pawxis_System SHALL select the active billing provider based on configuration, returning the Stripe implementation when configured and a no-op implementation otherwise.
4. THE Pawxis_System SHALL return typed result envelopes from billing and Connect operations so that callers branch on an `ok` flag rather than catching thrown errors.

### Requirement 19: Secrets, logging, and configuration safety

**User Story:** As a Pawxis_Operator, I want secrets protected across all new flows, so that the platform stays secure.

#### Acceptance Criteria

1. THE Pawxis_System SHALL keep Stripe secret keys and Verification_Provider secrets on the server and SHALL NOT expose them to client-side code.
2. THE Pawxis_System SHALL build absolute return, success, and cancel URLs from the configured application base URL, defaulting to the production domain `pawxis.app` at launch.
3. THE Pawxis_System SHALL NOT write secrets or full webhook payloads containing secrets to application logs.
4. WHEN a configuration value is a shipped placeholder, THE Pawxis_System SHALL treat the corresponding capability as being in the Not_Configured_State.
