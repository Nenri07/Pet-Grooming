# PawPort Outreach Templates

Templates for reaching out to solo mobile groomers using **personalized demo
links**. Every prospect gets a preview page at `/demo/{slug}` (generate one with
`scripts/create-demo.ts`), and the "Claim it free" button on that page sends
them to `/register?claim={slug}`, which prefills their business name.

> **Honesty rules — read before sending.**
> - No invented statistics, revenue figures, or "average groomer saves X."
> - No fake testimonials or made-up customer names.
> - Only claim features that actually exist. If unsure, describe the demo and
>   let it speak for itself.
> - Fill in every `{placeholder}` before sending. Don't send a raw template.

---

## 1. Cold email

**Subject:** A booking page I built for {businessName}

Hi {firstName},

I build booking software for solo mobile groomers, and I put together a preview
page for {businessName}:

{appUrl}/demo/{slug}

It's a working sample of what your booking page could look like — branded to
you, with a routing feature that shows how far each new booking is from your
other stops and how many extra driving minutes it adds. The sample stops on the
page are made up (I don't have your real schedule), but the math is the real
thing.

If you like it, there's a "Claim it free" button on the page that sets up your
own version. No card required to try it.

Worth a look?

{yourName}
{yourContact}

*(If you'd rather not hear from me, just reply and I'll leave you be.)*

---

## 2. Facebook group post

> Check the group rules before posting. Many groomer groups require you to be a
> member for a while, or to post only in a designated promo thread. Don't spam.

Hey everyone 👋 I've been building a booking tool aimed specifically at solo
mobile groomers — the main idea is cutting down driving by ranking each new
booking by how well it fits the route you're already doing that day.

Instead of a generic pitch, I've been making a personalized preview page for
individual groomers so you can actually see it with your business name on it.
If you run a mobile grooming van and want one made for you, drop your business
name + city in the comments (or DM me) and I'll send a link.

Totally free to try, no card needed. Happy to answer any questions here too.

---

## 3. Follow-up message

> Send only if there was no reply, and no more than once. Give it a few days.

Hi {firstName},

Just circling back on the {businessName} preview I sent over:

{appUrl}/demo/{slug}

No pressure at all — I know things get busy between appointments. If the timing
isn't right, no worries. And if you took a look and something felt off or
missing, I'd genuinely like to hear it; that feedback helps me build the right
thing.

Either way, thanks for your time.

{yourName}

---

## Quick reference

- **Generate a demo:** `npx tsx scripts/create-demo.ts "Happy Paws" "Austin, TX"`
  then paste the printed object into `src/content/demos.ts`.
- **Preview link pattern:** `/demo/{slug}`
- **Claim link pattern:** `/register?claim={slug}` (prefills the business name)
- Demo pages are `noindex` and use sample data only — safe to share directly
  with a prospect, but they won't show up in search.
