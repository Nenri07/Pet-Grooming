# Requirements Document

## Introduction

Pawxis currently uses Stripe for two distinct money flows:

1. **Groomer → platform revenue** — groomer SUBSCRIPTIONS (Solo/Pro × monthly/annual) and one-time SMS TOP-UPS, billed through Stripe Billing.
2. **Client → groomer deposits** — booking deposits that a client pays the groomer directly through the groomer's OWN connected Stripe account (Stripe Connect). Money never touches the platform.

The platform owner (founder) is based in Pakistan and cannot receive money through Stripe. This feature introduces **Polar** (polar.sh, a merchant-of-record) as the billing provider for **flow #1 only** — the founder's own revenue (subscriptions and SMS top-ups).

**Flow #2 (client deposits) stays on Stripe Connect, unchanged.** Polar is a merchant-of-record and cannot perform marketplace split-payouts to third-party groomer accounts, so `createConnectAccountLink` and the client-deposit flow remain on Stripe. Only `createCheckout`, `createPortal`, and `createSmsTopupCheckout` move to Polar. The local 14-day free trial (`startTrial`) is already fully local (writes a `trialing` Subscription with no provider call) and stays local.

The existing architecture is reused, not rebuilt. The provider-agnostic `BillingProvider` interface (`src/lib/billing/provider.ts`), the downstream entitlements state machine (`src/lib/billing/entitlements.ts`), the `Subscription` model (`src/lib/db/models/subscription.ts`), the JWT access claim + middleware lockout, and the `/billing` BillingView UI all remain in place. A new `PolarBilling` implementation and a parallel Polar webhook route plug into these existing seams. The existing Stripe billing webhook (`src/app/api/stripe/billing-webhook/route.ts`) and the Stripe deposit webhook (`src/app/api/webhooks/stripe/route.ts`) are not altered.

### Verified Polar API facts (basis for acceptance criteria)

- Official Node SDK: `@polar-sh/sdk`. Client: `new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN, server: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox' })`.
- Next.js helper: `@polar-sh/nextjs` exposing `Webhooks({ webhookSecret, onPayload })`, which verifies the webhook signature and dispatches by `payload.type`.
- Create checkout: `polar.checkouts.create({ products, customerEmail, successUrl, metadata, externalCustomerId })` returns `{ id, url }`; the caller redirects the user to `url`.
- Products (each plan×interval and the SMS top-up) are configured in the Polar dashboard and referenced by Polar PRODUCT ID via env. Recurring vs one-time is set by the product config in Polar, not by a checkout flag.
- Customer portal: Polar exposes a customer session / portal API (exact SDK method to be pinned in design).
- Webhook events: `subscription.created`, `subscription.updated`, `subscription.active`, `subscription.canceled` (cancel-at-period-end, still active until period end), `subscription.revoked` (ended → read-only), `subscription.cycled` (renewal / trial→paid), `order.paid` (one-time payment success → credit SMS top-up), `checkout.updated`. Subscription payloads carry `status`, `current_period_end`, `cancel_at_period_end`, `metadata`, `external_customer_id`.

## Glossary

- **Polar**: The merchant-of-record billing provider (polar.sh) used for groomer-to-platform revenue (subscriptions and SMS top-ups).
- **Billing_Provider**: The provider-agnostic `BillingProvider` interface in `src/lib/billing/provider.ts` with methods `startTrial`, `createCheckout`, `createPortal`, `createSmsTopupCheckout`, `createConnectAccountLink`, each returning a typed `BillingResult` and never throwing.
- **Polar_Billing**: The new `PolarBilling` class implementing `Billing_Provider` for the subscription and SMS-top-up flows.
- **Stripe_Billing**: The existing `StripeBilling` class, retained ONLY for `createConnectAccountLink` (deposit onboarding).
- **Noop_Billing**: The existing `NoopBilling` fallback that returns `{ ok: false, reason: 'not_configured' }` for every method when billing is unconfigured.
- **Provider_Selector**: The function(s) (`getBillingProvider()` or a split selector) that choose which provider handles each operation.
- **Billing_Result**: The typed envelope `{ ok: true, url } | { ok: false, reason, message }` returned by all `Billing_Provider` methods.
- **Polar_Webhook**: The new route (`/api/polar/webhook`) that uses the `@polar-sh/nextjs` `Webhooks()` helper to verify and dispatch Polar events.
- **Subscription_Row**: A document in the `Subscription` collection (`src/lib/db/models/subscription.ts`) describing one groomer's plan, status, period boundaries, SMS allowance/top-up balance, and provider identifiers.
- **Entitlements_Cache**: The Redis-backed cache invalidated via `invalidateEntitlements(groomerId)` after any `Subscription_Row` write.
- **Groomer**: A platform user (User id) who subscribes to a Pawxis plan.
- **Product_Id**: A Polar product identifier supplied via env, mapping to a specific `(plan, interval)` or to the SMS top-up.
- **External_Customer_Id**: The Polar checkout field set to the Groomer's User id so webhooks can resolve the account.
- **Plan**: One of `solo` or `pro` (the checkoutable plans). `trial` is started locally and is not checked out.
- **Interval**: One of `month` or `year`.
- **SMS_Topup**: A one-time purchase that increments a `Subscription_Row`'s `smsTopupBalance`.
- **Connect_Flow**: The Stripe Connect deposit-onboarding flow (`createConnectAccountLink`) and the client-deposit payment flow, both retained on Stripe.

## Requirements

### Requirement 1: Polar Billing Dependencies

**User Story:** As a developer, I want the Polar SDK packages added to the project, so that `Polar_Billing` and the `Polar_Webhook` can be implemented against the official client.

#### Acceptance Criteria

1. THE Pawxis_System SHALL declare `@polar-sh/sdk` as a project dependency in `package.json`.
2. THE Pawxis_System SHALL declare `@polar-sh/nextjs` as a project dependency in `package.json`.
3. WHERE `NODE_ENV` equals `production`, THE Polar_Billing SHALL initialize the Polar client with `server` set to `production`.
4. WHERE `NODE_ENV` does not equal `production`, THE Polar_Billing SHALL initialize the Polar client with `server` set to `sandbox`.

### Requirement 2: Provider Selection and Configuration Check

**User Story:** As a developer, I want Polar selected for subscription and top-up flows when it is configured, so that the founder's revenue flows through Polar while deposits remain on Stripe.

#### Acceptance Criteria

1. THE Pawxis_System SHALL provide an `isPolarConfigured()` check that returns true WHEN the Polar access token is present AND at least one subscription Product_Id is present.
2. WHILE Polar is configured, THE Provider_Selector SHALL return Polar_Billing for the `createCheckout`, `createPortal`, and `createSmsTopupCheckout` operations.
3. WHILE Polar is not configured, THE Provider_Selector SHALL return Noop_Billing for the `createCheckout`, `createPortal`, and `createSmsTopupCheckout` operations.
4. THE Provider_Selector SHALL route the `createConnectAccountLink` operation to Stripe_Billing regardless of Polar configuration.
5. THE Polar_Billing SHALL implement every method of the Billing_Provider interface so that it is substitutable without changing callers.
6. IF a Polar_Billing method encounters an error, THEN THE Polar_Billing SHALL return a Billing_Result with `ok` equal to false and a user-safe message rather than throwing.

### Requirement 3: Subscription Checkout

**User Story:** As a Groomer, I want to subscribe to a Solo or Pro plan on a monthly or annual interval, so that I can pay the platform for my subscription.

#### Acceptance Criteria

1. WHEN `createCheckout` is called with a Plan and Interval whose Product_Id is configured, THE Polar_Billing SHALL create a Polar checkout session for that Product_Id and return a Billing_Result with `ok` equal to true and the hosted checkout `url`.
2. WHEN `createCheckout` creates a Polar checkout session, THE Polar_Billing SHALL set the External_Customer_Id to the Groomer's User id AND include the Groomer's User id in the checkout metadata.
3. WHEN `createCheckout` creates a Polar checkout session, THE Polar_Billing SHALL pass the supplied success URL to Polar as the post-payment redirect target.
4. IF `createCheckout` is called with a Plan and Interval whose Product_Id is not configured, THEN THE Polar_Billing SHALL return a Billing_Result with `ok` equal to false and reason `not_configured`.
5. IF the Polar checkout creation call fails, THEN THE Polar_Billing SHALL return a Billing_Result with `ok` equal to false and a user-safe message.

### Requirement 4: SMS Top-Up Checkout

**User Story:** As a Groomer, I want to buy a one-time SMS top-up, so that I can send more reminder messages than my plan allowance includes.

#### Acceptance Criteria

1. WHEN `createSmsTopupCheckout` is called AND the SMS top-up Product_Id is configured, THE Polar_Billing SHALL create a one-time Polar checkout session for the SMS top-up Product_Id and return a Billing_Result with `ok` equal to true and the hosted checkout `url`.
2. WHEN `createSmsTopupCheckout` creates a Polar checkout session, THE Polar_Billing SHALL set the External_Customer_Id to the Groomer's User id AND include metadata that identifies the purchase as an SMS top-up.
3. IF the SMS top-up Product_Id is not configured, THEN THE Polar_Billing SHALL return a Billing_Result with `ok` equal to false and reason `not_configured`.
4. THE Polar_Billing SHALL NOT modify the Groomer's `smsTopupBalance` during `createSmsTopupCheckout`, deferring that increment to the Polar_Webhook on payment success.

### Requirement 5: Customer Portal

**User Story:** As a Groomer, I want a self-service portal, so that I can manage or cancel my subscription and update my payment method.

#### Acceptance Criteria

1. WHEN `createPortal` is called AND Polar is configured, THE Polar_Billing SHALL create a Polar customer-portal session for the Groomer and return a Billing_Result with `ok` equal to true and the portal `url`.
2. IF the Groomer cannot be resolved to a Polar customer, THEN THE Polar_Billing SHALL return a Billing_Result with `ok` equal to false and reason `unknown_groomer`.
3. IF the Polar portal-session creation call fails, THEN THE Polar_Billing SHALL return a Billing_Result with `ok` equal to false and a user-safe message.

### Requirement 6: Polar Webhook Lifecycle Handling

**User Story:** As the platform owner, I want Polar webhook events to drive the Subscription state machine, so that a groomer's plan and status reflect their real payment state regardless of what the browser does after checkout.

#### Acceptance Criteria

1. THE Polar_Webhook SHALL be exposed at a dedicated route (for example `/api/polar/webhook`) separate from the Stripe billing webhook and the Stripe deposit webhook.
2. THE Polar_Webhook SHALL verify the incoming request signature using the Polar webhook secret via the `@polar-sh/nextjs` `Webhooks()` helper before processing any event.
3. WHEN a `subscription.created`, `subscription.updated`, `subscription.active`, or `subscription.cycled` event is received, THE Polar_Webhook SHALL update the Groomer's Subscription_Row to status `active`, set `currentPeriodEnd` from the event's `current_period_end`, set `plan` from the event's product, and set `smsIncluded` from the plan catalog.
4. WHEN a `subscription.revoked` event is received, THE Polar_Webhook SHALL update the Groomer's Subscription_Row to the read-only status used by the existing state machine for an ended subscription.
5. WHEN a `subscription.canceled` event with `cancel_at_period_end` equal to true is received, THE Polar_Webhook SHALL keep the Groomer's Subscription_Row status `active` until the period ends and SHALL NOT set it to read-only at the time of cancellation.
6. WHEN an `order.paid` event for the SMS top-up product is received, THE Polar_Webhook SHALL increment the Groomer's `smsTopupBalance` by the top-up message count.
7. THE Polar_Webhook SHALL resolve the Groomer for an event from the event's `external_customer_id` or metadata.
8. WHEN the Polar_Webhook writes a Subscription_Row, THE Polar_Webhook SHALL invalidate the Entitlements_Cache for that Groomer.
9. IF an event of an unknown or unhandled type is received, THEN THE Polar_Webhook SHALL acknowledge the event with HTTP 200 and make no state change.
10. WHEN the same Polar event is delivered more than once, THE Polar_Webhook SHALL produce the same final Subscription_Row state as a single delivery.
11. THE Polar_Webhook SHALL NOT modify any state owned by the Stripe deposit webhook or the Stripe Connect flow.
12. IF the Groomer cannot be resolved for an otherwise handled event, THEN THE Polar_Webhook SHALL acknowledge the event with HTTP 200 and make no Subscription_Row change.

### Requirement 7: Configuration Degradation

**User Story:** As a Groomer, I want the billing page to behave gracefully when billing is not configured, so that I never see a crash or a broken checkout.

#### Acceptance Criteria

1. WHILE Polar is not configured, THE Billing_View SHALL display the existing "billing isn't set up yet" state.
2. WHILE Polar is not configured, THE Billing_View SHALL keep the plan selection and top-up controls disabled.
3. WHILE Polar is not configured, THE Pawxis_System SHALL build and run without raising an error from the billing modules.

### Requirement 8: Plan and Product Mapping

**User Story:** As a developer, I want a single source of truth mapping plans and the SMS top-up to Polar product ids, so that product configuration never drifts across the codebase.

#### Acceptance Criteria

1. THE Pawxis_System SHALL provide a single mapping from each `(Plan, Interval)` pair and from the SMS top-up to its corresponding Polar Product_Id, read from env.
2. WHEN a specific Product_Id is unset, THE Pawxis_System SHALL mark only that purchase as not available.
3. WHILE one Product_Id is unset, THE Pawxis_System SHALL continue to offer every other purchase whose Product_Id is set.

### Requirement 9: Subscription Model Backward Compatibility

**User Story:** As the platform owner, I want existing subscription records to keep working after Polar is added, so that no groomer loses access and no migration is required.

#### Acceptance Criteria

1. THE Subscription_Row SHALL gain optional Polar identifier fields (for example `polarCustomerId` and `polarSubscriptionId`) added additively.
2. THE Subscription_Row SHALL retain its existing Stripe identifier fields and all existing fields unchanged.
3. WHERE a Subscription_Row has a `trialing` status or Stripe-created identifiers, THE Entitlements_System SHALL resolve its entitlements exactly as before this feature.
4. THE Pawxis_System SHALL NOT require a data migration for existing Subscription_Row documents to continue functioning.

### Requirement 10: Trial Flow Unaffected

**User Story:** As a Groomer, I want the free trial to work exactly as before, so that I can start using Pawxis without a card and without a billing provider.

#### Acceptance Criteria

1. WHEN `startTrial` is called, THE Pawxis_System SHALL write a `trialing` Subscription_Row locally without calling Polar or Stripe.
2. THE Pawxis_System SHALL resolve trial entitlements to Pro capabilities for the local trial unchanged by this feature.
3. THE Pawxis_System SHALL leave the registration-time trial persistence behavior unchanged.

### Requirement 11: Deposits Flow Unaffected

**User Story:** As a Groomer, I want client deposits to keep flowing through my own Stripe Connect account, so that my clients can still pay me directly.

#### Acceptance Criteria

1. THE Pawxis_System SHALL route `createConnectAccountLink` to Stripe_Billing unchanged.
2. THE Pawxis_System SHALL leave the client-deposit payment flow and its Stripe deposit webhook unchanged.
3. THE Pawxis_System SHALL NOT route any client-deposit money through Polar.

### Requirement 12: Secret Handling and Verification (Non-Functional)

**User Story:** As the platform owner, I want Polar secrets kept server-side and webhooks verified, so that billing cannot be spoofed and no credentials leak to the browser.

#### Acceptance Criteria

1. THE Pawxis_System SHALL read the Polar access token, webhook secret, and product ids only in server-side code.
2. THE Pawxis_System SHALL NOT expose any Polar secret to client-side code.
3. IF an incoming webhook request fails signature verification, THEN THE Polar_Webhook SHALL reject the request and make no state change.
4. THE Pawxis_System SHALL select the Polar sandbox or production server by environment configuration.

### Requirement 13: Checkout-Return Race Handling

**User Story:** As a Groomer, I want my subscription state to be correct even if I close the tab before the success page loads, so that payment I completed is always reflected.

#### Acceptance Criteria

1. THE Polar_Webhook SHALL be treated as the authoritative source for Subscription_Row state.
2. IF the Polar_Webhook updates a Subscription_Row before the Groomer returns to the success URL, THEN THE Pawxis_System SHALL preserve the webhook-written state and SHALL NOT overwrite it based on the browser redirect.
3. WHEN a `subscription.cycled` event represents a trial-to-paid conversion, THE Polar_Webhook SHALL set the Subscription_Row status to `active`.

## Notes

- Environment variables introduced by this feature (names to be finalized in design): `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER` (or derived from `NODE_ENV`), `POLAR_PRODUCT_SOLO_MONTH`, `POLAR_PRODUCT_SOLO_YEAR`, `POLAR_PRODUCT_PRO_MONTH`, `POLAR_PRODUCT_PRO_YEAR`, `POLAR_PRODUCT_SMS_TOPUP`, and optionally `POLAR_ORGANIZATION_ID`.
- The exact Polar SDK method for the customer portal (for example `polar.customerSessions.create`) is deliberately left for the design phase to pin precisely.
- Idempotency should reuse the existing Redis idempotency guard pattern used by the Stripe billing webhook where applicable.
