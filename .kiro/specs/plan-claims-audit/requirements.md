# Requirements Document

## Introduction

Pawxis advertises a Solo plan ($29/mo) and a Pro plan ($59/mo) on the landing page, the For Groomers page, the comparison table and the in-app Billing page. This feature checks every advertised claim against the code, makes plan limits hold on the server, builds the parts of the claims that are missing, and rewrites the claims that the product cannot honestly make today.

### Audit findings (basis for these requirements)

| Advertised claim | Plan | State in code today |
|---|---|---|
| Branded booking page | Solo | Built. Not blocked when the subscription has lapsed. |
| Deposits & no-show protection | Solo | Built (own Stripe key or payment link). |
| Native calendar & ICS feed | Solo | Built (`/api/ics/[token]`). |
| Two-way texting included | Solo | Not true. Messages go out by email; client replies land in the groomer's own mailbox; no SMS. |
| Digital Pet Cards | Solo | Built. "Next visit" uses the groomer-wide `serviceIntervalDays` (default 42 days) and ignores the pet's coat-based `nextDueAt`. |
| Appointment reminders | Solo | Built (email + WhatsApp button). |
| Order Radar route ranking | Pro | Dashboard radar API is Pro-gated. Route-ranked public slots ("Best fit") run for every plan, including Solo and lapsed accounts. |
| Fill My Day auto-offers | Pro | Server-gated, but only runs when the groomer presses the button, and offers are sent by SMS only. Without Twilio no client receives anything. |
| Live "on the way" tracking | Pro | Built and server-gated. |
| Rebooking autopilot | Pro | Server-gated, but nudges are sent by SMS only (nothing is delivered) and the daily job is not on the Vercel cron; it relies on a QStash schedule that is not configured. |
| Before/after share cards | Pro | Built and server-gated. |
| Comparison table: "Auto-fills cancelled slots", "Text messaging included" | Both | Same gaps as Fill My Day and texting above. The table does not say which rows need Pro. |
| Feature keys `reviewRequests`, `customTemplates`, `optimizeDay` | Pro | Defined in `PLANS` but not built and not advertised. |

## Glossary

- **Pawxis_App**: The Next.js application deployed at www.pawxis.app.
- **Groomer**: A signed-in Pawxis account holder who owns a booking page.
- **Client**: A pet owner who books with a Groomer.
- **Entitlements**: The resolved plan view returned by `getEntitlements(groomerId)` in `src/lib/billing/entitlements.ts`. A trialing Groomer receives Pro features.
- **Active_Account**: A Groomer whose Entitlements have `active = true` (trialing, active, or past_due inside the 7-day grace period).
- **Lapsed_Account**: A Groomer whose Entitlements have `active = false` (trial ended, canceled, expired, or past_due after grace).
- **Pro_Feature**: A feature key present in `PLANS.pro.features` and absent from `PLANS.solo.features`.
- **Message_Allowance**: The monthly client-message allowance plus top-up balance, metered by `src/lib/messaging/usage.ts`.
- **Fill_Offer**: A Fill My Day message offering an open slot to a waitlisted or due Client, containing a claim link.
- **Rebook_Nudge**: A Rebooking autopilot message asking a Client whose pet is due to book again.
- **Next_Visit_Date**: The "Next visit" date shown on a Digital Pet Card.
- **Coat_Interval**: The rebooking interval for a pet: the pet's `rebookIntervalWeeks` override when set, otherwise the coat-based default from `src/lib/rebooking/interval.ts`.
- **Plan_Copy**: Every user-facing statement of plan contents: `src/content/landing.ts`, `src/content/for-groomers.ts`, `src/components/portal/BillingView.tsx` and the JSON-LD description in `src/lib/seo/jsonld.ts`.

## Requirements

### Requirement 1: Server-side enforcement of Pro features

**User Story:** As the founder, I want every Pro feature blocked on the server for Solo and Lapsed accounts, so that a Solo groomer cannot use what they did not pay for by calling an endpoint directly.

#### Acceptance Criteria

1. WHEN a Client requests booking slots from a Groomer whose Entitlements do not include `orderRadar`, THE Pawxis_App SHALL return the slots in time order without route ranking, without the "Best fit" marker and without the outside-area flag.
2. WHEN a Client requests booking slots from a Groomer whose Entitlements include `orderRadar` and the Groomer has a base location, THE Pawxis_App SHALL return route-ranked slots with the "Best fit" marker.
3. WHEN a Groomer without the `orderRadar` feature loads the dashboard, THE Pawxis_App SHALL show the Order Radar card in its locked state and SHALL NOT include route details (distance, added driving minutes, previous stop) in the page data.
4. WHEN a Groomer without the required feature calls the Fill My Day, Live ETA, Rebooking autopilot or Before/after endpoints, THE Pawxis_App SHALL respond with HTTP 403 and the locked envelope, as it does today.
5. THE Pawxis_App SHALL have an automated test that checks, for each Pro_Feature advertised in Plan_Copy, that a Solo Entitlements view is denied and a Pro Entitlements view is allowed.

### Requirement 2: Lapsed accounts stop taking new bookings

**User Story:** As the founder, I want a lapsed groomer's booking page to stop accepting new bookings, so that the product is not used for free after the trial or subscription ends.

#### Acceptance Criteria

1. WHEN a Client opens the booking page of a Lapsed_Account, THE Pawxis_App SHALL show a notice that the business is not taking online bookings right now, together with the Groomer's phone number and email when they are set.
2. WHEN a Client submits a slot hold, a free booking or a deposit checkout for a Lapsed_Account, THE Pawxis_App SHALL reject the request on the server with a clear error and SHALL NOT create an appointment or a hold.
3. WHILE a Groomer is a Lapsed_Account, THE Pawxis_App SHALL keep existing appointments, pet cards, receipts and the ICS feed readable.
4. WHEN a Lapsed_Account becomes an Active_Account again, THE Pawxis_App SHALL accept new bookings within 60 seconds (the Entitlements cache lifetime) without manual steps.

### Requirement 3: Fill My Day offers reach clients and start automatically

**User Story:** As a Pro groomer, I want cancelled slots offered to clients automatically by email, so that "Fill My Day auto-offers" and "Auto-fills cancelled slots" are true without Twilio.

#### Acceptance Criteria

1. WHEN Fill My Day sends a Fill_Offer to a Client who has an email address, THE Pawxis_App SHALL deliver it by email using the groomer-branded email layout, with the claim link, the slot date and time in the Groomer's timezone, and Reply-To set to the Groomer.
2. WHEN a Fill_Offer is emailed, THE Pawxis_App SHALL count it against the Groomer's Message_Allowance as an optional message, and SHALL skip sending when the allowance is used up.
3. WHEN an appointment of a Groomer with the `fillMyDay` feature is cancelled and the cancelled slot starts more than 2 hours in the future, THE Pawxis_App SHALL run Fill My Day for that slot without the Groomer pressing a button.
4. IF a Client has no email address, THEN THE Pawxis_App SHALL skip that Client and continue with the next candidate.
5. WHEN Fill My Day runs automatically, THE Pawxis_App SHALL record the run so the dashboard's "recovered this month" figure includes slots filled this way.

### Requirement 4: Rebooking autopilot reaches clients on a schedule

**User Story:** As a Pro groomer, I want clients nudged to rebook when their pet is due, so that "Rebooking autopilot" works without Twilio or extra setup.

#### Acceptance Criteria

1. THE Pawxis_App SHALL run the Rebook_Nudge sweep once a day from the existing daily Vercel cron (`/api/cron/reminders`, authorised with `CRON_SECRET`), with no QStash schedule required.
2. WHEN the sweep finds a pet whose `nextDueAt` is within 7 days, whose owner has no future appointment and an email address, and whose Groomer has the `rebookAutopilot` feature, THE Pawxis_App SHALL email a Rebook_Nudge with a booking link, using the groomer-branded layout and Reply-To set to the Groomer.
3. THE Pawxis_App SHALL send at most one Rebook_Nudge per pet per due cycle, using the existing `lastNudgedAt` throttle.
4. WHEN a Rebook_Nudge is emailed, THE Pawxis_App SHALL count it against the Groomer's Message_Allowance as an optional message, and SHALL skip sending when the allowance is used up.

### Requirement 5: Next visit on the pet card follows the pet's coat

**User Story:** As a groomer, I want the pet card's next-visit date to follow the pet's coat, so that a short-coated dog is not told to come back on the same 42-day cycle as a doodle.

#### Acceptance Criteria

1. WHEN a pet has a stored `nextDueAt`, THE Pawxis_App SHALL show that date as the Next_Visit_Date on the pet card page, the portal pet card and the shared card image.
2. WHEN a pet has a last completed groom but no `nextDueAt`, THE Pawxis_App SHALL compute the Next_Visit_Date as the last groom date plus the pet's Coat_Interval.
3. WHEN a pet has no completed groom, THE Pawxis_App SHALL NOT show a Next_Visit_Date and SHALL NOT add a fixed number of days to any other date.
4. WHEN an appointment is completed, THE Pawxis_App SHALL set the pet's `lastGroomAt` and `nextDueAt` using the Coat_Interval, so the pet card, the dashboard "due for rebooking" count and the Rebook_Nudge sweep use the same date.
5. THE Pawxis_App SHALL use the Groomer's `serviceIntervalDays` only as a fallback when the pet's coat cannot be mapped to an interval.

### Requirement 6: Plan copy matches the product

**User Story:** As the founder, I want every plan statement to be true today, so that a groomer who signs up gets what the pricing page says.

#### Acceptance Criteria

1. THE Plan_Copy SHALL describe client messaging as email messaging with the monthly allowance (Solo 800, Pro 2000) and SHALL NOT claim SMS or two-way texting.
2. THE comparison table SHALL replace "Text messaging included" with a client-messaging row that is true today, and SHALL mark the rows that require Pro (route-aware booking, extra driving per booking, auto-filling cancelled slots).
3. THE Billing page plan cards SHALL list the same features as the public pricing cards for each plan, without "& more".
4. THE Plan_Copy SHALL NOT advertise `reviewRequests`, `customTemplates` or `optimizeDay`.
5. WHEN a statement in Plan_Copy changes, THE Pawxis_App SHALL keep the landing page, the For Groomers page, the Billing page and the JSON-LD description consistent with each other.

### Requirement 7: Verification before release

**User Story:** As the founder, I want each change verified before it ships, so that the live site does not break.

#### Acceptance Criteria

1. THE Pawxis_App SHALL pass `npx tsc --noEmit`, lint and `npm run build` before the changes are pushed to `main`.
2. THE Pawxis_App SHALL pass the existing test suite, except the two `tests/calendar-holds.test.ts` failures that predate this feature.
3. THE Pawxis_App SHALL include tests for the coat-based Next_Visit_Date (Requirement 5), the lapsed-account booking block (Requirement 2) and the plan gate matrix (Requirement 1.5).