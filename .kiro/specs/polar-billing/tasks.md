# Implementation Plan: Polar Billing

## Overview

Add Polar as the billing provider for groomer subscriptions and SMS top-ups while keeping client deposits on Stripe Connect. Work bottom-up: install the SDK, add the pure mapping module, the client singleton, the model fields, then `PolarBilling`, wire provider selection, add the webhook, and finish with env docs. Each task names the files it touches and the requirements it satisfies. Test sub-tasks are marked `*` (optional / skippable for a fast MVP). The implementation language is TypeScript (the existing codebase).

## Tasks

- [ ] 1. Add Polar SDK dependencies
  - Add `@polar-sh/sdk` and `@polar-sh/nextjs` to `package.json` (pinned versions) and install
  - Verify the project still builds/type-checks with the new packages present
  - _Requirements: 1.1, 1.2_

- [ ] 2. Pure product + discount mapping module
  - [ ] 2.1 Create `src/lib/billing/polar-products.ts`
    - Implement `productIdFor`, `smsTopupProductId`, `planIntervalForProductId`, `isSmsTopupProduct`, `discountIdForInterval`, `isPolarConfigured` with placeholder-aware `cfg()` reading the `POLAR_PRODUCT_*` / `POLAR_DISCOUNT_*` / `POLAR_ACCESS_TOKEN` envs
    - _Requirements: 2.1, 8.1, 8.2, 8.3_
  - [ ]* 2.2 Property test — product mapping round-trip
    - **Property 1: Product mapping round-trip** and **Property 2: Reverse mapping agrees with forward**
    - **Validates: Requirements 8.1**
  - [ ]* 2.3 Property test — unset product disables only that purchase
    - **Property 3: Unset product disables only that purchase**
    - **Validates: Requirements 8.2, 8.3**
  - [ ]* 2.4 Property test — discount selection by interval
    - **Property 4: Discount selection by interval**
    - **Validates: Requirements 3.1 (early-bird discount decision)**
  - [ ]* 2.5 Unit test — `isPolarConfigured()` truth table
    - Token present/absent × at least one product id present/absent
    - _Requirements: 2.1_

- [ ] 3. Polar client singleton
  - [ ] 3.1 Create `src/lib/polar/client.ts`
    - Lazy, cached `getPolar()`; `resolveServer()` prefers `POLAR_SERVER`, falls back to `NODE_ENV`; import-safe (throws only on use when unconfigured); `isPolarClientConfigured()`
    - _Requirements: 1.3, 1.4, 7.3, 12.1, 12.4_
  - [ ]* 3.2 Unit test — server resolution + import safety
    - `POLAR_SERVER` override and `NODE_ENV` fallback; importing the module while unconfigured does not throw
    - _Requirements: 1.3, 1.4, 7.3_

- [ ] 4. Subscription model additive fields
  - [ ] 4.1 Edit `src/lib/db/models/subscription.ts`
    - Add optional `polarCustomerId` / `polarSubscriptionId` to `ISubscription` and the schema (default `null`); add sparse indexes; keep all Stripe fields unchanged
    - _Requirements: 9.1, 9.2, 9.4_
  - [ ]* 4.2 Unit test — backward compatibility
    - A row with no Polar fields and an existing Stripe/trial row still resolves entitlements unchanged
    - _Requirements: 9.3_

- [ ] 5. PolarBilling provider
  - [ ] 5.1 Create `src/lib/billing/polar.ts` with `PolarBilling` class skeleton
    - Implement `BillingProvider`; add `polarError()` envelope helper and private `groomerEmail()`; `createConnectAccountLink` delegates to a `StripeBilling` instance; `startTrial` writes the local `trialing` row (mirror `StripeBilling.startTrial`) with no SDK call
    - _Requirements: 2.5, 2.6, 10.1, 11.1_
  - [ ] 5.2 Implement `createCheckout`
    - Resolve product via `productIdFor`; `not_configured` when unset; call `getPolar().checkouts.create` with `products:[id]`, `successUrl`, `externalCustomerId: groomerId`, metadata `{groomerId, plan, interval}`, and `discountId` from `discountIdForInterval` when present; return `{ok:true,url}`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ] 5.3 Implement `createSmsTopupCheckout`
    - `not_configured` when top-up product unset; create checkout with metadata `{groomerId, kind:'sms_topup'}`; do NOT change `smsTopupBalance` here
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 5.4 Implement `createPortal`
    - Prefer stored `polarCustomerId` → `customerSessions.create({customerId})`; else `customerExternalId: groomerId`; read `customerPortalUrl`; `unknown_groomer` when no URL; error envelope on throw
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 5.5 Unit test — checkout + top-up checkout (mocked getPolar)
    - Assert checkout args (products, externalCustomerId, metadata, successUrl, discountId by interval), `not_configured` paths, and error envelope on throw; top-up leaves balance untouched
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.4, 2.6_
  - [ ]* 5.6 Unit test — portal + trial + connect delegation (mocked)
    - `createPortal` reads `customerPortalUrl` / `unknown_groomer`; `startTrial` writes local `trialing` with no SDK call; `createConnectAccountLink` delegates to Stripe
    - _Requirements: 5.1, 5.2, 10.1, 11.1_

- [ ] 6. Provider selection
  - [ ] 6.1 Edit `src/lib/billing/provider.ts`
    - Re-export `isPolarConfigured` from `polar-products`; change `getBillingProvider()` precedence to Polar → Stripe billing → Noop with a lazy require of `PolarBilling`
    - _Requirements: 2.2, 2.3, 2.4_
  - [ ]* 6.2 Unit test — selection precedence
    - Polar configured → PolarBilling; only Stripe configured → StripeBilling; neither → NoopBilling; Connect always routes to Stripe
    - _Requirements: 2.2, 2.3, 2.4, 11.1_

- [ ] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Pure webhook logic module
  - [ ] 8.1 Create `src/lib/billing/polar-webhook.ts`
    - Implement pure `mapEventToIntent(payload)` (event type + flags + product → set-status | credit-topup | null), `resolveGroomerId(payload)` (metadata → customer.externalId → external_customer_id, defensive), and `extractEventId(payload)`
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 13.3_
  - [ ]* 8.2 Property test — event → status mapping
    - **Property 5: Webhook event → status mapping**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.9, 13.3**
  - [ ]* 8.3 Property test — write idempotence
    - **Property 6: Webhook write idempotence** (apply set-status intent once vs twice → same state)
    - **Validates: Requirements 6.10, 13.2**

- [ ] 9. Polar webhook route
  - [ ] 9.1 Create `src/app/api/polar/webhook/route.ts`
    - `POST = Webhooks({ webhookSecret, onPayload })`; `runtime='nodejs'`, `dynamic='force-dynamic'`; in `onPayload`: connectDB, idempotency guard (`polar:{eventId}`), resolve groomer (ack 200 if none), apply `mapEventToIntent` result via `Subscription.findOneAndUpdate` ($set for status/plan/smsIncluded/currentPeriodEnd/polar ids; $inc for top-up using `SMS_TOPUP.messages`), then `invalidateEntitlements`; ack 200 on unknown
    - _Requirements: 6.1, 6.2, 6.7, 6.8, 6.9, 6.11, 6.12, 12.3, 13.1, 13.2_
  - [ ]* 9.2 Integration test — subscription lifecycle writes
    - `subscription.active` → active + plan/smsIncluded/currentPeriodEnd + cache invalidated; `revoked` → read-only; `canceled`+cancel_at_period_end → stays active
    - _Requirements: 6.3, 6.4, 6.5, 6.8_
  - [ ]* 9.3 Integration test — top-up credit + idempotent redelivery
    - `order.paid` (top-up product) → `smsTopupBalance += SMS_TOPUP.messages`; duplicate delivery → same final state
    - _Requirements: 6.6, 6.10_

- [ ] 10. Document new environment variables
  - [ ] 10.1 Update `.env.example`
    - Add `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`, `POLAR_PRODUCT_SOLO_MONTH`, `POLAR_PRODUCT_SOLO_YEAR`, `POLAR_PRODUCT_PRO_MONTH`, `POLAR_PRODUCT_PRO_YEAR`, `POLAR_PRODUCT_SMS_TOPUP`, `POLAR_DISCOUNT_MONTHLY`, `POLAR_DISCOUNT_YEARLY` with comments; values empty/placeholder
    - _Requirements: 12.1, 12.2_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (unit/property/integration tests) and can be skipped for a faster MVP.
- Deposits stay on Stripe Connect: `PolarBilling.createConnectAccountLink` delegates to `StripeBilling`; the Stripe deposit webhook is untouched (R11).
- No data migration: Subscription changes are additive optional fields (R9.4).
- The portal `customerExternalId` create-field and the exact webhook event field paths are confirmed against the installed SDK / real event shapes during tasks 5.4 and 8.1.
- Property tests use `fast-check` + Vitest at ≥100 iterations, tagged `Feature: polar-billing, Property N: ...`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "10.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "4.2", "5.1", "8.1"] },
    { "id": 2, "tasks": ["5.2", "8.2", "8.3"] },
    { "id": 3, "tasks": ["5.3"] },
    { "id": 4, "tasks": ["5.4"] },
    { "id": 5, "tasks": ["5.5", "5.6", "6.1", "9.1"] },
    { "id": 6, "tasks": ["6.2", "9.2", "9.3"] }
  ]
}
```
