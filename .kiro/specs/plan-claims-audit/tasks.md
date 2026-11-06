# Implementation Plan: Plan Claims Audit

## Overview

Make every Solo and Pro claim true and enforced on the server. Work bottom-up: pure helpers first (booking guard, next-visit rule, nudge throttle, auto-fill timing, allowance predicate), then the two new emails, then wire Fill My Day, Rebooking autopilot, the booking guard and the Pro gate into their call sites, then the plan copy, and finish with the full verification and push to `main`. Test sub-tasks are marked `*` (optional). Language: TypeScript (existing Next.js 14 codebase).

## Tasks

- [x] 1. Booking guard for lapsed accounts
  - [x] 1.1 Create `src/lib/billing/booking-guard.ts`
    - Add `BookingsPausedError` (extends `AppError`, code `BOOKINGS_PAUSED`, status 403, message "This business isn't taking online bookings right now.")
    - Add pure `acceptsBookings(ent)` returning `ent.active`
    - Add `assertAcceptingBookings(groomerId)` that resolves `getEntitlements` and throws `BookingsPausedError` when not accepting
    - _Requirements: 2.2, 2.4_
  - [x] 1.2 Property test: lapsed accounts never accept bookings
    - **Property 2: Lapsed accounts never accept bookings**
    - Generate subscription inputs across all statuses, trial ends, period ends and grace windows; assert `acceptsBookings(resolveEntitlements(sub, now)) === resolveEntitlements(sub, now).active`
    - **Validates: Requirements 2.1, 2.2, 2.4**

- [x] 2. Wire the booking guard into every booking entry point
  - [x] 2.1 Guard the server entry points
    - Call `assertAcceptingBookings` and map `BookingsPausedError` to each existing error envelope in: `src/actions/availability-public.ts` (`getPublicAvailability`), `src/app/api/booking/hold/route.ts` (403 `{ error: 'bookings_paused' }`), `src/actions/booking-free.ts`, `src/lib/stripe/own-checkout.ts` (`startOwnStripeCheckout`), `src/lib/stripe/helpers.ts` (`createDepositPaymentIntent`), `src/lib/fill/claim.ts` (`confirmClaim`)
    - Do NOT guard paid-return confirmation (`/book/[slug]/paid`, Stripe webhooks) or read-only views (appointments, pet cards, receipts, ICS)
    - _Requirements: 2.2, 2.3_
  - [x] 2.2 Show a paused notice on the booking page
    - In `src/app/(booking-standalone)/book/[groomerSlug]/page.tsx`, resolve entitlements for `profile.userId`; when `acceptsBookings` is false render a `BookingsPaused` notice with the business name and, when set, phone and email links instead of the booking wizard
    - _Requirements: 2.1_
  - [x]* 2.3 Unit test: guard call sites reject a lapsed groomer
    - Mock `getEntitlements` to return an inactive view; assert the hold route returns 403 and the free-booking action returns the paused error without creating an appointment
    - _Requirements: 2.2_

- [x] 3. Pro gate on route ranking and dashboard radar data
  - [x] 3.1 Gate route-ranked slots on `orderRadar`
    - In `src/actions/availability-public.ts`, extract a pure `shapeSlotsForPlan(slots, { routingAllowed })` that strips `label` / `extraDriveMin` and sorts by time when routing is not allowed
    - Call `routeSlots()` only when `checkFeature(ent, 'orderRadar') === null`; otherwise return `routed: false`, `outsideArea: false`
    - _Requirements: 1.1, 1.2_
  - [x] 3.2 Strip route details from the dashboard for locked groomers
    - In `src/app/(portal)/dashboard/page.tsx`, when `radarLocked` is true pass `radar: []` and set every stop's `travelToNext` to null
    - _Requirements: 1.3_
  - [x]* 3.3 Property test: route ranking only for orderRadar
    - **Property 3: Route ranking only for orderRadar**
    - **Validates: Requirements 1.1, 1.2**
  - [x] 3.4 Property test: plan gate matrix
    - **Property 1: Plan gate matrix**
    - For every Pro_Feature advertised in plan copy (`orderRadar`, `fillMyDay`, `liveEta`, `rebookAutopilot`, `beforeAfter`) and generated subscriptions, assert Solo active is `FEATURE_LOCKED`, Pro/trial active is allowed, inactive is `SUBSCRIPTION_INACTIVE`
    - **Validates: Requirements 1.4, 1.5**

- [x] 4. Checkpoint: guard and gates
  - Run `npx tsc --noEmit` and the new tests; ask the user if questions arise.

- [x] 5. Message allowance predicate
  - [x] 5.1 Extract `hasAllowance(used, included, topup)` in `src/lib/messaging/usage.ts`
    - Pure: `used < included + topup`; make `canSendOptionalMessage` use it (keep its fail-open `catch`)
    - _Requirements: 3.2, 4.4_
  - [x]* 5.2 Property test: optional messages respect the allowance
    - **Property 7: Optional messages respect the allowance**
    - **Validates: Requirements 3.2, 4.4**

- [x] 6. New client emails
  - [x] 6.1 Add `sendFillOfferEmail` to `src/lib/email/send.ts`
    - `FillOfferDetails { businessName, petName?, date, time, claimUrl, replyTo?, groomerPhone? }`; heading "A spot just opened up", `detailRows` (date, time), primary `button(claimUrl, 'Claim this time')`, first-to-claim note, contact links, `EMAIL_COPY.footer`; subject `"{Business} has an opening on {date} at {time}"`; From via `fromHeader(business)`
    - _Requirements: 3.1_
  - [x] 6.2 Add `sendRebookNudgeEmail` to `src/lib/email/send.ts`
    - `RebookNudgeDetails { businessName, petName, dueDate, bookUrl, replyTo?, groomerPhone? }`; heading "Time for {pet}'s next groom", due-date line, `button(bookUrl, 'Book {pet}\u2019s visit')`, footer; subject `"{Pet} is due for a groom"`
    - _Requirements: 4.2_
  - [x] 6.3 Add `fill-offer` and `rebook-nudge` entries to `src/app/api/dev/email-preview/route.ts`
    - _Requirements: 3.1, 4.2_
  - [x]* 6.4 Unit tests for both emails via `captureEmails`
    - Assert From display name, Reply-To, subject, the claim/book link in HTML and the plain-text part
    - _Requirements: 3.1, 4.2_

- [x] 7. Fill My Day by email and on cancellation
  - [x] 7.1 Send Fill offers by email in `src/lib/fill/fill.ts`
    - Add `email` to `FillCandidate` and select it in both the waitlist populate and the due-pet client lookup; pass `smsOptOut: false` for email candidates
    - In `offerToCandidate`: skip when no email or `!canSendOptionalMessage(groomerId)`; store the claim token; send `sendFillOfferEmail` with date/time in `profile.timezone` and Reply-To `profile.businessEmail || user.email`; on success call `meterClientMessage`; keep `sendSms` only behind `isTwilioConfigured()`
    - _Requirements: 3.1, 3.2, 3.4_
  - [x] 7.2 Create `src/lib/fill/auto.ts`
    - Pure `shouldAutoFill(slotStartMs, nowMs)` (true when more than 2 hours ahead)
    - `autoFillCancelledSlot(groomerId, appt)`: return unless `shouldAutoFill` and `checkFeature(ent, 'fillMyDay') === null`; then `await fillMyDay(gid, start, end)`; never throws
    - _Requirements: 3.3, 3.5_
  - [x] 7.3 Call auto-fill on cancellation
    - In `src/actions/appointments.ts` `updateAppointmentStatus`, inside the existing `newStatus === 'cancelled'` best-effort block, await `autoFillCancelledSlot` in its own `try/catch` after cancelling reminders
    - _Requirements: 3.3_
  - [x]* 7.4 Property test: auto-fill timing
    - **Property 4: Auto-fill timing**
    - **Validates: Requirements 3.3**

- [x] 8. Rebooking autopilot by email on the daily cron
  - [x] 8.1 Switch nudges to email in `src/lib/rebooking/nudges.ts`
    - Select client `email` instead of requiring `phone` + `smsConsentAt`; skip when no email
    - Replace `shouldNudge` with the once-per-cycle rule `shouldNudge(lastNudgedAt, nextDueAt, now)` (true when missing or `lastNudgedAt < nextDueAt - 7 days`)
    - Check `canSendOptionalMessage` before sending; send `sendRebookNudgeEmail` (due date in the groomer's timezone, Reply-To groomer); on success `meterClientMessage` and set `lastNudgedAt`
    - Update existing callers/tests of `shouldNudge` to the new signature
    - _Requirements: 4.2, 4.3, 4.4_
  - [x] 8.2 Create `src/lib/rebooking/daily.ts` and call it from the cron
    - `runRebookNudgesOncePerDay(now)` takes Redis `cron:rebook:{YYYY-MM-DD}` with `SET NX EX 90000`; skips when already taken; runs anyway when Redis is not configured
    - In `src/app/api/cron/reminders/route.ts`, call it after `runDueReminders()` and include its result in the JSON response
    - _Requirements: 4.1_
  - [x]* 8.3 Property test: one nudge per due cycle
    - **Property 5: One nudge per due cycle**
    - **Validates: Requirements 4.3**

- [x] 9. Checkpoint: messaging features
  - Run `npx tsc --noEmit` and the tests touched so far; ask the user if questions arise.

- [x] 10. Coat-based next visit on the pet card
  - [x] 10.1 Add `isKnownCoat(coat)` to `src/lib/rebooking/interval.ts`
    - _Requirements: 5.2, 5.5_
  - [x] 10.2 Rewrite `computeNextRecommendedDate` in `src/lib/pet-card/assemble.ts`
    - Take `{ nextDueAt, lastServiceDate, coat, rebookIntervalWeeks, fallbackIntervalDays }`; apply the four rules from the design in order
    - Replace `AssemblePetCardInput.intervalDays` with the pet's `nextDueAt`, `coatCondition`, `rebookIntervalWeeks` and `fallbackIntervalDays`
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  - [x] 10.3 Update both callers
    - `src/actions/pets.ts` and `src/app/(public)/pet-card/[cardId]/page.tsx`: select the pet fields, pass `profile.serviceIntervalDays` as `fallbackIntervalDays`
    - Update any existing pet-card tests to the new input shape
    - _Requirements: 5.1, 5.2_
  - [x] 10.4 Property test: next visit follows the pet
    - **Property 6: Next visit follows the pet**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**
  - [x]* 10.5 Unit test: completion sets `nextDueAt` from the coat
    - Use the pure `computeNextDueAt` for each coat in `COAT_INTERVAL_WEEKS`, and an override
    - _Requirements: 5.4_

- [x] 11. Plan copy matches the product
  - [x] 11.1 Create `src/content/plan-features.ts`
    - `PLAN_FEATURES.solo` / `.pro` with message counts built from `PLANS.solo.sms` / `PLANS.pro.sms` (formatted, e.g. "2,000")
    - _Requirements: 6.1, 6.5_
  - [x] 11.2 Use the shared list everywhere
    - `src/content/landing.ts` pricing features and `src/content/for-groomers.ts` plan features read `PLAN_FEATURES`
    - `src/components/portal/BillingView.tsx` plan cards render the same list as bullets, removing "& more"
    - _Requirements: 6.3, 6.5_
  - [x] 11.3 Fix the remaining claims
    - `landing.ts`: bento "Two-way texting" becomes "Client messaging" with the email wording; "Smart booking page" gets a Pro tag; comparison rows gain `proOnly` (route-aware booking, extra driving, auto-fills cancelled slots) and "Text messaging included" becomes "Client messaging included"
    - `src/components/marketing/Comparison.tsx`: render a "Pro" pill for `proOnly` rows (add `proOnly?: boolean` to the row type)
    - `src/lib/seo/jsonld.ts`: replace "two-way texting" with "client messaging"
    - Do not mention `reviewRequests`, `customTemplates` or `optimizeDay`
    - _Requirements: 6.1, 6.2, 6.4_
  - [x]* 11.4 Unit test: copy consistency
    - Assert landing, for-groomers and billing read `PLAN_FEATURES`, and no copy file contains "two-way texting" or "texting"
    - _Requirements: 6.1, 6.5_

- [x] 12. Final verification and release
  - Run `npx vitest run` (only the two pre-existing `tests/calendar-holds.test.ts` failures allowed), `npx tsc --noEmit`, `npm run lint`, then a clean `npm run build`
  - Commit only the changed source, test and spec files (never `.env` / `.env.bak`), push to `main`, and confirm the Vercel deployment status for the commit
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 13. Follow-ups: remaining Pro tags and auto-fill on reschedule
  - [x] 13.1 Tag the remaining Pro features in marketing copy
    - `src/content/landing.ts`: bento "Rebooking autopilot" gets `pro: true`
    - `src/content/for-groomers.ts`: the "Order Radar routing" and "Live \"on my way\" tracking" feature items (and any other item for a Pro_Feature: Fill My Day, before/after cards, rebooking autopilot) get a Pro marker, rendered as the same "Pro" pill used in `BentoFeatures.tsx` / `Comparison.tsx` (screen readers hear "Pro plan")
    - Extend `tests/plan-copy.test.ts` to assert every landing bento cell and for-groomers feature item naming a Pro_Feature is tagged Pro
    - _Requirements: 6.2, 6.5_
  - [x] 13.2 Offer the freed time when an appointment is rescheduled
    - In `src/actions/appointments.ts` `moveAppointment`, capture the old start/end before saving; after the save, best-effort `await autoFillCancelledSlot(groomerId, { scheduledDate: oldStart, scheduledEndDate: oldEnd })` in its own `try/catch`, only when the old and new windows do not overlap
    - Add a test (source guard or mocked unit test) that the reschedule path calls auto-fill with the old window and never fails the move
    - _Requirements: 3.3_
  - [x] 13.3 Verify and release
    - Full `npx vitest run` (only the two pre-existing `tests/calendar-holds.test.ts` failures allowed), `npx tsc --noEmit`, `npm run lint`, clean `npm run build`; commit only the changed files (never `.env` / `.env.bak`), push to `main`, confirm the Vercel deployment
    - _Requirements: 7.1, 7.2_

- [x] 14. Daily email cap guard (Resend free plan: 100 emails/day)
  - [x] 14.1 Count sent emails per day and protect essential emails
    - In `src/lib/email/send.ts` `deliver()`, after a successful Resend send (not in capture/preview mode), best-effort `INCR` a Redis counter `email:day:{YYYY-MM-DD}` (UTC) with a ~48h TTL; add the key builder/TTL to `src/lib/redis.ts` following its `keys` / `TTL` convention; never throw or block a send
    - Add `EMAIL_DAILY_LIMIT` (env, default 100; `0` disables the guard) and pure helpers in a new `src/lib/email/daily-cap.ts`: `emailCapState(sent, limit)` returning `'ok' | 'warn' | 'reserve'` (warn at >= 80%, reserve at >= 90%), plus `getEmailsSentToday()`
    - `canSendOptionalMessage` (`src/lib/messaging/usage.ts`) returns false while the platform is in `'reserve'`, so Fill My Day offers, rebooking nudges and optional Inbox emails pause and confirmations / reminders keep the remaining quota
    - When the count first crosses the warn threshold on a day, send ONE alert email to the founder (`ADMIN_EMAIL`, falling back to `BUSINESS_EMAIL`) using a Redis `SET NX` marker per day: "Pawxis sent N of 100 emails today. Upgrade Resend to Pro to avoid dropped emails." Log `[email] daily cap` lines at warn/reserve, and log clearly when Resend rejects a send for quota (HTTP 429 / daily_quota_exceeded)
    - Include `emailsToday` and the cap state in the `/api/cron/reminders` JSON response
    - Tests: property test for `emailCapState` thresholds; unit tests that the alert sends once per day (mock Redis), that `canSendOptionalMessage` is false in `reserve`, and that preview/capture mode does not count
    - _Requirements: 3.2, 4.4_
  - [x] 14.2 Verify and release
    - Full `npx vitest run` (only the two pre-existing `tests/calendar-holds.test.ts` failures allowed), `npx tsc --noEmit`, `npm run lint`, clean `npm run build`; do NOT change the `vercel.json` cron schedule (Hobby rejects crons more often than daily); commit only the changed files (never `.env` / `.env.bak`), push to `main`, confirm the Vercel deployment
    - _Requirements: 7.1, 7.2_

- [x] 15. Fix the top-up button price label
  - [x] 15.1 Show the dollar sign on the top-up button
    - `src/components/portal/BillingView.tsx` line ~371 renders `· ${smsTopup.price}` inside a template literal, so the `$` is consumed and the button reads "· 5"; render `· $${smsTopup.price}` (or format with `Intl.NumberFormat` USD) so it reads "Top up 1,000 messages · $5"
    - Search `src/` for other places that render `SMS_TOPUP.price`, plan prices or money inside template literals with the same missing `$` (e.g. `SmsCreditsPill.tsx`, billing / for-groomers copy) and fix them
    - Extend `tests/plan-copy.test.ts` (source-text check) so the BillingView top-up label includes a `$` before the price
    - _Requirements: 6.5_

  - [x] 15.2 Final verify, commit everything worth keeping, release
    - Full `npx vitest run` (only the two pre-existing `tests/calendar-holds.test.ts` failures allowed), `npx tsc --noEmit`, `npm run lint`, clean `npm run build`
    - The founder is about to wipe this machine and re-clone, so commit every non-secret change: the 15.1 files, `.kiro/specs/plan-claims-audit/*`, `.kiro/specs/email-verify-link-fails/*`, `docs/PAWXIS_FINAL_REPORT.md` (after checking it contains no secrets). NEVER stage `.env`, `.env.bak` or any file containing keys; confirm `.env*` is gitignored
    - Push to `main`, confirm the Vercel deployment, and confirm `git status` is clean except ignored files
    - _Requirements: 7.1, 7.2_

## Notes

- Tasks marked `*` are optional tests and can be skipped for speed. Tasks 1.2, 3.4 and 10.4 are required because Requirement 7.3 asks for them.
- Requirement 5.4 is already implemented in `updateAppointmentStatus`; task 10.5 only adds a test.
- After release the founder must still change the Polar top-up price to $5 and set up the optional 15-minute external cron; neither is a code task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.2", "5.1", "6.1", "7.2", "10.1", "11.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.4", "5.2", "6.2", "7.4", "10.2", "11.2"] },
    { "id": 2, "tasks": ["2.2", "3.1", "6.3", "7.1", "8.1", "10.3", "11.3"] },
    { "id": 3, "tasks": ["2.3", "3.3", "6.4", "7.3", "8.2", "8.3", "10.4", "10.5", "11.4"] },
    { "id": 4, "tasks": ["4", "9"] },
    { "id": 5, "tasks": ["12"] },
    { "id": 6, "tasks": ["13.1", "13.2"] },
    { "id": 7, "tasks": ["13.3"] },
    { "id": 8, "tasks": ["14.1", "15.1"] },
    { "id": 9, "tasks": ["14.2"] },
    { "id": 10, "tasks": ["15.2"] }
  ]
}
```