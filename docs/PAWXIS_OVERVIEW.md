# Pawxis — Developer Handoff & Product Overview

> A single, honest reference for any engineer picking up this codebase. Describes
> what the product does, how it is built, the end-to-end flows, every route and
> data model, external integrations, and the current real state of each feature
> (shipped / stubbed / config-gated / not built). Read this first.
>
> Repo: Next.js 14 (app router) + TypeScript. GitHub: Nenri07/Pet-Grooming →
> auto-deploys to Vercel. Live: https://pet-grooming-kappa.vercel.app (target
> domain: pawxis.app).

---

## 1. What Pawxis is

A SaaS for **mobile pet groomers** — groomers who drive to the client (the
groomer's van is the "shop"). It gives each groomer:

- a public **booking page** (`/book/{slug}`) their clients use to book,
- a **portal** to run their day (calendar, route, clients, pets, analytics,
  billing),
- **route-aware scheduling** (Order Radar) that scores how well a new booking
  fits the day's driving,
- **live "on my way" tracking** the client watches on a map,
- a **Digital Pet Card** (shareable pet profile + QR),
- **deposits** paid directly to the groomer's own Stripe account,
- a **14-day free trial** then subscription billing.

There are only **two user types**: the authenticated **groomer**, and the
**public visitor** (clients booking, viewing a pet card, or watching a tracker).
There is **no client login / client portal** — client-facing pages are all
unauthenticated capability-link pages.

---

## 2. Tech stack

- **Framework:** Next.js 14 app router (React 18, Server Components + Server
  Actions). TypeScript throughout.
- **Styling:** Tailwind CSS + **DaisyUI** themes (OKLCH tokens in
  `tailwind.config.ts`); theme switched via `next-themes` `data-theme` on
  `<html>`. shadcn/ui-style primitives (`src/components/ui/select.tsx`,
  `input.tsx`) built on Radix, themed with the DaisyUI tokens.
- **DB:** MongoDB via **Mongoose** (`src/lib/db/models/*`). Cached connection
  singleton (`src/lib/db/connect.ts`).
- **Cache / ephemeral state:** **Upstash Redis** (REST) — booking holds, booking
  locks, availability cache, live-tracking positions, OTP, rate-limit counters,
  idempotency. Everything degrades gracefully when Redis is absent.
- **Auth:** NextAuth (JWT sessions) — email/password + Google OAuth (sign-in
  only).
- **Payments:** Stripe — **Stripe Billing** for Pawxis subscriptions; **Stripe
  Connect Express (direct charges)** for client deposits that pay out to the
  groomer.
- **Maps / geo:** Mapbox GL (map + Directions + geocoding) when `MAPBOX_TOKEN`
  set; otherwise **haversine** math + free **Nominatim/OpenStreetMap** geocoding
  + **Leaflet/OSM** map. Pure routing math in `src/lib/routing/*`.
- **SMS:** Twilio (Messaging Service). **QStash** schedules reminder jobs.
- **Email:** Resend + React Email.
- **Media:** Cloudinary (pet/logo/before-after uploads).
- **PDF:** @react-pdf/renderer (receipt + pet-card PDFs). **Social image:**
  html-to-image (before/after share card).
- **Tests:** Vitest + fast-check (property tests). Some DB tests use
  mongodb-memory-server (need ~500 MB free disk).

---

## 3. High-level architecture

```
src/
  app/
    (auth)/            login, register              — centered card, no portal chrome
    (public)/          marketing landing, legal, /pet-card/[cardId], /t/[token],
                       /claim/[token], /rebook/[token]   — public, no auth
    (booking-standalone)/book/[groomerSlug]         — the booking flow, bare layout (no marketing header)
    (portal)/          dashboard, calendar, appointments, clients, pets, services,
                       availability, analytics, billing, settings, inbox, start-trial
                       — all require an authenticated groomer
    api/               route handlers (see §7)
    onboarding/        first-run groomer onboarding
    verify-email/      email verification landing
  components/          ui/ (primitives), portal/, booking/, marketing/, public/, pet-card/, motion/
  lib/
    db/                mongoose models + connect
    routing/           PURE geo/insertion/scoring + service-area + provider seams
    calendar/          availability + slot computation + holds + commit
    billing/           entitlements, access, connect status, provider seam, config
    tracking/          live ETA (track.ts, eta.ts)
    pet-card/          pure card assembly
    analytics/         pure metrics
    sms/, email/, identity/, verification/, redis.ts, timezone.ts
  actions/             server actions (booking, settings, pets, appointments, trial, ...)
  hooks/               useBookingFlow, useLiveEta
```

**Key principle:** business logic is split into **pure, DB-free cores** (routing,
availability, scoring, metrics, pet-card assembly, service-area geometry) that
are property-tested, and thin DB/HTTP orchestrators around them. Every third
party sits behind an interface/seam so it can be swapped or run absent.

**Edge-safety:** `src/middleware.ts` must stay small and must NOT import Mongoose.
Trial/lockout constants live in `src/lib/billing/constants.ts` so the access
guard the middleware uses never pulls in the entitlements → Mongoose chain.

---

## 4. Data models (`src/lib/db/models`)

- **User** — groomer account (auth). (Clients are NOT users.)
- **GroomerProfile** — business config: name, slug, logo, phone/email, deposit
  amount, estimate rules, availability windows, blocked dates, base address +
  `baseLocation`, `serviceRadiusKm`, `serviceAreaPolygon` (drawn GeoJSON),
  routing knobs (roadFactor/avgSpeedKmh/parkingMin/maxDetourMin/bufferMin),
  `timezone` (IANA), `bookingMode` (instant|request), ICS feed token, Stripe
  Connect fields (`stripeConnectAccountId`, `connectStatus`), onboarding state.
- **Service** — groomer's services: name, basePrice, durationMinutes, isActive.
- **Client** — a groomer's customer: name, email, phone, address, location,
  smsConsentAt. Scoped to a groomer.
- **Pet** — belongs to a client+groomer: name, breed, weight, age, temperament,
  coatCondition, photoUrl, specialFlags, `digitalCardId`, rebook interval.
- **Appointment** — groomerId, clientId, petId, serviceId, scheduledDate/EndDate,
  status (upcoming|in-progress|completed|cancelled), serviceAddress, location,
  routeMeta (extraDriveMin/fromPrevKm/score), bookingRef, tracking {token,
  startedAt, arrivedAt}, before/after photo urls, source, reminderJobIds.
  NOTE: has NO stored estimate or final-price field.
- **Transaction** — a Stripe deposit payment: appointmentId, stripePaymentId
  (unique → idempotency), amount, currency, status. (Only created for PAID
  deposits — no-deposit bookings create none.)
- **Subscription** — Pawxis plan state: status (trialing|active|past_due|...),
  trialStartedAt, trialDeadline + trialEndsAt (noon-in-tz on day 14),
  currentPeriodEnd, plan, smsIncluded, Stripe customer/subscription ids.
- **PendingBooking** — the pet+owner+slot payload stashed server-side when a
  deposit PaymentIntent is created, keyed by intent id (Stripe metadata is too
  small). Consumed on fulfilment.
- **IdentityBinding** — abuse-prevention ledger: one-way hashed phone → prevents
  repeat free trials by phone.
- **FillEvent** — Fill My Day offers + recovered revenue.
- **Waitlist**, **CalendarBlock** (external/ICS-derived blocks),
  **Reservation** (legacy; retained for its property test), **SmsMessage**
  (Inbox threads), **availability** (model).

---

## 5. Core flows (end to end)

### 5.1 Groomer onboarding
Register (`/register`) → email/password (or Google) → `/onboarding` collects
business profile → 14-day trial starts (no card) via `startTrialGated`
(`src/actions/trial.ts`), which writes a `trialing` Subscription with a
noon-on-day-14 `trialDeadline` and runs no-card abuse checks (email verify,
disposable-domain block, phone OTP, device/IP velocity, IdentityBinding).

### 5.2 Public booking (`/book/{groomerSlug}`)
Multi-step state machine (`src/hooks/useBookingFlow.ts`), rendered by
`BookingFlow`:
1. **Pet info** (`StepPetInfo`) — also the **service picker** (shadcn Select).
   The chosen service drives price + slot duration.
2. **Owner details** (`StepOwnerDetails`) — name/email/phone/address + SMS
   consent.
3. **Estimate** (`StepEstimate`) — `computeEstimate` server action: chosen
   service basePrice adjusted by the groomer's estimate rules (coat/weight %) →
   a min–max range.
4. **Schedule** (`StepCalendar`) — `getPublicAvailability` → `getAvailableSlots`
   generates slots from the groomer's availability windows (anchored to the
   groomer's timezone), minus existing appointments/blocks, ranked by Order
   Radar when the client location geocodes. Selecting a slot places a Redis
   **hold** and re-checks for conflicts.
5. **Payment** (`StepPayment`) — if a deposit is required AND Stripe Connect is
   complete → Stripe Payment Element (direct charge to the groomer's account).
   If **no deposit** (amount 0) → a "Confirm booking" screen (no Stripe). If a
   deposit is required but Connect isn't set up → a clear "online payments
   aren't set up yet" block.
6. **Success** (`StepSuccess`) — persists the booking and shows the receipt:
   - deposit path → `finalizeBookingByPaymentIntent` (idempotent, shares the
     core with the Stripe webhook).
   - no-deposit path → `finalizeFreeBooking`.
   Both run the shared `fulfilBookingByPaymentIntentId`/`fulfilFreeBooking` core
   in `src/lib/booking/fulfil.ts`: upsert Client + Pet, create the Appointment,
   (deposit path) record the Transaction, release the Redis hold, send
   confirmation email + SMS, schedule reminders.

### 5.3 The groomer's day (portal)
- **Dashboard** — Today's Route (timeline + travel chips + Start/Complete +
  "On my way"), Upcoming (next 14 days), Order Radar, This Month metrics,
  Fill My Day, Rebooking, SMS credits, Pet Cards entry.
- **Calendar** — day/week views, drag-to-move + resize (dnd-kit), themed blocks,
  tap-to-open detail. Times render in the groomer's timezone.
- **Appointments / Clients / Pets / Services / Availability / Analytics /
  Billing / Settings / Inbox** — standard CRUD + views.

### 5.4 Live tracking ("On my way")
Groomer taps "On my way" (`LiveEtaControl` or dashboard) → `useLiveEta` POSTs
`/api/portal/track/{id}` → `startTracking` mints a token on the appointment,
texts+emails the client a `/t/{token}` link, and begins posting the van position
(browser geolocation, every ~20s) to Redis. The public `/t/{token}` page polls
`/api/track/{token}` every 10s → `resolveTracker` returns van + destination +
ETA. Requires Redis (positions live only in Redis). Degrades honestly: shows
"live location unavailable" when Redis is off, and warns the groomer when
geolocation is denied.

### 5.5 Deposits (Stripe Connect — "BYOK")
Each groomer connects their OWN Stripe account (Connect Express). Client
deposits are **direct charges** on the groomer's account — Pawxis never holds
the money (0 platform fee at launch). Gate: deposit bookings only proceed when
`connectStatus === 'complete'`.

### 5.6 Digital Pet Card
Groomer: **Clients → client → pet** (or the new **Pets** nav → pet) →
"Generate Digital Pet Card" → gets `/pet-card/{cardId}` (public, QR, PDF
download). Distribution is MANUAL (groomer copies/sends the link); there is no
auto-delivery and no client portal.

### 5.7 Order Radar (route-fit)
Pure insertion scoring (`src/lib/routing/insertion.ts` + `scoring.ts`): for a
candidate booking, find prev/next stops by time, reject on overlap/infeasible
drive, compute extra driving minutes, score 0–100 (penalties for extra drive +
sliver gaps, bonuses for close-prev + cluster days). Drive times via the
TravelProvider (haversine default, Mapbox when keyed). In `instant` mode
bookings auto-confirm; `request` mode is meant to show Accept/Decline (that
handler is a STUB — see §8).

---

## 6. App routes

**Public / auth / booking:**
`/` landing · `/login` · `/register` · `/onboarding` · `/verify-email` ·
`/book/[groomerSlug]` · `/pet-card/[cardId]` · `/t/[token]` (tracker) ·
`/claim/[token]` (Fill My Day) · `/rebook/[token]` · legal: `/terms`
`/privacy` `/cookies` `/refunds` `/acceptable-use` `/credits` · `/for-groomers`

**Portal (auth required):**
`/dashboard` · `/calendar` · `/appointments` + `/appointments/[id]` ·
`/clients` + `/clients/[clientId]` · `/pets` + `/pets/[petId]` · `/services` ·
`/availability` · `/analytics` · `/billing` · `/settings` · `/inbox` ·
`/start-trial`

---

## 7. API endpoints (`src/app/api`)

- `POST /api/booking/hold` — place a tentative Redis slot hold (rate-limited).
- `GET  /api/booking/slots` — availability slots (rate-limited).
- `POST /api/portal/track/[id]` — start/position/stop live tracking (Pro-gated).
- `GET  /api/track/[token]` — public tracker poll.
- `GET  /api/portal/radar` — Order Radar feed (Pro-gated).
- `POST /api/portal/fill` — Fill My Day offer (Pro-gated).
- `GET  /api/portal/sms-usage` — SMS quota meter.
- `GET  /api/ics/[token]` — read-only ICS calendar feed.
- `GET  /api/claim/[token]` + `POST /api/claim/[token]/confirm` — Fill My Day claim.
- `POST /api/webhooks/stripe` — platform + Connect account events (deposits).
- `POST /api/stripe/billing-webhook` — subscription lifecycle.
- `POST /api/stripe/connect-webhook` — Connect account/charge events.
- `POST /api/twilio/inbound` + `POST /api/twilio/status` — SMS inbound + delivery.
- `POST /api/qstash/reminder` + `POST /api/qstash/rebook-nudges` — scheduled jobs.
- `src/app/api/cron/*` — cron-triggered jobs (Bearer CRON_SECRET).

---

## 8. Feature status — the honest state

| Feature | State |
|---|---|
| Groomer auth, onboarding, trial + no-card abuse prevention | ✅ Built |
| Public booking flow (6 steps) incl. service picker | ✅ Built |
| Instant estimate (basePrice + rules) | ✅ Built |
| Availability + slot generation (timezone-correct) | ✅ Built |
| Deposit payments via Stripe Connect direct charges | ✅ Built (needs Connect config + onboarding) |
| No-deposit ($0) booking persistence | ✅ Built |
| Booking receipt on-screen / print / PDF | ✅ Built (print = on-screen; PDF is a separate @react-pdf render, aligned branding) |
| Dashboard (route, upcoming, radar, metrics, fill, SMS) | ✅ Built |
| Calendar (day/week, drag/resize, themed) | ✅ Built |
| Order Radar scoring math | ✅ Built (pure + tested) |
| Order Radar **Accept/Decline** (request mode) | ⚠️ STUB (`TODO(phase-3/6)`) |
| Live tracking (map + ETA) | ✅ Built — needs Redis (now configured) |
| Mapbox map/ETA/geocoding | ✅ Built, degrades to haversine/Leaflet/OSM without `MAPBOX_TOKEN` |
| Service-area polygon gate | ✅ Built (needs `NEXT_PUBLIC_MAPBOX_TOKEN` to draw) |
| Digital Pet Card (page, PDF, QR) | ✅ Built — distribution is manual |
| Before/After share card | ✅ Built (Pro-gated) |
| Analytics: deposits + est. service revenue | ✅ Built (est. uses Service.basePrice as stand-in) |
| SMS (Twilio) + reminders (QStash) | ✅ Built, config-gated; A2P 10DLC registration is operator work |
| Subscription billing (Stripe Billing) | ✅ Built, config-gated |
| Paddle / Lemon Squeezy (merchant-of-record) | ❌ Not built — only a provider seam exists |
| Client portal / auto-delivery of pet-card link | ❌ Not built (by design) |

---

## 9. Environment variables

See `.env.example` for the full annotated list. Everything degrades gracefully
when unset. Groups:
- **Core:** `MONGODB_URI`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`.
- **Google OAuth:** `GOOGLE_CLIENT_ID/SECRET` (sign-in only).
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; Billing price ids
  `STRIPE_PRICE_{SOLO,PRO}_{MONTH,YEAR}`, `STRIPE_BILLING_WEBHOOK_SECRET`;
  Connect `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_WEBHOOK_SECRET`,
  `STRIPE_PLATFORM_FEE_PERCENT` (0).
- **Redis:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- **Mapbox:** `MAPBOX_TOKEN` (server), `NEXT_PUBLIC_MAPBOX_TOKEN` (client map).
- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_VERIFY_SERVICE_SID`.
- **QStash:** `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
- **Email:** `RESEND_API_KEY`, `BUSINESS_EMAIL`, `NEXT_PUBLIC_BUSINESS_NAME`.
- **Media:** `UPLOADTHING_*` / Cloudinary vars.
- **Abuse/trial:** `IDENTITY_PHONE_PEPPER`, `DISPOSABLE_DOMAINS_SOURCE`,
  `TRIAL_VELOCITY_THRESHOLD`, `TRIAL_VELOCITY_WINDOW_HOURS`,
  `EMAIL_VERIFICATION_TTL_MIN`, `SMS_INCLUDED_DEFAULT`, `CRON_SECRET`.

---

## 10. Running & verifying

```
npm install
npm run dev            # local dev
npm run build          # production build (also the real type/route check)
npx tsc --noEmit       # type check
npm test -- --run      # vitest (DB tests need ~500MB free disk for mongodb-memory-server)
```

Backfills (one-time ops): `npm run backfill:trial-deadline`,
`npm run backfill:connect-status`.

Deploy: push to `main` → Vercel builds + deploys. Set the env vars above in the
Vercel project (Production). Point the Stripe/Twilio webhooks at the deployed
`/api/...` endpoints.

---

## 11. Known gaps / deferred (future work)

- **Order Radar request-mode Accept/Decline** handler is a stub.
- **No client portal / no auto-delivery** of the pet-card or tracker links —
  groomer shares them manually. Cheapest future win: include the pet-card link
  in the confirmation email / after a completed groom.
- **No stored "final price"** on Appointment — "Est. service revenue" uses
  `Service.basePrice` as a stand-in; a real editable final price is future work.
- **No-deposit booking** persists via the first active service (the client-picked
  service id isn't threaded into the free-finalize path yet).
- **Settings timezone input** isn't validated (the shared `tzOf` helper now
  defends against bad stored values, but prevention at input is a follow-up).
- **A2P 10DLC** brand/campaign registration + multi-tenant inbound SMS routing
  are operator/seam work, not in code.

---

## 12. Gotchas for the next engineer

- **Timezone:** all stored dates are UTC instants. Display + slot generation go
  through `src/lib/timezone.ts` with the groomer's IANA `timezone`. A non-IANA
  value (e.g. "PKT", "Asia/Lahore") used to crash every portal page; `tzOf` now
  falls back to UTC, but store a real IANA zone (e.g. `Asia/Karachi`).
- **Middleware is Edge-safe** — never import Mongoose into anything it imports.
- **@react-pdf** can't read CSS vars — the PDF receipt/pet-card are separate
  renders with literal colors; they intentionally approximate (not pixel-match)
  the on-screen component.
- **Mapbox GL doesn't read CSS vars** either — map colors are read from the
  computed `--p` token at runtime or fall back to a hex.
- **Everything degrades without keys** (Redis/Twilio/Mapbox/Stripe) — features
  no-op-and-log rather than crash. "0/300 SMS", "waiting for the van", "payments
  not set up" are usually missing config, not bugs.
- **Specs/history:** `.kiro/specs/billing-trial-and-payments` (the big billing
  spec) and `.kiro/specs/bug-fix-1` / `bug-fix-2` (the two bugfix sprints)
  record decisions and the fix history.