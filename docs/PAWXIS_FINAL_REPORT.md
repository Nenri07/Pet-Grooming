# Pawxis: Final Project Report

Prepared from the code in this repo (`src/lib/plans.ts`, `src/content/plan-features.ts`, `src/content/landing.ts`, `docs/outreach.md`) and vendor price pages checked for this report. Vendor prices change, so check them again before you budget around them.

---

## 1. What Pawxis is

Pawxis is booking and route software for **solo mobile pet groomers** (one groomer, one van, driving to the client). It runs at www.pawxis.app.

The pitch: **"Groom more dogs. Drive less."**

Each groomer gets:
- a branded public booking page their clients book from (no app for clients to install),
- a portal to run the day: calendar, today's route, clients, pets, services, analytics, inbox, billing,
- route-aware booking (Order Radar) that shows how far a new booking is from the other stops and how much driving it adds,
- automation that keeps the day full (Fill My Day, Rebooking autopilot).

---

## 2. Plans and prices

| | Trial | Solo | Pro |
|---|---|---|---|
| Price (monthly) | Free, 14 days, no card | $29 | $59 |
| Price (annual, about 2 months free) | | $290 | $590 |
| Founding member price (first 20 groomers, locked for life) | | $19 | $39 |
| Client messages included per month | 2,000 | 800 | 2,000 |
| Features | Everything in Pro | Base toolkit | Base toolkit + route and automation |

- **Message top-up:** $5 for 1,000 extra messages (about 100 more clients). One-time purchase.
- **Rule of thumb used in the app:** about 10 messages per client per month (confirmation, 2 reminders, "on my way", invoice, a few messages). So 800 messages covers about 80 active clients and 2,000 covers about 200.
- **Billing provider:** Polar (merchant of record). Polar handles checkout, tax and the customer portal for the subscription.

### What each plan includes (exact pricing-card copy)

**Solo**
- Branded booking page
- Deposits & no-show protection
- Native calendar & ICS feed
- Client messaging by email (800/mo)
- Digital Pet Cards
- Appointment reminders

**Pro**
- Everything in Solo
- Order Radar route ranking
- Fill My Day auto-offers
- Live "on the way" tracking
- Rebooking autopilot
- Before/after share cards
- Client messaging by email (2,000/mo)

Pro features are blocked on the server for Solo and lapsed accounts, not only hidden in the UI.

---

## 3. Features in detail

### 3.1 For the groomer's clients
- **Booking page** (`/book/{slug}`): pet details and service, owner details, instant price estimate (service price adjusted by coat and weight rules), pick a time, pay a deposit if the groomer asks for one, confirmation.
- **Slot holds:** a picked time is held for 10 minutes so two clients can't book the same slot.
- **Professional invoice:** every confirmed booking gets an invoice in the groomer's name, viewable on screen and downloadable as PDF. It carries a small "Powered by Pawxis" mark.
- **Live tracker** (`/t/{token}`, Pro): a map with the van, ETA, and call/WhatsApp buttons.
- **Digital Pet Card** (`/pet-card/{id}`): shareable pet profile with QR code and PDF. "Next visit" follows the pet's coat type.
- **Claim link** (`/claim/{token}`, Pro): first client to claim a freed slot gets it.
- **Rebook link** (`/rebook/{token}`, Pro): books the next visit with pet and address filled in.

### 3.2 For the groomer (portal)
- **Dashboard:** today's route as a timeline with drive time between stops, map links per stop, Start / Complete / On my way buttons, upcoming 14 days, Order Radar card, Fill My Day, pets due for rebooking, this month's numbers, message allowance meter.
- **Calendar:** day and week views, drag to move, resize, times in the groomer's timezone.
- **ICS feed:** read-only feed the groomer subscribes to from Apple, Google or Outlook calendar.
- **Clients, Pets, Services, Availability:** weekly working hours, blocked dates, services with price and duration.
- **Service area:** base address, radius, or a drawn area on the map. Bookings outside it are flagged.
- **Analytics:** bookings, deposits, estimated revenue, no-show rate.
- **Inbox:** client messages by email. Replies go to the groomer's own mailbox.
- **Booking modes:** instant (auto-confirm) or request (groomer accepts).

### 3.3 Pro automation
- **Order Radar:** scores how well each open slot fits the day's route (extra driving minutes, distance to the previous stop, clustering) and marks the "Best fit" slot on the booking page.
- **Fill My Day:** when a booking more than 2 hours away is cancelled, Pawxis emails the freed slot to waitlisted or due clients automatically. The dashboard shows the revenue recovered this month.
- **Rebooking autopilot:** once a day, emails owners whose pet is due within 7 days (interval based on coat: smooth 6 weeks, double 8, wire 6, curly 5, long 5, matted 4). One nudge per pet per cycle.
- **Live "on the way" tracking:** the groomer taps On my way and the client gets a tracking link.
- **Before/after share cards:** a branded 1080x1350 image with the groomer's logo and booking link, ready to post or share.

### 3.4 Platform protection
- **Trial abuse checks:** email verification, disposable-email block, phone check, device and IP limits, one trial per phone number.
- **Lapsed accounts:** when the trial or subscription ends, the booking page stops taking new bookings and shows the groomer's phone and email. Existing appointments, pet cards and invoices stay readable. Paying again re-opens booking within 60 seconds.
- **Daily email cap guard:** counts every email sent. At 80% of the daily limit the founder gets one alert email. At 90%, optional emails (Fill My Day offers, rebooking nudges) pause so confirmations and reminders still go out.
- **Rate limits** on public booking endpoints, and graceful fallbacks when a service (maps, Redis) is missing.

### 3.5 Not built or limited today
- **No SMS texting.** All client messages are email. Reminders also offer a WhatsApp button. Twilio code exists but is not switched on.
- **No client login or client app** (by design; clients use links).
- **No referral program.**
- **Pet card links are shared by the groomer**, not sent automatically.
- **No stored final price** per appointment, so revenue analytics use the service base price.

---

## 4. Costs

### 4.1 Services Pawxis pays for

| Service | What it does | Free tier | Paid step |
|---|---|---|---|
| Vercel (hosting) | Runs the site and API | Hobby: $0, but **personal, non-commercial use only** | Pro: $20/mo (includes $20 usage credit) |
| Resend (email) | All client and account emails | 100 emails/day, 3,000/month | Pro: $20/mo for 50,000, $35/mo for 100,000, no daily cap |
| MongoDB Atlas (database) | Groomers, clients, pets, appointments | M0: free, 512 MB | Flex: $8 base, capped at $30/mo |
| Upstash Redis | Slot holds, live tracking, counters, cache | 500K commands/month | $0.20 per 100K commands |
| Image storage (UploadThing / Cloudinary) | Logos, pet photos, before/after | Free tier | UploadThing $25/mo for 250 GB |
| Mapbox (optional) | Maps, road drive times | Large free tier | Pay per use; app falls back to free OpenStreetMap without it |
| Polar (billing) | Subscription and top-up checkout | No monthly fee | Per-sale fee (below) |
| Domain (pawxis.app) | | | About $15/year (estimate) |

Sources: [Vercel Hobby terms](https://vercel.com/docs/plans/hobby), [Vercel Pro](https://vercel.com/docs/plans/pro-plan/switching), [Resend limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Resend pricing](https://resend.com/pricing), [MongoDB Flex](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/), [Upstash pricing](https://upstash.com/pricing), [UploadThing pricing](https://docs.uploadthing.com/blog/usage-based), [Polar fees](https://polar.sh/docs/fees).

### 4.2 Polar fees per sale

Which rate applies depends on when the Polar organization was created:
- **Created before May 27, 2026 (Early Member):** 4% + 40 cents, plus 0.5% on subscription payments. Kept forever unless you move to a paid Polar plan.
- **Created on or after May 27, 2026 (Starter):** 5% + 50 cents.
- **Extra:** +1.5% for non-US cards, $15 per dispute. Payouts: $2 per month with payouts, 0.25% + 25 cents per payout, and a currency conversion fee of up to 1% outside the EU.
- **Polar Pro plan:** $20/mo for 3.8% + 40 cents. It only pays off above about $1,379/month in sales, compared with Starter.

The numbers below use the **Starter rate (5% + 50 cents)**, the more expensive case. Early Member works out slightly cheaper.

### 4.3 What one groomer is worth per month

Email cost is worked out at Resend Pro ($20 for 50,000 emails = $0.0004 per email), with the groomer using the full allowance.

| Plan | Price | Polar fee | Email cost (full allowance) | Left for Pawxis |
|---|---|---|---|---|
| Solo monthly | $29.00 | $1.95 | $0.32 | **$26.73** |
| Pro monthly | $59.00 | $3.45 | $0.80 | **$54.75** |
| Founding Solo | $19.00 | $1.45 | $0.32 | **$17.23** |
| Founding Pro | $39.00 | $2.45 | $0.80 | **$35.75** |
| Solo annual ($290) | $24.17/mo | $1.25/mo | $0.32 | **$22.60/mo** |
| Pro annual ($590) | $49.17/mo | $2.50/mo | $0.80 | **$45.87/mo** |
| Top-up ($5, one-time) | $5.00 | $0.75 | $0.40 | **$3.85** |

Hosting, database and Redis are shared costs and are covered in the next section. Payout and currency fees take roughly another 1 to 1.5% when you withdraw.

### 4.4 Where $29 from a Solo groomer goes (at about 50 groomers)

| Item | Amount | Share |
|---|---|---|
| Polar fee | $1.95 | 6.7% |
| Email (full allowance) | $0.32 | 1.1% |
| Share of hosting, database, Redis, storage (about $75/mo split across 50) | $1.50 | 5.2% |
| Payout and currency fees (about 1.25%) | $0.34 | 1.2% |
| **Kept by Pawxis** (before income tax) | **$24.89** | **85.8%** |

### 4.5 Monthly running cost by stage

| Stage | What changes | Monthly cost |
|---|---|---|
| **Now (no paying groomers)** | Everything on free tiers | About $1 (domain) |
| **First paying groomer to about 25** | Vercel Pro is required once Pawxis earns money. Resend Pro is needed early: 3,000 free emails/month is used up by about 4 Solo groomers, and the 100/day cap can drop confirmations on a busy day. | About $41 (Vercel $20 + Resend $20 + domain) |
| **About 25 to 100 groomers** | Database outgrows 512 MB (Flex up to $30), Redis goes past the free commands, image storage may need a paid plan, Resend moves to the 100K tier | About $100 to $140 |

**Break-even:** at $41/month, **2 Solo groomers at full price** (or 3 founding Solo groomers) cover the running costs.

**Example at 100 groomers** (70 Solo, 30 Pro, full monthly price):
- Sales: 70 x $29 + 30 x $59 = **$3,800/month**
- Polar fees (Starter): about **$240**
- Running costs: about **$130**
- Left before payout fees and tax: about **$3,430/month (about 90%)**
- At this size, moving to Polar Pro ($20/mo) saves about $35/month if you are on Starter. If you are on Early Member, stay on it.

### 4.6 Costs to watch
- **Email volume is the main cost that grows with groomers.** The daily cap guard protects the Resend free plan, but move to Resend Pro before the first paying groomers arrive.
- **Vercel Hobby is not allowed for a paid product.** Plan to switch when the first subscription comes in.
- **SMS would change the numbers.** If texting is added later, each text costs money and US texting needs carrier registration. The current prices assume email only.
- **Groomer deposits cost Pawxis nothing.** Groomers connect their own payment account, payment fees come out of their deposits, and Pawxis takes 0%.

---

## 5. Groomer strategy

### 5.1 Who to target
- **Primary:** solo mobile groomers in the US with one van, already busy enough to feel the pain of driving and no-shows (roughly 40 to 150 active clients).
- **Secondary:** new mobile groomers setting up their first booking page, who want to look professional from day one.
- **Not a fit today:** salons and multi-van fleets (no staff accounts, no per-van routing), and groomers who rely on two-way texting.

### 5.2 Positioning against competitors
- MoeGo's mobile plans are listed at about $49 / $99 / $159 per van per month, with 200 texts on the basic plan ([The Daily Groomer, 2026](https://www.thedailygroomer.com/blog/moego-review-2026-features-pricing-verdict)). Pawxis Solo is $29 and Pro is $59.
- **Lead with route ranking.** "Every new booking shows how much driving it adds, and the booking page offers the times that fit your route." That is the clearest difference for a mobile groomer.
- **Second message:** Fill My Day and Rebooking autopilot fill cancelled slots and bring clients back without the groomer chasing them.
- **Be upfront about email.** Say "client messaging by email, with replies to your inbox" and do not imply texting. Groomers who need SMS will churn if they find out later.
- Do not name competitors on the site. Keep comparisons to "typical grooming software" and keep every claim true.

### 5.3 Pricing tactics
1. **Every signup starts on a 14-day Pro trial with no card.** The groomer sees Order Radar and Fill My Day working with their own clients, which makes Pro easier to sell than Solo.
2. **Use the 20 founding spots as the launch offer.** $19 Solo / $39 Pro locked for life. Show the spots left. Ask founding members for feedback and a testimonial in return.
3. **Push annual billing** (2 months free). Annual cuts Polar's fixed fee from 12 charges to 1 and lowers churn.
4. **Sell top-ups only to heavy users.** At $5 for 1,000 messages it covers a lot, so most groomers will not need it.
5. **Measure the Pro upgrade with the dashboard's "recovered this month" figure.** One filled cancellation usually pays for the $30 difference between Solo and Pro.

### 5.4 Onboarding and keeping groomers
- **Goal: a working booking page in about 10 minutes.** Business details, services, hours, service area, then share the link.
- **First-week checklist to send each new groomer:** add services, set hours and service area, import or add clients, put the booking link in the Instagram/Facebook bio and Google Business Profile, take the first booking.
- **Retention comes from daily use:** the calendar, pet cards, the client list and the ICS feed. A groomer whose clients book through Pawxis is unlikely to leave.
- **Day 10 of the trial:** personal email from the founder with what they have used so far and the founding price.
- **After a cancellation:** ask why. Early churn reasons decide what to build next (SMS, multi-van, final price per appointment).

---

## 6. Promotion plan

### 6.1 Assets you already have
- **Personalized demo pages:** `/demo/{slug}` shows a booking page and Order Radar branded with the prospect's business name and city. Make one with `npx tsx scripts/create-demo.ts "Business Name" "City, ST"`, then add it to `src/content/demos.ts`. The "Claim it free" button opens signup with the business name filled in.
- **Outreach templates:** `docs/outreach.md` (cold email, Facebook group post, follow-up), with honesty rules.
- **Built-in word of mouth:** every client invoice says "Powered by Pawxis". Before/after share cards carry the groomer's booking link, so groomers advertise their Pawxis page whenever they post.
- **Coming-soon page** with a launch countdown (`COMING_SOON` and `NEXT_PUBLIC_LAUNCH_AT`) for collecting interest before launch.

### 6.2 Channels, in order of priority

| # | Channel | What to do | Weekly target |
|---|---|---|---|
| 1 | **Facebook groups for mobile groomers** | Join, read the rules, help first. Post the "drop your business name and city, I'll build you a preview" offer only where promotion is allowed. | 1 post, 10+ helpful replies |
| 2 | **Personalized demo outreach** | Find mobile groomers on Google Maps, Instagram and Facebook. Make a demo for each and send it with the cold email template. One follow-up only. | 20 to 30 demos |
| 3 | **Instagram Reels / TikTok** | 15 to 30 second screen recordings: a booking dropping into the route, Fill My Day refilling a cancelled slot, a before/after card. | 3 short videos |
| 4 | **Founding member program** | Close the first 20 groomers personally (call or video). Their feedback and quotes become the first real testimonials on the site. | Until 20 are taken |
| 5 | **Grooming schools and mobile van builders / outfitters** | Offer a discount code or extended trial to their students and buyers. New mobile groomers need a booking system right away. | 2 contacts |
| 6 | **Reddit and forums** (for example r/doggrooming) | Answer questions about scheduling and routing. Mention Pawxis only when it is relevant and allowed. | 3 useful answers |
| 7 | **Search content** | Short articles: "how to plan a mobile grooming route", "how to cut no-shows", "mobile grooming deposit policy template". Each links to signup. | 1 article |
| 8 | **YouTube creators who run mobile grooming vans** | Offer a free year in exchange for an honest review. | 1 contact |

### 6.3 First 90 days

| Weeks | Focus | Goal |
|---|---|---|
| 1 to 2 | Move Vercel and Resend to paid plans. Set `ADMIN_EMAIL` and the Polar top-up price. Make 50 demos. Join 10 groomer groups. | Ready to take paying groomers |
| 3 to 6 | Demo outreach and Facebook posts. Personal onboarding call with every trial. | 50 trials, first 10 founding members |
| 7 to 10 | Post short videos from real (permitted) use. Add founding member quotes to the site. | All 20 founding spots taken |
| 11 to 13 | Grooming schools and van builders. First search articles. Raise new signups to full price. | 40+ paying groomers |

### 6.4 Numbers to track every week
- Demos sent and demo pages opened
- Demo to signup (claim) rate
- Trials started, and how many take a first real booking during the trial
- Trial to paid rate, and Solo vs Pro split
- Monthly churn and the reason for each cancellation
- Emails sent per day (in the `/api/cron/reminders` response) compared with the Resend limit

### 6.5 Rules for all promotion
- No invented numbers, savings claims or testimonials. Use real groomers' words only, with permission.
- Only promote features that work today. No texting claims.
- **Do not send cold outreach through Resend.** Resend sends Pawxis's booking and reminder emails, and cold email would hurt their delivery and use up the daily limit. Send outreach from a separate mailbox, ideally on a separate domain.
- Follow each Facebook group's rules, and stop contacting anyone who asks you to.

---

## 7. Founder checklist before scaling
- [ ] Upgrade Vercel to Pro when the first subscription is paid
- [ ] Upgrade Resend to Pro (or before about 4 active groomers)
- [ ] Set `ADMIN_EMAIL` in Vercel so the daily email alert reaches you
- [ ] Set the Polar top-up product price to $5
- [ ] Optional: set up the 15-minute external cron for reminders
- [ ] Check which Polar fee rate your organization is on (Early Member or Starter)
- [ ] Review terms, privacy policy and the location-sharing notice with a lawyer
- [ ] Watch MongoDB storage and move to Flex before 512 MB
