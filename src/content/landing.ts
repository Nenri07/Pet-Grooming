/**
 * Landing page copy — single source of truth (Section 7).
 *
 * Keep ALL marketing copy for `/` here so it can be edited in one place. Each
 * section is typed. Sections that render dynamic proof (stats, testimonials)
 * are DATA-DRIVEN and start EMPTY on purpose (Section 7.7): never ship invented
 * numbers or fake quotes. Consumers must hide those sections when the arrays
 * are empty and fall back to the Founding-groomer program instead.
 *
 * Only the sections needed now (hero + placeholders) are fully populated. The
 * remaining sections are stubbed with typed placeholders to be filled later.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A call-to-action link (button). `href` may be a route or an in-page anchor. */
export interface Cta {
  label: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Hero (Section 7.1)
// ---------------------------------------------------------------------------

export interface HeroContent {
  /** Small uppercase kicker above the headline. */
  eyebrow: string;
  /** Main headline (rendered with font-display). */
  headline: string;
  /** Supporting subheadline. */
  sub: string;
  /** Primary CTA — drives to sign-up. */
  primaryCta: Cta;
  /** Secondary CTA — jumps to the Order Radar demo section. */
  secondaryCta: Cta;
  /** Small reassurance line under the CTAs. */
  trust: string;
}

// ---------------------------------------------------------------------------
// Proof sections (data-driven — EMPTY until real data exists, Section 7.7)
// ---------------------------------------------------------------------------

/** A headline metric. Rendered only when present; never invent these. */
export interface Stat {
  /** Numeric value to animate to (final value SSR-rendered). */
  value: number;
  /** Suffix shown after the number, e.g. "%", "+", "k". */
  suffix?: string;
  /** Prefix shown before the number, e.g. "$". */
  prefix?: string;
  /** Human label, e.g. "bookings taken". */
  label: string;
}

/** A customer testimonial. The whole section hides when there are none. */
export interface Testimonial {
  quote: string;
  author: string;
  /** Optional role / business, e.g. "Solo groomer, Leeds". */
  role?: string;
  /** Optional avatar image path under /public. */
  avatar?: string;
}

/** Founding-groomer program shown while real proof is not yet available. */
export interface Founding {
  /** Number of founding spots offered. */
  spots: number;
}

// ---------------------------------------------------------------------------
// Landing shape
// ---------------------------------------------------------------------------

export interface Landing {
  hero: HeroContent;
  /** Headline metrics. EMPTY by default — hide the stats block when empty. */
  stats: Stat[];
  /** Testimonials. EMPTY by default — hide the section when empty. */
  testimonials: Testimonial[];
  /** Founding program, shown in place of real stats/testimonials for now. */
  founding: Founding;
}

export const landing: Landing = {
  hero: {
    eyebrow: 'For solo mobile groomers',
    headline: 'Groom more dogs. Drive less.',
    sub: 'The booking, routing and no-show shield built for solo mobile groomers.',
    primaryCta: { label: 'Start free — 14 days', href: '/register' },
    secondaryCta: { label: 'See it in action', href: '#order-radar' },
    trust: 'No card required · Set up in 10 minutes',
  },

  // Intentionally empty (Section 7.7): do NOT invent stats or testimonials.
  stats: [],
  testimonials: [],

  founding: { spots: 20 },
};

export default landing;
