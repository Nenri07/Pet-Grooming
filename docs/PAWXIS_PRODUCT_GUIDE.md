# Pawxis Product Guide

**Audience:** product management, partners, new team members
**Live site:** https://www.pawxis.app
**Status:** live, taking trials and paid subscriptions
**Last updated:** November 2026

> **How to use this document.** Boxes marked **[Screenshot]** or **[Demo video]** are placeholders. Replace each one with the image or a link to the recording. A ready-made demo account with sample data is described in [section 12](#12-demo-account).

---

## Contents

1. [Summary](#1-summary)
2. [The problem and who it is for](#2-the-problem-and-who-it-is-for)
3. [Product surfaces](#3-product-surfaces)
4. [Plans and pricing](#4-plans-and-pricing)
5. [Key user journeys](#5-key-user-journeys)
6. [Feature reference: client-facing](#6-feature-reference-client-facing)
7. [Feature reference: groomer portal](#7-feature-reference-groomer-portal)
8. [Payments](#8-payments)
9. [Messages and notifications](#9-messages-and-notifications)
10. [How the numbers are calculated](#10-how-the-numbers-are-calculated)
11. [Feature status and known gaps](#11-feature-status-and-known-gaps)
12. [Demo account](#12-demo-account)
13. [Platform, integrations and dependencies](#13-platform-integrations-and-dependencies)
14. [Page map](#14-page-map)
15. [Glossary](#15-glossary)

Related documents in `docs/`:
- `PAWXIS_FINAL_REPORT.md`: running costs, unit economics, go-to-market plan.
- `PAWXIS_OVERVIEW.md`: engineering handoff (architecture, data model, APIs).
- `PAWXIS_DATABASE_SCHEMA.md`: every database collection and field, with UML diagrams (generated from the code).
- `outreach.md`: sales outreach templates.

---

## 1. Summary

Pawxis is booking and route software for **solo mobile pet groomers**: one groomer, one van, driving to each client's home.

**Tagline:** *Groom more dogs. Drive less.*

Each groomer gets:
- a **branded booking page** their clients book from, with no app for clients to install,
- a **portal** to run the day: today's route, calendar, clients, pets, services, availability, inbox, analytics and billing,
- **route-aware booking (Order Radar)** that shows how far each new booking is from the other stops and how much driving it adds,
- **automation that keeps the day full**: Fill My Day re-offers cancelled slots, and Rebooking autopilot brings clients back on schedule.

Every new groomer starts on a **14-day Pro trial with no card**. After that the plans are **Solo at $29/month** and **Pro at $59/month**.

> **[Screenshot]** Landing page hero (https://www.pawxis.app)

> **[Demo video]** 60 to 90 second product overview

---

## 2. The problem and who it is for

### The problem
A solo mobile groomer loses time and money in three ways:
1. **Driving.** Bookings arrive in random order, so the day zig-zags across town.
2. **No-shows and late cancellations.** A dropped appointment is an empty hour that rarely gets refilled.
3. **Scattered communication.** Bookings and questions come by text, DM, phone and email, and things get missed.

Most grooming software is built for salons: multiple staff, a fixed location, and per-seat pricing.

### Who it is for
| Segment | Fit | Notes |
|---|---|---|
| Solo mobile groomers in the US, roughly 40 to 150 active clients | **Primary** | Feels the driving and no-show pain every week |
| New mobile groomers setting up their first booking page | Secondary | Want to look professional from day one |
| Salons, multi-van fleets | Not a fit today | No staff accounts or per-van routing |
| Groomers who rely on two-way SMS | Not a fit today | Client messaging is email only (see [section 9](#9-messages-and-notifications)) |

### Positioning
- **Lead with routing:** every new booking shows how much driving it adds, and the booking page suggests times that fit the route.
- **Second:** Fill My Day and Rebooking autopilot fill cancelled slots and bring clients back without the groomer chasing them.
- **Price:** Solo $29 and Pro $59, against roughly $49 to $159 per van per month for a leading competitor's mobile plans (see the final report for sources).
- **Honesty rule:** the site never names competitors, never claims SMS texting, and shows no invented stats or testimonials.

---

## 3. Product surfaces

There are only two kinds of user: the **groomer**, who has an account, and the **groomer's clients**, who never log in.

| Surface | Who uses it | Login | Examples |
|---|---|---|---|
| Marketing site | Prospective groomers | No | Home, For groomers, pricing, legal pages |
| Groomer portal | The groomer | Yes | Dashboard, Calendar, Appointments, Inbox, Clients, Pets, Services, Availability, Analytics, Billing, Settings |
| Client-facing links | The groomer's clients | No, link only | Booking page, invoice, live tracker, Digital Pet Card, claim link, rebook link |

Clients reach everything through links that the groomer shares or that Pawxis emails. There is **no client account or client app**, by design.

The portal works on desktop and phone. On phones the sidebar becomes a bottom tab bar (Today, Calendar, Inbox, Clients, More). There are light and dark themes.

---

## 4. Plans and pricing

| | Trial | Solo | Pro |
|---|---|---|---|
| Monthly price | Free for 14 days, no card | **$29** | **$59** |
| Annual price (about 2 months free) | | $290 | $590 |
| Founding price (first 20 groomers, locked for life) | | $19 | $39 |
| Client messages included per month | 2,000 | 800 | 2,000 |
| Features | Everything in Pro | Base toolkit | Base toolkit plus routing and automation |

**Message top-up:** $5 for 1,000 extra messages, a one-time purchase.
**Rule of thumb:** about 10 messages per client per month, so 800 messages covers about 80 active clients and 2,000 covers about 200.

### What each plan includes

| Feature | Solo | Pro |
|---|:---:|:---:|
| Branded booking page | ✓ | ✓ |
| Deposits and no-show protection | ✓ | ✓ |
| Built-in calendar and calendar feed (ICS) | ✓ | ✓ |
| Client messaging by email | 800/mo | 2,000/mo |
| Digital Pet Cards | ✓ | ✓ |
| Appointment reminders | ✓ | ✓ |
| Order Radar route ranking | | ✓ |
| Fill My Day auto-offers | | ✓ |
| Live "on my way" tracking | | ✓ |
| Rebooking autopilot | | ✓ |
| Before/after share cards | | ✓ |

Pro features are blocked on the server for Solo and lapsed accounts, not only hidden in the interface.

**Billing provider:** Polar, a merchant of record. Polar runs checkout, sales tax and the customer billing portal.

> **[Screenshot]** Billing page with current plan and plan cards

---

## 5. Key user journeys

### 5.1 Groomer signs up and goes live (target: about 10 minutes)
1. **Register** with email and password, or with Google.
2. **Verify email** with a link sent to their inbox.
3. **Onboarding wizard** in 5 steps: business info, services and pricing, logo, calendar, availability.
4. The **14-day Pro trial** starts automatically, with no card. The trial ends at noon local time on day 14.
5. The groomer **shares their booking link** (`pawxis.app/book/their-name`) on Instagram, Facebook and their Google Business Profile.

A trial-countdown banner appears at the top of the portal. Three or fewer days before the end it turns amber with an **Upgrade** button.

> **[Screenshot]** Registration and onboarding wizard

### 5.2 A client books
1. The client opens the groomer's **booking page**.
2. **Pet details:** name, breed, weight, age, coat condition, temperament, special notes. The client also picks a service.
3. **Owner details:** name, email, phone, home address, and consent to messages.
4. **Instant estimate:** a price range from the service price, adjusted by the groomer's coat and weight rules.
5. **Pick a time:** open slots for the next 14 days. On Pro, slots are ranked by how well they fit the groomer's route, and the best one is labelled **Best fit**. Picking a slot **holds it for 10 minutes** so nobody else can take it.
6. **Deposit,** if the groomer requires one: by card through the groomer's own Stripe account, or through the groomer's payment link (PayPal, Square, Cash App, Venmo).
7. **Confirmation and invoice:** an on-screen invoice in the groomer's name, with a PDF download and print option. The client and the groomer both get a confirmation email.

Addresses outside the groomer's service area cannot book.

> **[Demo video]** Booking from the client's phone, from start to finished invoice

### 5.3 The groomer's day
1. Open the **Dashboard**. **Today's route** lists the stops in time order, with drive time and distance between them and a map link for each.
2. Tap **On my way** (Pro). The client gets a link to a live map showing the van and the ETA.
3. Tap **Start**, then **Complete**. On completion the groomer can add post-groom notes and the final amount charged.
4. Take **before and after photos**. On Pro, turn them into a branded share card.

> **[Screenshot]** Dashboard: Today's Route, Order Radar, KPI strip
> **[Demo video]** "On my way" from the groomer's phone, and the client's live tracker

### 5.4 A booking is cancelled (Pro: Fill My Day)
1. A client cancels a booking that is more than 2 hours away.
2. Pawxis automatically emails the freed slot to clients on the waitlist or clients whose pet is due.
3. The **first client to claim** the slot through the link gets it. Everyone else sees that it's taken.
4. The dashboard shows the **revenue recovered** this month.

### 5.5 Bringing clients back (Pro: Rebooking autopilot)
1. Each pet has a grooming cycle based on its coat type, for example about 5 weeks for curly coats and 8 for double coats.
2. Once a day, Pawxis emails owners whose pet is due within 7 days, with a **rebook link** that has the pet and address pre-filled.
3. Each pet gets at most one nudge per cycle.

### 5.6 Trial ends or payment stops
- The booking page **stops taking new bookings** and shows the groomer's phone and email instead.
- Existing appointments, pet cards and invoices **stay readable**.
- In the portal, the groomer is sent to **Billing** to subscribe.
- Paying again **re-opens booking within about 60 seconds**.

---

## 6. Feature reference: client-facing

| Feature | URL | Plan | What it does |
|---|---|---|---|
| Booking page | `/book/{slug}` | All | The 6-step booking flow described in [5.2](#52-a-client-books) |
| Invoice | shown after booking | All | Invoice in the groomer's name, with PDF download and print. Shows a small "Powered by Pawxis" mark |
| Live tracker | `/t/{token}` | Pro | Map with the van's position, ETA, and call or WhatsApp buttons. Refreshes every 10 seconds |
| Digital Pet Card | `/pet-card/{id}` | All | A shareable pet profile with QR code and PDF: coat, temperament, notes and next visit |
| Claim link | `/claim/{token}` | Pro | First client to confirm gets a freed slot (Fill My Day) |
| Rebook link | `/rebook/{token}` | Pro | Books the next visit with pet and address pre-filled |

> **[Screenshot]** Booking page on mobile: estimate step and time picker with "Best fit"
> **[Screenshot]** Invoice / receipt
> **[Screenshot]** Live tracker
> **[Screenshot]** Digital Pet Card

---

## 7. Feature reference: groomer portal

### Dashboard
- **KPI strip:** revenue, bookings, deposits, no-show rate and messages used this month, with change versus last month.
- **Today's route:** stops in order, travel chips between stops, and Directions, Start, Complete and On my way actions.
- **Upcoming:** the next 14 days.
- **Order Radar (Pro):** the newest bookings with distance from the previous stop, extra driving minutes and a fit label.
- **Fill My Day (Pro):** open gaps today, and revenue recovered this month.
- **Rebooking due:** pets due for a groom in the next 14 days.

> **[Screenshot]** Dashboard

### Calendar
- Day, week and map views.
- Drag to move an appointment, drag its edge to resize it.
- **Add booking** for phone or walk-up bookings, and **block time**.
- Filters by status and service. Times always show in the groomer's timezone.

> **[Screenshot]** Calendar, week view

### Appointments
All appointments, earliest first, filterable by status and date range. Each appointment page has:
- schedule, service, address and directions,
- client and pet details and notes,
- status changes: start, complete (with notes and final amount), cancel,
- deposit status, with **Mark deposit received** for payment-link deposits,
- before and after photos, and on Pro, the share card.

### Inbox
- Message threads per client, with unread counts.
- Quick templates: On my way, Running late, Rebook nudge, Review request.
- Send a message by **WhatsApp**, **the groomer's own phone's texting app**, or **email**. Automatic texting is not switched on, so outgoing SMS is not sent by Pawxis (see [section 9](#9-messages-and-notifications)).

> **[Screenshot]** Inbox

### Clients and Pets
- **Clients:** searchable by name, email or phone. Each client page lists their pets.
- **Pets:** profile (breed, weight, age, coat, temperament, special flags such as senior or anxious, notes), service history, and **Generate Digital Pet Card**.

### Services
Name, description, price and duration. A **Visible in booking** toggle hides a service without deleting it.

### Availability
- **Weekly hours:** one or more time ranges per day.
- **Blocked dates:** holidays and time off.
- **Calendar feed:** a private read-only link that adds Pawxis appointments to Apple, Google or Outlook calendar. It's export only, so nothing changes Pawxis from the other side.

### Analytics
- This month: total bookings, total revenue, no-show rate, each compared with last month.
- **Last 12 months:** bookings and revenue chart, and a no-show rate chart.

> **[Screenshot]** Analytics

### Billing
Current plan and status, next invoice date, **Manage subscription** (opens Polar's billing portal), the message meter, message top-ups, and the plan picker with monthly or annual billing.

### Settings
Settings has a side menu with these sections:

| Section | Contents |
|---|---|
| Booking link | The public address (`/book/{slug}`), editable |
| Business profile | Logo, business name, phone, email |
| Deposit | Deposit amount, and a payment link for PayPal, Square, Cash App or Venmo |
| Estimate rules | Price adjustments by coat condition or weight range |
| Service area | Base address, travel radius, and optionally a boundary drawn on a map |
| Payments | Connect the groomer's own Stripe account for card deposits |
| Appearance | Light or dark theme |
| Account | Log out |

> **[Screenshot]** Settings

### Account security
- Email and password login, or Google sign-in.
- **Forgot password:** emails a one-time reset link that expires in 1 hour.
- Repeated failed logins lock the account temporarily.

---

## 8. Payments

There are **two separate money flows**. They never mix.

### 8.1 Groomer pays Pawxis (subscription)
- Through **Polar**, which handles checkout, tax, invoices and the customer portal.
- Monthly or annual, Solo or Pro, plus one-time message top-ups.
- Polar notifies Pawxis when a payment succeeds or fails, and access updates automatically.
- A failed payment puts the account into a grace period (past due) before it locks.

### 8.2 Client pays the groomer (deposits)
**Pawxis never holds client money and takes 0%.** The groomer chooses one of these:

| Option | How it works | Confirmation |
|---|---|---|
| **The groomer's own Stripe account** | The groomer pastes a restricted Stripe key in Settings. Clients pay by card and the money goes straight to the groomer | Automatic |
| **Payment link** | The groomer adds a PayPal, Square, Cash App, Venmo or Stripe payment link. The client pays after booking | The groomer taps **Mark deposit received** |
| **No deposit** | Deposit set to $0 | The booking confirms straight away |

The groomer's Stripe key is stored encrypted and never shown again. A restricted key can take payments but cannot move or withdraw money.

> **[Screenshot]** Settings, Payments section

---

## 9. Messages and notifications

**All automatic client messages are email today.** SMS texting code exists but is switched off. Groomers can still text or WhatsApp a client manually from the Inbox, which opens their own phone or WhatsApp.

Emails Pawxis sends:

| Email | To | When |
|---|---|---|
| Booking confirmation | Client | A booking is confirmed |
| New booking notification | Groomer | A client books |
| Appointment reminders | Client | Before the appointment |
| On my way | Client | Groomer taps On my way (Pro) |
| Fill My Day offer | Waitlisted or due clients | A slot is freed (Pro) |
| Rebook nudge | Client | Pet is due within 7 days (Pro) |
| Client message | Client | Groomer sends an email from the Inbox |
| Email verification | Groomer | At signup |
| Password reset | Groomer | On request |
| Trial ending | Groomer | Before the trial ends |

Every message counts against the plan's monthly allowance. Confirmations and reminders still go out after the allowance is used up.

**Email volume protection:** at 80% of the daily email provider limit the founder gets an alert. At 90%, optional emails (Fill My Day offers, rebook nudges) pause so confirmations and reminders still go out.

---

## 10. How the numbers are calculated

Use these definitions when you read the dashboard and analytics.

| Metric | Definition |
|---|---|
| **Bookings** | Appointments scheduled in the month, any status |
| **Revenue** | The amount charged on **completed** appointments in the month (the service's base price if no amount was entered), plus deposits kept on appointments that were cancelled or not completed. A completed job's deposit is not counted twice |
| **Deposits** | Deposits successfully paid by card in the month |
| **No-show rate** | Appointments whose time has passed but were never completed or cancelled, divided by all appointments in the period |
| **Messages used** | Client messages sent this billing month, against the plan allowance |
| **Recovered (Fill My Day)** | The deposit or estimated value of freed slots that another client claimed this month |
| **Order Radar fit** | A 0 to 100 score: penalties for extra driving and awkward gaps, bonuses for being close to the previous stop and for clustered days. The booking page labels the best slot **Best fit** |

**Drive times** use real road data when a maps key is configured. Without one, they use straight-line distance with a road factor and an average speed.

---

## 11. Feature status and known gaps

### Status

| Area | Status |
|---|---|
| Signup, email verification, Google sign-in, password reset | Built |
| Onboarding wizard and 14-day no-card trial, with abuse checks | Built |
| Booking page, estimate, slot holds, service area check | Built |
| Deposits through the groomer's own Stripe key, or a payment link | Built |
| Invoice with PDF | Built |
| Dashboard, calendar (day, week, map, drag and resize), appointments | Built |
| Clients, pets, services, availability, calendar feed | Built |
| Analytics | Built |
| Order Radar route scoring and Best fit slots | Built (Pro) |
| Fill My Day | Built (Pro) |
| Rebooking autopilot | Built (Pro) |
| Live "on my way" tracking | Built (Pro). Needs Redis |
| Before/after share cards | Built (Pro) |
| Subscription billing through Polar, message top-ups | Built |
| Lapsed-account handling (bookings paused) | Built |
| Personalised sales demo pages (`/demo/{slug}`) | Built (internal sales tool) |
| Inbox | Built. Email only for automatic messages |
| SMS texting | **Off.** Code exists, not switched on |
| Request-mode bookings (groomer approves each booking) | **Not available.** The setting exists in the data but not in the interface, and there is no approve/decline action |
| Client import (CSV) | **Not built** |
| Automatic review requests, custom message templates, "optimise my day" | **Not built** |
| Client accounts or client app | **Not planned** (by design) |
| Staff accounts, multi-van | **Not built** |
| Referral program | **Not built** |

### Known gaps to decide on
1. **The FAQ says "Can I import my existing clients? Yes",** but there is no import feature. Either build a CSV import or change the FAQ. Recommended: change the FAQ now.
2. **Onboarding step 4 is labelled "Google Calendar",** but there is no Google Calendar connection. The step explains the built-in calendar and the feed. Rename it to "Calendar".
3. **SMS:** many groomers expect texting. Turning it on means a cost per text and US carrier registration (A2P 10DLC), and the current prices assume email only.
4. **Pet card links are shared manually** by the groomer. An easy improvement: include the pet card link in the confirmation or post-groom email.
5. **Request mode:** groomers who want to approve each booking can't today.
6. **The hero photo** shows a studio grooming table, not a mobile van, which weakens the "not a salon" message. Replace it with a van photo.

---

## 12. Demo account

A demo groomer account with realistic sample data is available for screen recordings and walkthroughs.

| | |
|---|---|
| Login | `demo@pawxis.app` (password: ask the founder) |
| Business | Happy Tails Mobile Grooming, Austin, TX |
| Plan | Pro, active |
| Booking page | `/book/happy-tails-austin` |

It contains 5 services, 12 clients, 16 pets, about 6 months of booking history, today's route with 4 stops, Order Radar bookings, upcoming appointments, pets due for a rebook, and inbox threads with unread replies.

**Before recording:** today's route follows the clock when the data is created. Re-create the data on the morning you record, so today's stops show as upcoming. Commands (run from the project folder):

```bash
npx tsx scripts/seed-demo.ts --yes --reset --password=<password>   # re-create
npx tsx scripts/seed-demo.ts --yes --remove                         # delete the demo account
```

The demo account is separate from real groomers and sends no emails, texts or payments. Its Pro plan has no real Polar subscription behind it, so **Manage subscription** does not open for it.

### Suggested demo script (about 3 minutes)
1. **Landing page** (15s): the pitch and the plans.
2. **Client books on a phone** (45s): pet details, estimate, Best fit slot, deposit, invoice.
3. **Dashboard** (40s): the new booking in Order Radar with extra driving shown, today's route with drive times.
4. **On my way** (20s): the client's live tracker.
5. **Complete the groom** (20s): notes and final amount, before/after share card.
6. **Fill My Day** (20s): cancel a booking and show the offer going out.
7. **Analytics and Settings** (20s): growth chart, booking link, deposit options.

> **[Demo video]** Full walkthrough

---

## 13. Platform, integrations and dependencies

**Built with:** Next.js 14 and TypeScript, hosted on Vercel. Data in MongoDB Atlas. Short-lived data (slot holds, live van positions, rate limits, counters) in Upstash Redis.

| Service | Used for | If it's missing |
|---|---|---|
| MongoDB Atlas | All core data | Required |
| Upstash Redis | Slot holds, live tracking, password reset, rate limits, caches | Live tracking and password reset are unavailable; other features fall back |
| Resend | All emails | Emails are not sent |
| Polar | Subscription checkout and billing portal | Plans show but checkout is disabled |
| Stripe | Card deposits through each groomer's own account | Groomers can still use payment links |
| Mapbox (optional) | Maps, road drive times, drawing a service area | Falls back to free OpenStreetMap maps and estimated drive times |
| Cloudinary / UploadThing | Logos, pet photos, before/after photos | Uploads are unavailable |
| Google OAuth (optional) | "Continue with Google" | Email and password login only |
| Twilio (optional, off) | SMS | Not used today |

For running costs per stage and per groomer, see `PAWXIS_FINAL_REPORT.md`, section 4.

**Platform protection:**
- Trial abuse checks: email verification, disposable-email block, phone check, device and IP limits, one trial per phone number.
- Rate limits on public booking and password reset endpoints.
- A **coming-soon mode** that can put the whole site behind a launch countdown, with a bypass for the team.

---

## 14. Page map

**Marketing and legal:** `/` · `/for-groomers` · `/terms` · `/privacy` · `/cookies` · `/refunds` · `/acceptable-use` · `/credits` · `/coming-soon`

**Account:** `/register` · `/login` · `/forgot-password` · `/reset-password` · `/verify-email` · `/verify-pending` · `/onboarding` · `/start-trial`

**Portal:** `/dashboard` · `/calendar` · `/appointments` · `/appointments/{id}` · `/inbox` · `/clients` · `/clients/{id}` · `/pets` · `/pets/{id}` · `/services` · `/availability` · `/analytics` · `/billing` · `/settings`

**Client-facing:** `/book/{slug}` · `/book/{slug}/paid` · `/t/{token}` · `/pet-card/{id}` · `/claim/{token}` · `/rebook/{token}`

**Sales:** `/demo/{slug}`

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Order Radar** | Pro feature that scores how well a booking fits the day's route |
| **Best fit** | The slot on the booking page that adds the least driving |
| **Fill My Day** | Pro feature that offers a cancelled slot to other clients automatically |
| **Rebooking autopilot** | Pro feature that emails owners when their pet is due for a groom |
| **Digital Pet Card** | A shareable pet profile page with QR code and PDF |
| **Slot hold** | A 10-minute reservation of a time while a client finishes booking |
| **Service area** | Where a groomer works: a radius around their base, or a boundary drawn on a map |
| **Calendar feed (ICS)** | A read-only link that shows Pawxis appointments in another calendar app |
| **Founding member** | One of the first 20 paying groomers, with prices locked for life |
| **Lapsed account** | Trial or subscription ended. New bookings are paused |
| **Message allowance** | Client messages included per month in the plan |
