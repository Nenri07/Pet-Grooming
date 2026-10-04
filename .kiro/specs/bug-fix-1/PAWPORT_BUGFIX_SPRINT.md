# PAWPORT — BUGFIX SPRINT 1 (fix-only, no rebuilds)

> **Where this goes:** do NOT put this in `.kiro/steering/`. Steering files load on every single
> request, so a second large always-on doc next to the master spec is part of why credits vanish fast.
> Put this at `.kiro/specs/bugfix-sprint-1/tasks.md` (a one-time task list, read once, then archived),
> or just paste Cluster 1's prompt directly into a fresh Kiro conversation. Reference the master spec
> by section number only when a fix needs it (e.g. "per Section 5.5") — don't re-attach the whole file.

> **Also do now, separately:** move `pawport-master.md` itself out of `.kiro/steering/` into a plain
> `docs/` folder (not auto-loaded). It did its job getting Phases 0–2 scoped; keeping all 630 lines
> injected into every request from here on is paying tokens for context most fixes below don't need.

---

## GROUND RULES — read before touching anything

These are hard rules, not suggestions. Breaking any of them is how the last 2,000+ credits were spent
with nothing to show.

1. **Fix only the exact symptom described in a cluster below. Nothing else.** Do not refactor, rename,
   restyle, or "improve" any file not named in that cluster, even if it looks wrong.
2. **Diagnose before writing code.** For every bug, first find and quote the actual current code
   causing it (file + line range) and state the root cause in one sentence. Do not start editing until
   the root cause is identified. If you can't find it in 10 minutes of searching, say so and stop —
   don't guess by rewriting the surrounding component.
3. **Smallest possible diff.** If a fix touches more than ~5 files, stop and explain why before
   proceeding — that usually means the root cause was misdiagnosed.
4. **One cluster at a time. Stop after each one.** Do not continue to the next cluster automatically.
   Show what changed (screenshot or a 3-sentence description) and wait for the go-ahead.
5. **No new features.** If a described "bug" turns out to be a feature that was never built at all
   (not broken — just missing), say that plainly instead of silently building it from scratch. The
   fix size is very different for "broken" vs. "doesn't exist," and the human needs to know which.

---

## ROOT CAUSE NOTE (read this once, applies to Clusters 1 and 3)

Items 1, 2, 4, 5, 8, and 9 are all some version of "two things that should look identical don't."
The booking receipt, the PDF download, the printed version, the dashboard cards, and the pet card are
very likely **five separate hand-built implementations** of what should be **one or two shared
components** reused everywhere. That's almost certainly why they've drifted — each one was built once
and never touched again when another was changed.

**The actual fix for most of this is architectural, not cosmetic:** consolidate down to one canonical
component per concept, and render that same component in every context instead of hand-rolling each
one. This is also the token-cheap fix — one component to get right beats five.

---

## CLUSTER 1 — Dashboard & Pet Card don't match what the landing page promised
**Priority: fix first. Budget: ~350 credits.**

**Symptoms (items 1, 2, 8):** the landing page shows a pet card + a geo-based "best route" card + a
receipt preview as the product's hero features. The actual portal dashboard shows different cards, or
none. The Digital Pet Card's "Add to Pet Card" control has no section behind it, and the card that does
generate looks different from the landing page's version.

**Diagnose first:**
- Does `/portal/dashboard` actually contain an Order Radar card and a "Today's Route" card at all
  (Section 8 of the master spec), or were they never built? Say which.
- Does a Pet Card detail/list page exist anywhere in the portal, or does "Add to Pet Card" point at
  nothing? Say which.
- Is the landing page's version of these a **real live component** or a **static marketing image**?
  If it's a static image, the fix is "make the real component match that design," not "make them
  literally the same file" — confirm which before fixing.

**Fix:**
- If the dashboard cards exist but look wrong: restyle only using existing theme tokens (Section 5),
  do not redesign the layout.
- If they don't exist: build the minimum version from Section 8's spec — real data, no extra polish
  beyond matching the landing page's visual language (same card shape, radius, shadow tokens).
- Pet Card: fix the broken link/missing section first (that's likely a 1–2 file routing bug, not a
  rebuild). Only then address the visual mismatch, reusing the same card primitives as the receipt
  component from Cluster 3 if that's already done — build Cluster 1's pet card AFTER Cluster 3 if it
  turns out they can share a base component; otherwise do them in the stated order.

**Stop and report:** screenshot of dashboard + pet card, and which of the two diagnose questions above
turned out to be true.

**Kiro prompt:**
> Read Cluster 1 of this bugfix sprint only. Diagnose each symptom first and report root causes before
> writing any code. Fix only what's described. Stop and show me the result before continuing.

---

## CLUSTER 2 — Subscription trial countdown is wrong
**Priority: second. Budget: ~100 credits — this should be cheap, it's a logic bug.**

**Symptom (item 3):** trial showed 15 days, reload showed 14, but the account was already 7+ days old
— it should show ~7 days left, not recalculate from a fixed number on every load.

**Diagnose first (in this exact order, stop at whichever is true):**
1. Is `trialEndsAt` set once at signup and stored (Section 13.2), or is it being recomputed from
   `now + 14 days` on every page load instead of read from the stored value? — this is the most likely
   cause of "resets on reload."
2. Is "days left" computed as `Math.ceil((trialEndsAt − now) / 86400000)` using the **stored**
   `trialEndsAt`, or hardcoded/derived some other way?
3. Is there a timezone mismatch (comparing a UTC timestamp against local `now` or vice versa) adding
   an extra day?

**Fix:** once the root cause is found, this is a one-to-two-line fix — read the stored value, compute
the diff correctly, don't recompute the end date itself anywhere except at signup. Write exactly one
test: create a trial, advance the clock 7 days, assert days-left is correct. No other tests.

**Stop and report:** which of the 3 diagnose steps was the actual cause, and the one-line fix.

**Kiro prompt:**
> Read Cluster 2 of this bugfix sprint only. Find the root cause using the 3 diagnose steps in order,
> report which one it is, then apply the smallest possible fix plus the one test described. Stop and
> report before continuing.

---

## CLUSTER 3 — Receipt / PDF / Print all show different things + cost missing from analytics
**Priority: third. Budget: ~300 credits.**

**Symptoms (items 4, 5, 9):** the on-screen booking confirmation receipt doesn't match the landing
page's design, and the data on it is wrong. Clicking Download PDF or Print produces a **third**,
different-looking design. Separately, completed-order cost/estimate isn't showing up in the analytics
numbers.

**Diagnose first:**
- Confirm there are currently 2–3 separate code paths for "the receipt": one React component for the
  on-screen confirmation, and a separate template/library call for PDF generation, and possibly a
  third for print. Name each file.
- For the wrong data: is the confirmation page reading from the actual `Appointment`/`Transaction`
  record, or from stale/mock data left over from development?
- For analytics: trace where `Transaction.amount` or `Appointment.estimate` is supposed to feed into
  Requirement 16's monthly totals — is the query actually including completed orders, or filtering
  them out / reading the wrong field?

**Fix:**
- **Consolidate to one component.** Build a single `BookingReceipt` component that takes a normalized
  data shape (groomer branding, pet, services, date/time, address, cost, deposit). Use it for the
  on-screen confirmation. For PDF: render that same component and convert it (follow the `pdf` skill
  for the correct approach in this environment — don't hand-build a second template). For print: use
  a print stylesheet on the same on-screen component (`@media print`), not a separate render path.
  This single change is what fixes items 4, 5, and most of 9's design complaint at once.
- Wire the component to real `Appointment`/`Client`/`Pet`/`Transaction` data — fix the specific wrong
  field(s) found in diagnosis, don't rewrite the data layer.
- Analytics: fix the specific query/filter found in diagnosis so completed-order cost is included.
  One field, not a rebuild of Requirement 16.
- **Design quality:** if 21st.dev/Magic UI references were given before and ignored, re-paste the
  actual component code (not just a description) into this cluster's prompt so Kiro adapts real code
  to theme tokens instead of inventing a design from a text description.

**Stop and report:** screenshot of the on-screen receipt, the downloaded PDF, and the printed version
— all three should now be visually identical.

**Kiro prompt:**
> Read Cluster 3 of this bugfix sprint only. Diagnose first and name every file involved in the current
> receipt/PDF/print paths. Consolidate to one shared component as described, wire it to real data, fix
> the analytics field. Stop and show me all three outputs side by side before continuing.

---

## CLUSTER 4 — Calendar styling is dull + live tracking doesn't show the groomer
**Priority: fourth. Budget: ~250 credits.**

**Symptoms (items 6, 7):** calendar appointment blocks look like default/unstyled elements, not themed.
Live tracking page shows nothing even though the groomer shared their location.

**Diagnose first — calendar:**
- Run the Section 18a grep check (`grep -rE "#[0-9a-fA-F]{3,6}|bg-(slate|gray|zinc|blue)-" src`)
  scoped specifically to the calendar components. If it finds hits there, that's the whole bug —
  Phase 0's migration simply missed these files.
- If no hardcoded colors are found, check whether the calendar is using daisyUI's *default* badge/
  event colors instead of the theme's `primary`/`success`/etc. tokens explicitly.

**Diagnose first — tracking:**
- Confirm, in order: (1) does tapping "On my way" actually call `POST /api/track/{token}`? (2) is the
  Redis key `track:{token}` actually being written — log it once, remove the log after confirming;
  (3) does the token in the SMS link match the token the public page is polling for — a mismatch here
  is the most common cause of "shared location but nothing shows"; (4) is the public page's poll
  interval actually running (check browser network tab for repeated requests every ~10s).

**Fix:**
- Calendar: apply the correct existing token classes to the missed components. No redesign.
- Tracking: fix whichever link in the 4-step chain above is broken. Likely a 1-file fix once found.

**Stop and report:** screenshot of the calendar, and confirmation the tracking page updates within
10–20 seconds of a real position post.

**Kiro prompt:**
> Read Cluster 4 of this bugfix sprint only. Run the two diagnose checklists in order and report which
> step fails for each symptom. Apply only the fix needed at that step. Stop and show me the result.

---

## AFTER ALL 4 CLUSTERS — verification (don't skip, takes no credits)

Open the landing page and the live app side by side, for real, and check with your own eyes:
- Landing page's pet-card / route-card / receipt visuals vs. the actual dashboard, pet card, and
  receipt — same design language?
- Trial countdown: log in on day N of trial, confirm it shows the correct days-remaining, reload,
  confirm it didn't change.
- Book a test appointment end to end: on-screen receipt, PDF download, and print — identical design?
- Analytics page: does a just-completed order's cost show up in the current month's total?
- Calendar: do appointment blocks use the theme's colors, not gray/slate defaults?
- Tracking: share location from a second device/tab, confirm the public tracker page updates.

If any of these still fail, that's a new, smaller cluster for a Sprint 2 — don't reopen all four above.
