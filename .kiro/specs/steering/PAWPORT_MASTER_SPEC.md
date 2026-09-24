# PAWPORT — MASTER BUILD DOCUMENT (for Kiro)

> Put this file at `.kiro/steering/pawport-master.md` so it is always in context.
> Then work **one phase at a time** (Section 18). Do not try to build everything in one pass.
> Nothing in this document has been applied yet. The repo is in its current state.

---

## 0. HOW YOU (KIRO) MUST WORK

1. **Step 0 — audit before coding.** Read `package.json`, `tailwind.config.*`, `app/**`, `src/**`, models, and existing specs. Report: framework versions (Next, Tailwind, daisyUI, framer-motion, gsap, next-themes), DB layer (Mongoose or driver), auth library, Stripe usage, any Google Calendar code, and every hardcoded color. Adapt this document to what actually exists. Where this document conflicts with existing code, **this document wins** unless it would break a working feature.
2. **Do not regress** auth, onboarding, booking, portal, Digital Pet Card. Keep existing routes and token names.
3. **Credits are limited (~500).** Rules:
   - Do not regenerate requirements/design/tasks for work that already exists.
   - For visual work, do not write property-based tests. Build, then show me.
   - Write tests only for: slot overlap/holds, routing insertion math, entitlement gating, SMS quota. Nothing else.
   - One section/component per step. No "polish passes" unless asked.
4. **No secrets in code.** Everything through env vars (Section 4.3).
5. **Every third party sits behind an interface** (SMS, billing, geocoding/matrix, maps) so it can be swapped.
6. **Content is visible by default.** Animations enhance; they never hide content when JS is off, slow, or reduced-motion is set.
7. At the end of every phase, output: files changed, how to test manually (3-5 steps), and anything skipped.

---

## 1. PRODUCT SUMMARY

**PawPort** is a mobile-first SaaS for **solo mobile pet groomers**. Selling points, in order:

1. **Drive less, groom more.** Every new booking shows how far it is from the groomer's other stops and how much driving it adds ("Order Radar"); booking slots are ranked by route fit.
2. **Never lose a slot.** No-show protection (deposits + SMS confirmations) and **Fill My Day** (auto-offers a cancelled slot to nearby waitlisted / overdue clients).
3. **Looks like a big brand.** Branded booking page, live "van is on the way" link, Digital Pet Cards, before/after share cards.
4. **Repeat revenue on autopilot.** Rebooking nudges by coat type.
5. **Own calendar.** Native calendar in PawPort (no Google Calendar dependency), plus a read-only ICS feed for their phone calendar.

Target buyer: solo groomer running one van. Sold via Facebook groups and cold email using **personalized demo links** (Section 17).

Competitor reference (verify before quoting): MoeGo mobile plans were published at $49 / $99 / $159 per van per month with SMS caps per tier (200 / 900 / 900). PawPort undercuts with SMS included.

---

## 2. GLOBAL DESIGN PRINCIPLES

- **Look:** boutique luxury pet spa. Warm ivory (light) and midnight indigo (dark). Serif display headings, clean sans body. Big photography. Generous whitespace. Soft glass and glow. Not a blue/teal "SaaS template".
- **Marketing site = expressive** (scroll choreography, 3D touch, parallax). **Portal = calm and fast** (subtle motion only) — groomers use it with wet hands between dogs. Minimum 44px touch targets.
- **One theme file** controls all colors, radii, shadows, gradients. One fonts file controls typefaces. No color literals in components. Ever.

---

## 3. REQUIREMENT AMENDMENTS (supersede the two existing requirement docs)

| Existing requirement | Change |
|---|---|
| Onboarding 2.1 step 4 "Google Calendar connection" | Replace with **"Service area & route settings"** (base address, service radius, max detour, buffer, travel fee tiers). Google Calendar removed. |
| Onboarding 2.7 (Google Calendar failure) | Remove. Replace with: if geocoding the base address fails, show an error and allow retry or manual pin drop. |
| Booking 6.2 (sync from Google Calendar within 5 min) | Remove. Availability comes from PawPort's native calendar (Section 9). |
| Booking 6.3 (tentative reservation 10 min) | Keep, implemented with Redis holds (Section 9.4). |
| Booking 8.4, 8.6 (Google Calendar event on booking) | Remove. Replace with: appointment is written to the native calendar and appears in the ICS feed. |
| Appointments 12.3, 12.5 (Google sync, retries) | Remove. Status changes are immediate in Mongo; optionally trigger SMS (Section 12). |
| Availability 14.2, 14.3, 14.5 (bi-directional Google sync) | Remove. Replace with native availability windows, manual blocks, and one-way ICS export. |
| Theme 18.1 "daisyUI is single source of truth" | Now: `src/styles/theme.css` is the single source; daisyUI reads its CSS variables. |
| Theme 18.6 typeface Inter/Geist | Replace with **Fraunces** (display) + **Plus Jakarta Sans** (body) via `src/styles/fonts.ts`. |
| Theme 18.7 Framer 200–400ms | Keep for portal and step transitions. Marketing reveals may run up to 900ms. |
| Aesthetic Redesign req. 5 (Framer/GSAP ownership) | Keep exactly. Add Lenis (smooth scroll) and one lazy React Three Fiber hero object (Section 6). |
| Schema 22 | Add models in Section 14. |

---

## 4. ARCHITECTURE

### 4.1 Stack
- Next.js 14 App Router, TypeScript, Tailwind 3 + daisyUI 4 (verify in audit; if Tailwind 4 / daisyUI 5, adapt the theme syntax only).
- **MongoDB Atlas** (source of truth: users, clients, pets, appointments, availability, subscriptions, messages).
- **Upstash Redis** (HTTP client `@upstash/redis`, serverless-safe): slot holds, booking locks, availability cache, rate limiting (`@upstash/ratelimit`), SMS usage counters, tracking tokens, idempotency keys.
- **Upstash QStash** for scheduled jobs (reminders, rebooking nudges, hold-expiry cleanup). Fallback: Vercel Cron every 5 min hitting `/api/cron/*` (requires plan that allows it).
- **Twilio** for SMS (behind `SmsProvider`).
- **Stripe**: (a) Billing for PawPort subscriptions, (b) Connect for client deposits to groomers (see Open Decisions).
- **Resend** for transactional email.
- **UploadThing or Cloudinary** for images (already specced).
- **Mapbox** (GL JS + Geocoding + Matrix) for maps, address autocomplete and optional travel-time matrix. Default routing math uses haversine with a road factor (free). Check Mapbox terms about storing geocoded results; if problematic use Geoapify or LocationIQ behind `GeocodeProvider`.
- Animation: `framer-motion`, `gsap` + `ScrollTrigger`, `lenis`, `@react-three/fiber` + `@react-three/drei` (one object, lazy). Component sources: 21st.dev, Magic UI, Aceternity UI (copy and adapt to theme tokens).
- Drag and drop in calendar: `@dnd-kit/core`.
- Forms/validation: React Hook Form + Zod (already in use).

### 4.2 Repo layout to converge on
```
src/
  styles/        theme.css  fonts.ts  themes.ts
  lib/
    plans.ts                 # plan features + limits (Section 13)
    routing/                 # geo.ts, insertion.ts, scoring.ts, providers/
    calendar/                # availability.ts, slots.ts, holds.ts, commit.ts, ics.ts
    sms/                     # provider.ts, twilio.ts, templates.ts, quota.ts
    billing/                 # provider.ts, stripe.ts, entitlements.ts
    redis.ts  mongo.ts
  components/
    marketing/  portal/  motion/  ui/
  app/
    (public)/   page.tsx  demo/[slug]  book/[slug]  card/[id]  t/[token]  claim/[token]  rebook/[token]
    (portal)/   portal/dashboard  calendar  inbox  clients  pets  services  settings  billing  analytics
    api/        ...
```

### 4.3 Environment variables
```
MONGODB_URI=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=  QSTASH_CURRENT_SIGNING_KEY=  QSTASH_NEXT_SIGNING_KEY=
TWILIO_ACCOUNT_SID=  TWILIO_AUTH_TOKEN=  TWILIO_MESSAGING_SERVICE_SID=
STRIPE_SECRET_KEY=  STRIPE_WEBHOOK_SECRET=  STRIPE_PRICE_SOLO_MONTH=  STRIPE_PRICE_PRO_MONTH=
STRIPE_PRICE_SOLO_YEAR=  STRIPE_PRICE_PRO_YEAR=  STRIPE_CONNECT_CLIENT_ID=
RESEND_API_KEY=
MAPBOX_TOKEN=  NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_APP_URL=
CRON_SECRET=
```

---

## 5. THEME SYSTEM (create these files exactly; then migrate the repo)

### 5.1 `src/styles/theme.css`
```css
/* THE ONLY FILE YOU EDIT TO RE-THEME. Colors are OKLCH components "L C H" (no oklch()),
   because daisyUI 4 reads them this way and derives alpha (bg-primary/20). */

:root {
  --font-display-stack: var(--font-display), "Iowan Old Style", Georgia, serif;
  --font-body-stack: var(--font-body), ui-sans-serif, system-ui, sans-serif;
  --rounded-box: 1.5rem;  --rounded-btn: 999px;  --rounded-badge: 999px;
  --animation-btn: 0.25s; --animation-input: 0.2s; --btn-focus-scale: 0.97;
  --border-btn: 1px; --tab-border: 1px; --tab-radius: 0.75rem;
}

/* LIGHT — "Ivory Spa" */
[data-theme="pawport_light"] {
  color-scheme: light;
  --p: 42% 0.11 255;  --pc: 98% 0.01 255;
  --s: 74% 0.08 170;  --sc: 24% 0.04 170;
  --a: 80% 0.09 15;   --ac: 30% 0.05 15;
  --n: 24% 0.03 260;  --nc: 96% 0.01 260;
  --b1: 98.5% 0.008 85; --b2: 95.5% 0.012 85; --b3: 91% 0.016 85;
  --bc: 24% 0.025 260;
  --in: 70% 0.12 235; --inc: 20% 0.04 235;
  --su: 72% 0.14 155; --suc: 20% 0.05 155;
  --wa: 82% 0.14 85;  --wac: 25% 0.05 85;
  --er: 64% 0.20 25;  --erc: 98% 0.01 25;
  --pp-hero-gradient: radial-gradient(120% 90% at 20% 10%, oklch(92% 0.05 240) 0%, oklch(97% 0.02 85) 55%, oklch(94% 0.05 15) 100%);
  --pp-glow: 0 20px 60px -20px oklch(var(--p) / 0.35);
  --pp-shadow-card: 0 10px 30px -12px oklch(20% 0.03 260 / 0.10);
  --pp-border: oklch(var(--bc) / 0.10);
  --pp-glass: oklch(var(--b1) / 0.7);
}

/* DARK — "Midnight Spa" */
[data-theme="pawport_dark"] {
  color-scheme: dark;
  --p: 74% 0.12 245;  --pc: 18% 0.03 245;
  --s: 78% 0.09 175;  --sc: 20% 0.04 175;
  --a: 82% 0.10 20;   --ac: 22% 0.04 20;
  --n: 26% 0.03 265;  --nc: 95% 0.01 265;
  --b1: 18% 0.025 265; --b2: 15% 0.025 265; --b3: 12% 0.025 265;
  --bc: 94% 0.01 90;
  --in: 72% 0.12 235; --inc: 18% 0.04 235;
  --su: 76% 0.14 155; --suc: 18% 0.05 155;
  --wa: 84% 0.14 85;  --wac: 22% 0.05 85;
  --er: 68% 0.19 25;  --erc: 18% 0.05 25;
  --pp-hero-gradient: radial-gradient(120% 90% at 20% 10%, oklch(30% 0.08 250) 0%, oklch(18% 0.025 265) 55%, oklch(24% 0.06 15) 100%);
  --pp-glow: 0 20px 80px -20px oklch(var(--p) / 0.45);
  --pp-shadow-card: 0 12px 40px -12px oklch(0% 0 0 / 0.55);
  --pp-border: oklch(var(--bc) / 0.10);
  --pp-glass: oklch(var(--b1) / 0.6);
}

html { font-family: var(--font-body-stack); font-size: 16px; line-height: 1.6; }
h1, h2, h3, .font-display { font-family: var(--font-display-stack); letter-spacing: -0.02em; }
```

### 5.2 `src/styles/fonts.ts`
```ts
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
export const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "SOFT"], display: "swap" });
export const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const fontVars = `${display.variable} ${body.variable}`;
```

### 5.3 `src/styles/themes.ts`
```ts
export const themes = ["pawport_light", "pawport_dark"] as const;
export const defaultTheme = "pawport_light";
```

### 5.4 Wiring
- `app/globals.css`: `@import "../styles/theme.css";` first, then `@tailwind base; @tailwind components; @tailwind utilities;`
- `tailwind.config.ts`: **no color values.** `plugins: [require("daisyui")]`, `daisyui: { themes: false, darkTheme: "pawport_dark" }`; extend `fontFamily.display = ["var(--font-display-stack)"]`, `fontFamily.sans = ["var(--font-body-stack)"]`, `boxShadow.card = "var(--pp-shadow-card)"`, `boxShadow.glow = "var(--pp-glow)"`, `backgroundImage.hero = "var(--pp-hero-gradient)"`.
- `app/layout.tsx`: `<html lang="en" suppressHydrationWarning className={fontVars}>`, `<body className="bg-base-100 text-base-content antialiased">`, `ThemeProvider attribute="data-theme" themes={[...themes]} defaultTheme={defaultTheme} enableSystem={false}`.

### 5.5 Migration rules
- Replace every hex/rgb/`bg-slate-*`/`text-blue-*`/`from-*`/`to-*` with daisyUI tokens (`bg-base-100/200/300`, `text-base-content`, `bg-primary`, `border-base-content/10`) or `bg-hero`, `shadow-card`, `shadow-glow`.
- Headings use `font-display`. Body uses default sans.
- Acceptance: `grep -rE "#[0-9a-fA-F]{3,6}|bg-(slate|gray|zinc|blue)-" src` returns nothing outside `theme.css`. Changing `--p` in `theme.css` changes every primary element on marketing and portal.

---

## 6. MOTION SYSTEM

### 6.1 Ownership (keep from the redesign spec)
- **Framer Motion:** route/page/step transitions, in-view reveals, hover/tap micro-interactions, layout animations, number tickers.
- **GSAP + ScrollTrigger:** scroll-scrubbed parallax, pinned sections, marquees, scroll-driven timelines.
- **Lenis:** smooth scroll, connected to ScrollTrigger (`lenis.on("scroll", ScrollTrigger.update)` and drive Lenis from `gsap.ticker`).
- **React Three Fiber:** exactly **one** hero 3D element (floating pet-card or paw). `next/dynamic` with `ssr: false`, lazy-loaded after first paint, static image fallback, disabled on reduced-motion and when `navigator.hardwareConcurrency <= 4` or Save-Data.
- Never animate the same CSS property of the same element with both Framer and GSAP. Parallax goes on a dedicated wrapper layer.
- Anime.js: **do not add**.

### 6.2 Files
`components/motion/`: `MotionProvider.tsx` (register ScrollTrigger once, Lenis init, reduced-motion state), `Reveal.tsx` (Framer in-view), `Marquee.tsx` (GSAP), `Parallax.tsx` (GSAP), `PinnedSection.tsx` (GSAP), `Tilt.tsx` (Framer, 3D card tilt), `NumberTicker.tsx`, `PageTransition.tsx`.

### 6.3 Non-negotiables
- **SSR-safe:** no `window`/`document`/`matchMedia` during render. GSAP inside `gsap.context()` reverted on unmount.
- **Reduced motion:** no Lenis, no pin, no parallax, no marquee movement, no video, no R3F. Everything at final state.
- **Visible by default:** SSR HTML must not ship elements at `opacity: 0`. Use a `js-anim` class added to `<html>` by a tiny inline script (only when reduced-motion is off) so hidden-until-revealed CSS applies only when JS is running; add a 2 s failsafe that reveals everything. Acceptance test: disable JavaScript, and the whole landing page (including stats, testimonials, pricing) is readable.
- Stats counters render the **final number in SSR** and animate from 0 only after hydration (fixes current `0+ / 0%` bug).
- Performance: Lighthouse mobile performance ≥ 85 on `/`; LCP element is the hero poster (`next/image priority`); CLS 0.

---

## 7. LANDING PAGE (`/`) — `(public)` group with shared header/footer

Header: logo, Features, How it works, Pricing, Log in, **Start free** (pill). Glass effect on scroll (`--pp-glass`). Mobile: slide-down sheet.

Sections, in order (copy is draft; keep it in `src/content/landing.ts` so it can be edited in one place):

1. **Hero** — Headline: *"Groom more dogs. Drive less."* Sub: *"The booking, routing and no-show shield built for solo mobile groomers."* CTAs: **Start free — 14 days** / **See it in action**. Right side: floating product mockup (dashboard + route card) with Tilt; one lazy R3F element behind it. Background: poster image → gradient (`bg-hero`) fallback. Small trust line: *"No card required · Set up in 10 minutes"*.
2. **Problem strip** — 3 cards: *"Cancelled at 8am. Slot gone."* / *"40 minutes of zig-zag driving."* / *"Texts, DMs and calls in five places."* Each maps to a solution below.
3. **Order Radar (GSAP pinned scroll)** — Pinned map. As the user scrolls: stops appear on the route, a new order pin drops in, a card slides in: *"New booking · 4.2 km from your 11:00 stop · +7 min driving · Best fit Thu 2:30"* with Accept / Decline. This is the hero feature of the page.
4. **Bento features grid** — Smart booking page, Deposits, Two-way texting, Native calendar, Digital Pet Cards, Rebooking autopilot. Spotlight-hover cards (21st.dev / Magic UI `bento-grid`).
5. **Fill My Day + Live ETA showcase** — parallax split layout with phone mockups: waitlist SMS offer; "Your groomer is 12 min away" tracker.
6. **Digital Pet Card** — 3D tilt sample card with Before/After slider.
7. **Marquee + stats** — services marquee. Stats come from `landing.ts`; **do not ship invented numbers**. If a stat is `null`, hide it. Show "Founding groomer program: 20 spots" instead until real numbers exist.
8. **Testimonials** — data-driven from `landing.ts`; **hide the section if the array is empty** (no fake quotes).
9. **Comparison** — table PawPort vs "typical grooming software": route optimization, SMS included, price. Do not name competitors on the page; keep claims defensible.
10. **Pricing** — Solo $29 / Pro $59 (monthly/annual toggle, annual = 2 months free). Founding-member banner. All CTAs → `/register`.
11. **FAQ** — accordion (SMS costs, cancel anytime, can I import clients, do clients need an app).
12. **Final CTA** + footer (Product, Company, legal links, theme toggle).

### 7.1 Imagery (must exist before launch; no gradient placeholders left)
Generate with Midjourney/Flux in one consistent style: *"soft natural window light, warm ivory tones, shallow depth of field, premium lifestyle photography, no text"*. Save to `public/images/marketing/`, export AVIF + WebP + JPG, use `next/image` with blur placeholder and meaningful `alt`.
| File | Subject |
|---|---|
| `hero-poster.jpg` (2400×1400) | Groomer with a fluffy dog beside a clean mobile grooming van, golden hour |
| `feature-booking.jpg` | Hands holding a phone with a calm dog in the background |
| `feature-route.jpg` | Van on a suburban street, subtle route line overlay |
| `feature-card.jpg` | Close-up of a freshly groomed dog, bow tie |
| `cat-groom.jpg` | Calm cat on a grooming table |
| `before.jpg` / `after.jpg` | Same dog matted vs groomed (for the slider) |
Also create `public/og.jpg` (1200×630) and favicon set. Wire `heroMedia` to the poster; video optional later.

---

## 8. PORTAL (CMS) UI

Layout: desktop = left sidebar (collapsible); mobile = bottom tab bar (Today, Calendar, Inbox, Clients, More). Top bar: search, SMS credits meter, theme toggle, avatar. Calm motion only (Framer, ≤ 300ms).

- **Dashboard (`/portal/dashboard`)** — bento layout:
  - *Today's Route:* vertical timeline of stops with **travel chips between stops** (`🚐 12 min · 4.1 km`), Google-Maps/Apple-Maps deep link per stop, status badge, one-tap "On my way" / "Start" / "Complete".
  - *Order Radar card:* latest pending request(s) with distance, extra drive minutes, best-fit slot, Accept / Decline / Suggest another time.
  - *Fill My Day:* if there is a gap today/tomorrow, "Fill this gap → 3 nearby clients".
  - *Rebooking due:* pets due in the next 7 days, "Send nudge".
  - *This month:* bookings, revenue, no-show rate, previous-month diff.
  - *SMS credits:* used / included, top-up button.
- **Calendar (`/portal/calendar`)** — Section 9.6.
- **Inbox (`/portal/inbox`)** — two-way SMS threads (Section 12).
- **Clients / Pets / Services / Settings / Billing / Analytics** — keep existing behavior, restyle with theme tokens.
- **Empty states, loading skeletons, toasts:** per existing requirement 19.

---

## 9. NATIVE CALENDAR & BOOKING ENGINE (replaces Google Calendar)

### 9.1 Principles
Mongo is the **source of truth**. Redis provides **speed and safety** (holds, locks, cache). No external calendar dependency. Groomers can subscribe to a **private ICS feed** in Apple/Google/Outlook calendar (read-only).

### 9.2 Availability model
- `Availability.weeklyWindows[]`: `{ day: 0-6, start: "09:00", end: "17:00" }` (15-minute increments; multiple windows per day allowed).
- `Availability.blocks[]`: `{ startAt, endAt, reason }` (holidays, breaks; also created by tapping/dragging in the calendar).
- `Availability.timezone`: IANA string. **All math is done in UTC internally; convert using the groomer's timezone** (use `date-fns-tz` or Luxon). Handle DST.
- `GroomerProfile`: `bufferMin` (default 10), `slotStepMin` (default 15), `maxAdvanceDays` (default 30), `minNoticeHours` (default 12), `bookingMode: "instant" | "request"`.

### 9.3 Slot generation (`lib/calendar/slots.ts`)
Input: groomerId, date range (default 14 days), service duration (from Estimate Engine, else service default), pet size/coat.
1. Build working intervals per day = weekly windows − blocks.
2. Subtract existing appointments (status ≠ cancelled) padded by `bufferMin`.
3. Subtract **active Redis holds** (Section 9.4).
4. Generate candidate starts every `slotStepMin`; keep those where `[start, start+duration]` fits an interval and respects `minNoticeHours`.
5. **Routing filter and ranking (Section 10)** if the client's geocoded address is known: drop slots whose detour exceeds `maxDetourMin`; rank/label the rest.
6. Cache result per `(groomerId, date)` in Redis for 60 s; **invalidate** on any appointment/availability/hold change.

### 9.4 Holds and race-safe commit
- **Create hold** (`POST /api/booking/hold`): validate slot is currently free, then
  - `holdId = nanoid()`; `SET hold:{gid}:{holdId} {startMs,endMs,clientEmail} EX 600`; `SADD holds:{gid}:{yyyy-mm-dd} holdId`.
  - Active holds are read via `SMEMBERS` + `MGET`; missing keys are dropped lazily (expired).
- **Commit** happens **only after payment success** (Stripe webhook `payment_intent.succeeded`, metadata carries `holdId`):
  1. Acquire lock `SET lock:book:{gid} {token} NX EX 10` (retry ≤ 3 × 150 ms).
  2. Re-check no overlapping non-cancelled appointment in Mongo for `[start-buffer, end+buffer]`.
  3. Insert Appointment inside a Mongo transaction with Client/Pet upserts and the Transaction record.
  4. Delete hold, invalidate availability cache, release lock (compare token before delete).
  5. Enqueue: confirmation SMS/email, reminder jobs, radar computation.
- **Hold expired but payment succeeded:** try to commit if the slot is still free; if not, **auto-refund** and SMS/email the client an apology with a link to rebook.
- **Idempotency:** store `idem:stripe:{eventId}` in Redis (EX 7 days); ignore duplicates.
- **Rate limits:** hold endpoint 10/min/IP; booking endpoints 30/min/IP (`@upstash/ratelimit`).
- Unique safety net: Mongo index on `{ groomerId: 1, startAt: 1 }` for non-cancelled appointments (partial index).

### 9.5 Manual bookings and edits
Groomer can create a manual appointment (phone/text bookings), reschedule, cancel. All go through the same overlap check (lock + Mongo). Reschedule/cancel triggers SMS templates (Section 12) and cache invalidation.

### 9.6 Calendar UI (`/portal/calendar`)
- **Day view (default on mobile):** vertical timeline, appointment blocks colored by status token, **travel chips** between blocks, current-time line, tap empty space → "Add booking / Block time".
- **Week view (desktop):** 7 columns, drag to move (`@dnd-kit`), resize to change duration, conflict shown in `error` token with snap-back. 15-min grid.
- **Map toggle:** Mapbox map with numbered stops + route line for the selected day; Order Radar candidate shown as a pulsing pin.
- Filters: status, service. Month view is **out of scope for MVP**.
- **ICS feed:** `GET /api/ics/{feedToken}.ics` (long random token stored on profile, regenerable). Includes appointments with address, client, pet, services. `Cache-Control: max-age=300`.

---

## 10. ORDER RADAR — ROUTING & PROXIMITY ALGORITHM

Goal: when a booking is made or requested, compute **how far it is from neighbouring stops and how many extra minutes of driving it adds**, and rank the offered slots by route fit.

### 10.1 Data
- Geocode client's service address at booking step 2 → `lat/lng`, store on Client and Appointment (`GeocodeProvider`, cache results in Redis by normalized address, 30 days).
- Groomer `baseLocation` (start/end of day), `serviceRadiusKm`, `maxDetourMin`, `bufferMin`, `avgSpeedKmh` (default 32), `roadFactor` (default 1.35), `parkingMin` (default 3), `travelFeeTiers` `[{ uptoKm, fee }]`.

### 10.2 Travel time (`lib/routing/geo.ts`)
```ts
export type LatLng = { lat: number; lng: number };
export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export interface TravelCfg { roadFactor: number; avgSpeedKmh: number; parkingMin: number }
export interface TravelProvider { minutes(a: LatLng, b: LatLng): Promise<number>; km(a: LatLng, b: LatLng): Promise<number> }
// Default provider: minutes = (haversineKm*roadFactor / avgSpeedKmh)*60 + parkingMin.
// Optional MapboxMatrixProvider for real road times; cache pairs in Redis "tt:{hash(a)}:{hash(b)}" 7 days. Fall back to default on error.
```

### 10.3 Insertion evaluation (`lib/routing/insertion.ts`)
Appointments have fixed times, so the insertion position is determined by time — no permutation search needed.
```ts
interface Stop { id: string; loc: LatLng; startMs: number; endMs: number }
interface Cand { loc: LatLng; startMs: number; endMs: number }

// stops: that day's non-cancelled appointments sorted by startMs. base: groomer base location.
export async function evaluateInsertion(stops: Stop[], base: LatLng, cand: Cand, cfg: Cfg, tp: TravelProvider, dayWindow: { startMs: number; endMs: number }) {
  const prev = [...stops].reverse().find(s => s.endMs <= cand.startMs) ?? null;
  const next = stops.find(s => s.startMs >= cand.endMs) ?? null;
  if (stops.some(s => s.startMs < cand.endMs + cfg.bufferMs && s.endMs + cfg.bufferMs > cand.startMs)) return null; // overlap

  const prevLoc = prev?.loc ?? base, nextLoc = next?.loc ?? base;
  const toCand = await tp.minutes(prevLoc, cand.loc);
  const fromCand = await tp.minutes(cand.loc, nextLoc);
  const direct = await tp.minutes(prevLoc, nextLoc);

  // feasibility (time to drive + buffer must fit in the gaps)
  const earliestArrive = (prev ? prev.endMs : dayWindow.startMs) + (toCand + cfg.bufferMin) * 60000;
  if (earliestArrive > cand.startMs) return null;
  if (next && cand.endMs + (fromCand + cfg.bufferMin) * 60000 > next.startMs) return null;
  if (!next && cand.endMs + fromCand * 60000 > dayWindow.endMs + cfg.overtimeMs) return null;

  const extraDriveMin = prev || next ? toCand + fromCand - direct : 2 * toCand; // round trip if the day is empty
  return {
    prevId: prev?.id ?? null, nextId: next?.id ?? null,
    extraDriveMin: Math.max(0, Math.round(extraDriveMin)),
    fromPrevKm: +(await tp.km(prevLoc, cand.loc)).toFixed(1),
    gapAfterMin: next ? Math.round((next.startMs - cand.endMs) / 60000 - fromCand) : null,
  };
}
```

### 10.4 Scoring (`lib/routing/scoring.ts`, weights in one `ROUTING_WEIGHTS` const)
```
score = 100
  - 1.6 * extraDriveMin
  - 25 if 0 < gapAfterMin < 30            // avoids unusable slivers
  - 0.15 * min(gapAfterMin, 120)          // mild preference for tight packing
  + 10 if fromPrevKm <= 5                 // clustering bonus
  + 6  if the day already has >= 2 stops within 8 km (cluster day)
clamp to 0..100
```
Labels: `score >= 80` → **"Best fit"**; `extraDriveMin <= 8` → **"Nearby stop"**; else no label.
Hard filters: outside `serviceRadiusKm` → not bookable (show "outside service area, contact groomer"); `extraDriveMin > maxDetourMin` → hidden from clients (still visible to groomer when adding manually).
Travel fee: look up `travelFeeTiers` by `fromBaseKm` and add to the estimate shown in step 3.

### 10.5 Where it is used
1. **Client booking step 4:** slots are ranked/labelled; "Best fit" first; optional toggle "Show all times".
2. **On commit / on request:** compute and store `appointment.routeMeta = { prevId, nextId, extraDriveMin, fromPrevKm, score }`.
3. **Order Radar card** in the portal (dashboard + calendar side panel) — text pattern: *"New booking · {fromPrevKm} km from your {prevTime} stop · +{extraDriveMin} min driving · {label}"*. In `request` mode: Accept / Decline / Suggest another time (top 3 alternative slots by score).
4. **Freshness:** dashboard polls `/api/portal/radar` every 15 s via SWR (no websockets required). Optional Web Push later.

### 10.6 Optimize Day (Pro, v1 simple)
Only reorders appointments flagged `flexible` (client accepted a ±60 min arrival window at booking). Nearest-neighbour from base + 2-opt improvement (n ≤ 10), constrained to each stop's window. Output is a **proposal** the groomer approves; approval updates times and sends "updated ETA" SMS. Never move a non-flexible appointment.

### 10.7 Tests (only these)
- Empty day → round-trip `2*toCand`.
- Between two stops → `extra = toCand + fromCand − direct`.
- Overlap and buffer violations → `null`.
- Sliver penalty applies for a 20-minute gap.

---

## 11. HOOK FEATURES (the "cherry")

Build in this order; each is Pro-gated (Section 13).

### 11.1 Fill My Day (top priority)
Trigger: an appointment is cancelled/moved, or the groomer taps "Fill this gap".
1. Gap = freed interval (plus adjacent free time).
2. Candidates = (a) `Waitlist` entries whose preferred days/services match, (b) clients whose pet's `nextDueAt` ≤ 14 days and who have no future booking. Exclude opted-out (SMS STOP) clients.
3. For each candidate with a known address: run `evaluateInsertion` for the gap; discard infeasible; rank by score.
4. Send SMS to the top 3 (staggered 2 min) with a claim link `/claim/{token}`; token in Redis `claim:{token}` EX 1800 with `{gid, startMs, endMs, clientId}`.
5. **First to confirm wins:** `SET claimwon:{gid}:{startMs} {clientId} NX EX 1800`; losers see "This slot was just taken — here are other times". Winner goes through deposit checkout, then the normal commit path.
6. Log outcome (`filled`, `revenueRecovered`) → shows on dashboard: *"Fill My Day recovered $X this month."* (this is the selling metric).

### 11.2 Live "Van is on the way" link
- Groomer taps **On my way** → SMS to client: `/t/{token}`.
- Groomer's device (PWA, page kept open) posts position every 20 s to `POST /api/track/{token}` → Redis `track:{token}` EX 7200 `{lat,lng,ts}`. Stops on **Arrived** or after 2 h.
- Public tracker page polls every 10 s: branded header (groomer logo/name), ETA computed with `TravelProvider`, Mapbox map with van marker, pet name, "Call / Text groomer".
- Privacy: location shared only while a trip is active; groomer sees a persistent "Sharing location" banner with a Stop button.

### 11.3 Before/After share card
- Groomer uploads before/after photos from the appointment screen (mobile camera input).
- Client-side generate a 1080×1350 branded image (`html-to-image`): slider-style split, pet name, groomer logo, "Book at {url}". Buttons: **Share** (`navigator.share`), **Download**, **Add to Pet Card**. Video reel is out of scope for v1.

### 11.4 Rebooking autopilot
- Default intervals by coat (weeks): smooth 6, double 8, wire 6, curly 5, long 5, matted 4. Groomer can override per pet. Set `pet.nextDueAt` when an appointment completes.
- Daily job: pets due in ≤ 7 days with no future appointment and SMS consent → SMS with `/rebook/{token}` (pet and address prefilled; skip to step 3/4).
- Max one nudge per pet per cycle + one reminder after 5 days. Stop on booking.

---

## 12. TWILIO MESSAGING

### 12.1 Interface
```ts
interface SmsProvider { send(p: { to: string; body: string; groomerId: string; kind: SmsKind; meta?: object }): Promise<{ id: string; status: string }> }
```
`TwilioProvider` uses a Messaging Service SID. Status callbacks → `/api/twilio/status`. Inbound → `/api/twilio/inbound`. **Validate the Twilio signature** on both. Keep everything behind the interface so Telnyx/Vonage can replace it.

### 12.2 Message kinds and templates (`lib/sms/templates.ts`; prefix every message with the business name)
`booking_confirmed`, `reminder_24h` (reply C to confirm), `reminder_2h`, `on_my_way`, `running_late`, `rescheduled`, `cancelled`, `fill_my_day_offer`, `rebook_nudge`, `review_request` (after complete, Pro), `deposit_receipt`. Templates are editable per groomer (Pro) with variables `{pet} {date} {time} {business} {link}`; Solo uses defaults.

### 12.3 Rules
- **Consent:** unchecked-by-default checkbox at booking step 2: "Text me appointment updates. Msg & data rates may apply. Reply STOP to opt out." Store `smsConsentAt`. Never message without consent (except one transactional confirmation if the client provided phone as required contact — legal review needed).
- **STOP/START/HELP:** inbound handler sets/clears `client.smsOptOut`; never send to opted-out numbers.
- **Quiet hours:** no marketing-type messages (rebook, review, fill offers) outside 08:00–20:30 groomer-local; transactional may go anytime.
- **Quota:** monthly allowance per plan. `INCR sms:usage:{gid}:{yyyymm}` (EX ~40 days); when at 100 % block non-transactional messages first, then all except confirmations; show meter and top-up (Section 13). Reserve a small per-groomer buffer.
- **Reminders scheduling:** on commit, QStash schedules `reminder_24h` and `reminder_2h`; store `qstashMessageId` on appointment; **cancel/replace on reschedule or cancel**.
- **Log everything** in `SmsMessage` (direction, status, error code, segments). Retry failed sends up to 3× with backoff, then log for review. Fall back to email (Resend) for confirmations only.
- **Inbox (`/portal/inbox`):** threads by client, unread badges, quick replies, "Send a template". Inbound message from unknown number creates a "Lead" thread.

### 12.4 Compliance note for the human (Section 20)
US SMS requires A2P 10DLC brand/campaign registration and it takes time. Start early. A multi-tenant SaaS may need per-customer sub-brands. Confirm with Twilio.

---

## 13. SUBSCRIPTIONS, ENTITLEMENTS, USAGE

### 13.1 Plans (suggested; edit in one file)
`src/lib/plans.ts`
```ts
export const PLANS = {
  trial: { price: 0, days: 14, tier: "pro", sms: 300 },
  solo:  { priceMonth: 29, priceYear: 290, sms: 300, features: ["booking","deposits","nativeCalendar","petCards","reminders","waitlistBasic","ics"] },
  pro:   { priceMonth: 59, priceYear: 590, sms: 800, features: ["booking","deposits","nativeCalendar","petCards","reminders","waitlistBasic","ics",
           "orderRadar","smartSlots","fillMyDay","liveEta","rebookAutopilot","beforeAfter","reviewRequests","customTemplates","optimizeDay"] },
} as const;
export const SMS_TOPUP = { messages: 500, price: 9 };
export const FOUNDING = { spots: 20, soloMonth: 19, proMonth: 39, lockedForLife: true };
```
Server-side helper `assertFeature(groomerId, "fillMyDay")` used in every gated API route and server action; UI shows locked cards with an "Upgrade to Pro" prompt. **Never gate only in the UI.**

### 13.2 Billing (`lib/billing/`)
- `BillingProvider` interface; default `StripeBilling` (Stripe Billing on the platform account). Keep the interface clean so Lemon Squeezy/Paddle (merchant of record) can replace it.
- **Trial:** 14 days of Pro, **no card required** (`payment_method_collection: "if_required"`, `trial_period_days: 14`, `trial_settings.end_behavior.missing_payment_method: "cancel"`).
- Checkout via Stripe Checkout; management via Stripe Customer Portal (`/portal/billing` → "Manage subscription").
- Webhooks (`/api/stripe/billing-webhook`, verify signature, idempotent): `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end` (email + SMS-free reminder 3 days before).
- **States:** `trialing → active → past_due (7-day grace, banner, everything works) → canceled/expired (read-only portal; public booking page shows "temporarily unavailable"; data retained 90 days)`.
- Store in `Subscription`: `plan, status, currentPeriodEnd, trialEndsAt, stripeCustomerId, stripeSubscriptionId, smsIncluded, smsTopupBalance, foundingMember`. Entitlements resolved from it, cached in Redis 60 s (`ent:{gid}`).
- Coupon for founding members: 1 Stripe coupon per plan, `duration: forever`.

### 13.3 Client deposits (Stripe Connect)
- Groomer onboarding: Stripe Connect **Express** account link inside Settings → Payments.
- Deposits: PaymentIntent with `on_behalf_of` / `transfer_data.destination` = groomer's account; `application_fee_amount` = 0 by default (configurable).
- Deposit policy per groomer: amount, refundable window (e.g. full refund if cancelled ≥ 24 h before), forfeited on no-show.
- Webhook (`/api/stripe/connect-webhook`) handles `payment_intent.succeeded/payment_failed`, `charge.refunded`, `account.updated`.

### 13.4 Usage & limits surfaced to the user
Dashboard meter for SMS; billing page shows plan, next invoice, SMS used, top-up button (one-time Checkout → increments `smsTopupBalance`).

---

## 14. DATA MODELS (Mongoose; add/extend; all with `createdAt/updatedAt`; index all FKs)

```
GroomerProfile (extend): slug*, businessName, logoUrl, phone, email, timezone, baseAddress, baseLocation{lat,lng},
  serviceRadiusKm, maxDetourMin(25), bufferMin(10), slotStepMin(15), minNoticeHours(12), maxAdvanceDays(30),
  avgSpeedKmh(32), roadFactor(1.35), parkingMin(3), travelFeeTiers[{uptoKm,fee}], bookingMode("instant"|"request"),
  depositAmount, depositPolicy, icsFeedToken, stripeConnectAccountId, smsTemplates{}, onboardingStep, active

Availability: groomerId*, weeklyWindows[{day,start,end}], blocks[{startAt,endAt,reason}]

Client: groomerId*, name, email*(unique per groomer), phone, address{street,city,state,postal,lat,lng},
  smsConsentAt, smsOptOut, notes

Pet: clientId*, name, photoUrl, breed, weight, age, temperament, coat, flags[], notes,
  rebookIntervalWeeks, lastGroomAt, nextDueAt

Service: (existing) + active

Appointment: groomerId*, clientId*, petId*, serviceIds[], startAt*, endAt, status(upcoming|in_progress|completed|cancelled|no_show),
  address{...,lat,lng}, estimate{min,max}, depositPaid, travelFee, flexible(bool), source("public"|"manual"|"claim"|"rebook"),
  routeMeta{prevId,nextId,extraDriveMin,fromPrevKm,score}, notes, postGroomNotes,
  tracking{token,startedAt,arrivedAt}, reminderJobIds[], beforePhotoUrl, afterPhotoUrl, cancelledAt, cancelReason
  Indexes: {groomerId,startAt}, partial-unique {groomerId,startAt} where status != cancelled

Waitlist: groomerId*, clientId*, petId, serviceId, preferredDays[], earliestDate, latestDate, status(active|offered|filled|expired)

Transaction: appointmentId*, stripePaymentId, amount, type(deposit|refund), status, timestamp

Subscription: groomerId*(unique), plan, status, trialEndsAt, currentPeriodEnd, stripeCustomerId, stripeSubscriptionId,
  smsIncluded, smsTopupBalance, foundingMember

SmsMessage: groomerId*, clientId*, appointmentId, direction(in|out), kind, body, twilioSid, status, errorCode, segments, createdAt

FillEvent: groomerId*, gapStart, gapEnd, offeredTo[], filledBy, revenueRecovered, createdAt
```

---

## 15. REDIS KEY MAP

```
hold:{gid}:{holdId}          {startMs,endMs,email}          EX 600
holds:{gid}:{yyyy-mm-dd}     SET of holdIds                 EX 86400
lock:book:{gid}              token                          EX 10
avail:{gid}:{yyyy-mm-dd}     cached slots JSON              EX 60
geo:{sha1(address)}          {lat,lng}                      EX 30d
tt:{hashA}:{hashB}           minutes                        EX 7d
rl:{route}:{ip}              ratelimit                      (library-managed)
sms:usage:{gid}:{yyyymm}     INCR                           EX 40d
ent:{gid}                    entitlements JSON              EX 60
claim:{token}                {gid,startMs,endMs,clientId}   EX 1800
claimwon:{gid}:{startMs}     clientId (NX)                  EX 1800
track:{token}                {lat,lng,ts}                   EX 7200
idem:stripe:{eventId}        1                              EX 7d
```

---

## 16. API ROUTES & JOBS

Public: `POST /api/booking/geocode`, `GET /api/booking/slots`, `POST /api/booking/hold`, `POST /api/booking/checkout`, `GET /api/claim/{token}`, `POST /api/claim/{token}/confirm`, `GET /api/track/{token}`, `GET /api/ics/{token}.ics`, `GET /api/demo/{slug}`.
Portal (auth + `assertFeature`): `/api/portal/appointments*`, `/api/portal/calendar*`, `/api/portal/radar`, `/api/portal/fill`, `/api/portal/optimize-day`, `/api/portal/track/{id}` (start/stop/position), `/api/portal/sms/*`, `/api/portal/billing/*`.
Webhooks: `/api/stripe/billing-webhook`, `/api/stripe/connect-webhook`, `/api/twilio/status`, `/api/twilio/inbound`, `/api/qstash/*` (verify signature).
Jobs (QStash or cron): `reminder-24h`, `reminder-2h`, `rebook-nudges` (daily 09:00 per timezone), `trial-ending`, `expire-holds` (safety), `subscription-grace-check` (daily).

---

## 17. DEMO LINKS & OUTREACH SUPPORT

- `GET /demo/{slug}` — **personalized demo** for a prospect. Data comes from `src/content/demos.ts` (or an admin-only Mongo collection): `{ slug, businessName, city, lat, lng, logoUrl?, color? }`. It renders the public booking page + an interactive Order Radar demo using **fake sample stops around that city**. Banner: *"This is a preview built for {businessName}. Claim it free →"* → `/register?claim={slug}` prefilled.
- Demos are `noindex`. Only the seeded data shows; no real customer data.
- Admin CLI/script `scripts/create-demo.ts "Happy Paws" "Austin, TX"` to generate one in seconds.
- Outreach message templates live in `docs/outreach.md` (cold email, Facebook group post, follow-up). Keep claims honest: no invented stats or testimonials.

---

## 18. PHASES (work in this order; stop and report after each)

Rough credit budget (guesses; total ≈ 470 of ~500, keep 30 in reserve). If credits run short, cut in this order: before/after (11.3), live ETA (11.2), optimize-day (10.6), month calendar (already out), then quote fewer landing sections.

| # | Phase | Est. credits | Done when |
|---|---|---|---|
| 0 | Audit + theme system + fonts + migration (Section 5) | 30 | grep check passes; toggling theme changes both marketing and portal; new fonts live |
| 1 | Landing page + motion system + imagery (Sections 6, 7) | 90 | All 12 sections render; Lighthouse ≥ 85; works with JS off; reduced-motion OK |
| 2 | Native calendar + availability + holds + commit + ICS (Section 9) | 80 | Two concurrent bookings for one slot → exactly one wins; hold expires at 10 min; ICS subscribes on a phone |
| 3 | Order Radar + smart slots + travel fees (Section 10) | 50 | Unit tests pass; slots labelled; radar card shows real km / +min |
| 4 | Twilio messaging + reminders + inbox + quota (Section 12) | 50 | Confirmation and 24h reminder arrive; STOP respected; usage meter increments |
| 5 | Billing: plans, trial, Stripe Billing, Connect deposits, entitlements (Section 13) | 40 | Trial without card; Pro-only route returns 403 on Solo; failed payment → grace banner |
| 6 | Portal restyle + dashboard bento + calendar UI polish (Section 8, 9.6) | 50 | Mobile bottom nav; day view with travel chips; drag reschedule with conflict snap-back |
| 7 | Fill My Day + Rebooking autopilot (+ Live ETA, Before/After if credits allow) (Section 11) | 60 | Cancel → 3 SMS offers → first claim wins; nudge job sends once |
| 8 | Demo links + final QA (Section 17, 19) | 20 | `/demo/{slug}` works; checklist below passes |

### Prompts to give Kiro (copy one at a time)
- **P0:** "Read `.kiro/steering/pawport-master.md`. Do Phase 0 only: audit the repo and report findings, then implement Section 5 (theme, fonts, migration). Do not touch business logic."
- **P1:** "Do Phase 1. Build the motion system (Section 6) and the landing page (Section 7) one section at a time. Use 21st.dev/Magic UI patterns adapted to theme tokens. Show me the hero first before continuing."
- **P2:** "Do Phase 2. Replace all Google Calendar code with the native calendar engine (Section 9). Update the existing requirements per Section 3. Write tests only for overlap, hold expiry and concurrent commit."
- **P3:** "Do Phase 3 (Section 10). Implement geo, insertion, scoring exactly as specified, with the four unit tests, then wire to booking step 4 and the portal Order Radar card."
- **P4:** "Do Phase 4 (Section 12) behind the `SmsProvider` interface. Include quota, quiet hours, STOP handling, reminder scheduling with QStash."
- **P5:** "Do Phase 5 (Section 13). Build `plans.ts`, `assertFeature`, Stripe Billing trial/checkout/portal/webhooks, Stripe Connect deposits. Gate every Pro feature server-side."
- **P6:** "Do Phase 6 (Sections 8 and 9.6). Restyle the portal with tokens only; build the dashboard bento and the day/week calendar with travel chips."
- **P7:** "Do Phase 7 (Section 11.1 and 11.4 first)."
- **P8:** "Do Phase 8 (Sections 17, 19)."

---

## 19. DEFINITION OF DONE / QA CHECKLIST

**Theme:** one edit of `--p` in `theme.css` recolors marketing + portal + booking + pet card; no hex in components; both themes complete; fonts load with `swap` and no layout shift.
**Landing:** no placeholder gradients where images should be; no `0+` counters in SSR HTML; page readable with JS disabled; no horizontal scroll at 320/768/1024/1440; all interactive elements ≥ 44 px; LCP is the hero poster; reduced-motion shows a static, complete page.
**Calendar/booking:** no double booking under concurrent requests; DST-day test passes; hold released on expiry; paid-but-expired hold is refunded or committed; ICS feed valid.
**Routing:** correct km and +min; out-of-radius blocked; detour filter works; radar text matches data.
**SMS:** signature validated; opt-out honored; quiet hours respected; quota enforced; reminders cancelled on reschedule.
**Billing:** webhook idempotent; Solo cannot call Pro endpoints; grace/expiry behaviors as specified; trial without card.
**Security:** all portal routes authenticated and scoped by `groomerId`; public endpoints rate-limited; tokens (`/t`, `/claim`, `/rebook`, ICS) long and random; no PII in logs.
**Regression:** register → onboarding → booking → deposit → dashboard → pet card still works end to end.

---

## 20. OPEN DECISIONS FOR THE HUMAN (do not block on these; use the default noted)

1. **Getting paid from Pakistan.** Stripe Billing/Connect require a supported business country. Default: build behind `BillingProvider`; consider a registered entity in a supported country, or a merchant-of-record (Lemon Squeezy/Paddle) for PawPort subscriptions. Client deposits via Connect need the groomer's country to be supported.
2. **Twilio A2P 10DLC (US).** Registration lead time and whether a shared campaign is allowed for multi-tenant SaaS. Default: single Messaging Service, business-name prefix; plan for per-groomer sub-brands.
3. **Mapbox terms on storing geocodes.** Default: cache in Redis only ≤ 30 days; store coordinates on client after user confirmation. Swap provider if needed.
4. **Pricing.** Default in `plans.ts`. Verify competitor prices before publishing comparisons.
5. **Real testimonials and stats.** Section 7 hides them until real data exists.
6. **Legal.** Terms, privacy policy, SMS consent wording, and GPS-sharing notice need review before launch.
