# PAWXIS — BUGFIX SPRINT 2 (fix-only, no rebuilds)

> Continuation of `.kiro/specs/bug-fix-1/PAWPORT_BUGFIX_SPRINT.md`. Same ground
> rules: fix only the described symptom, diagnose before coding, smallest diff,
> name config-vs-code honestly, don't rebuild things that already work.
> This file is a record of Sprint 2 — read once, then archived.

---

## STATUS LEGEND
- ✅ DONE (shipped to main)
- 🔎 DIAGNOSED (root cause confirmed; see notes)
- ⏭️ DEFERRED (future improvement, intentionally not built this sprint)

---

## S2-0 — PORTAL CRASH: invalid stored timezone threw in Server Components  ✅
**Symptom:** every portal page spammed "An error occurred in the Server
Components render" (digest-only in prod).
**Root cause:** `date-fns-tz` `formatInTimeZone`/`fromZonedTime` throw
`RangeError: Invalid time value` on a non-IANA timezone string (e.g. a stored
`PKT`, `GMT+5`, or non-canonical `Asia/Lahore`). `tzOf()` in `src/lib/timezone.ts`
only guarded empty values, so a bad `GroomerProfile.timezone` crashed every
server-rendered page that formats a time (dashboard, calendar).
**Fix:** `tzOf()` now validates the zone via `Intl.DateTimeFormat` and falls
back to UTC when absent/blank/invalid. One shared util → protects every call
site. Commit `6b1ca32`.
**Follow-up (⏭️):** validate the timezone INPUT on the Settings page so a bad
value can't be stored in the first place.

## S2-1 — Digital Pet Card was undiscoverable  ✅
**Symptom:** pet card feature works but is buried; only reachable via
Clients → client → pet. No "Pets" nav item, no `/pets` list.
**Fix:** added `listPets()` server action; new `/pets` list page (auth-gated,
links to `/pets/[petId]`, "Card ready" badge); "Pets" nav item (sidebar +
mobile More); a "Pet Cards" entry card on the dashboard → `/pets`.
**Not a bug — was a discoverability gap (feature existed, unreachable).**

## S2-2 — Calendar blocks looked unprofessional (pill/blob + glow)  ✅
**Root cause:** blocks used `rounded-btn`/`rounded-box` (theme radius 999px →
pills) + `shadow-card` (glow).
**Fix:** `rounded-md` + removed block shadow on both Day and Week blocks; kept
the left status accent, colors, and all drag/resize/lane behavior. Flat,
enterprise look. (Calendar was already correctly theme-tokened — this was a
shape/shadow taste fix, not a color-migration bug.)

## S2-3 — Dashboard "This month" not responsive  ✅
**Fix:** metric grid → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` so the four
tiles (Bookings / Deposits collected / Est. service revenue / No-show rate) wrap
and stack cleanly on narrow screens instead of clipping.

## S2-4 — Before/After card: huge empty space below it  ✅
**Root cause:** the on-screen preview scaled a 1080×1350 node with
`transform: scale()`, which does NOT shrink the LAYOUT box → the page reserved
~1350px even though it rendered ~338px.
**Fix:** gave the preview wrapper a fixed `270×338` + `overflow-hidden`; the
inner node stays true 1080×1350 so html-to-image still exports full-res.

---

## STATUS-ONLY REPORT — the four Section-3 unknowns (NO code written)
1. **Order Radar math** 🔎 — deterministic insertion scoring (not route
   optimization): find prev/next by time, reject on buffer-aware overlap +
   infeasible drive legs, score = 100 − 1.6·extraDriveMin − sliver/gap
   penalties + close-prev/cluster bonuses; "Best fit" ≥80. Drive times from the
   `TravelProvider` (haversine default, Mapbox when `MAPBOX_TOKEN` set).
   Groomer "accepts" only in `request` booking mode — and that Accept/Decline
   handler is a `TODO(phase-3/6)` STUB today (instant mode auto-confirms).
2. **Twilio A2P** 🔎 — SMS only sends when `TWILIO_ACCOUNT_SID` +
   `TWILIO_AUTH_TOKEN` + `TWILIO_MESSAGING_SERVICE_SID` all set (currently NOT
   → "0/300"). A2P 10DLC brand/campaign registration is external Twilio-console
   operator work, not in code. Multi-tenant inbound number→groomer routing is a
   known SEAM (matches by sender phone today).
3. **Paddle wiring** 🔎 — NOT built. Only a provider-agnostic `BillingProvider`
   interface exists; Stripe Billing is the sole implementation. Paddle/Lemon
   Squeezy are named as possible drop-ins behind the seam — zero Paddle code.
4. **BYOK deposit flow** 🔎 — fully built as Stripe Connect Express direct
   charges: deposits pay out to the groomer's OWN Stripe account, Pawxis never
   holds funds. Requires platform Connect config + each groomer completing
   onboarding; until then deposit bookings show "online payments aren't set up
   yet" (correct behavior).

---

## EXPLANATIONS (asked, not built)
- **No client/customer portal exists.** Users are: authenticated groomer
  (`(portal)`) and public visitor (`(public)`: marketing, `/book/[slug]`,
  `/t/[token]`, `/pet-card/[cardId]`). The pet-card URL is distributed by the
  groomer MANUALLY (copy link from the pet profile / public card page). It is
  NOT auto-sent to the client and there is no client login. ⏭️ Future: include
  the pet-card link in the booking confirmation email / after a completed groom.
- **Animated pet card** renders on `/pet-card/[cardId]` (and the same component
  on the landing showcase with sample data). **Before/After card** renders on
  the appointment detail once both photos exist.
- **Location** = client address → geocoded (`GeocodeProvider`: free Nominatim
  default, Mapbox when keyed) → `{lat,lng}` → feeds service-area gate, Radar
  drive math, and tracker ETA. Null geocode = routing pass-through.
- **Landing Radar card** = scroll-animated marketing illustration of the real
  dashboard Order Radar (see S2 status #1).

---

## DEFERRED (⏭️ future, intentionally out of scope)
- Validate the Settings timezone input (prevent bad stored zones).
- Auto-deliver the pet-card link to clients (email/SMS); optional client portal.
- Wire the request-mode Order Radar Accept/Decline handler.
- A real editable "final price" field on Appointment (Est. service revenue
  currently uses Service.basePrice as the stand-in).
- Thread the client-picked service id into the no-deposit booking persistence.
