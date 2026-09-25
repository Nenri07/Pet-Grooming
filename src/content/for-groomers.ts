/**
 * Copy for the `/for-groomers` bundle pitch page — single source of truth.
 *
 * This page sells the BUNDLE ("your own branded website + the booking engine
 * behind it") to prospective solo mobile pet groomers. All copy lives here so
 * it can be edited in one place; every section is typed.
 *
 * Honesty rules (mirrors `content/landing.ts`, Section 7.7):
 *   - No invented stats, ratings, or testimonials.
 *   - No fabricated competitor prices. The "what it replaces" framing talks
 *     about juggling several separate tools, never a named rival's pricing.
 *   - Prices/founding data are NOT duplicated here — the pricing UI reads the
 *     real numbers from `@/lib/plans` (PLANS / FOUNDING) so they never drift.
 */

import type { Cta } from '@/content/landing';

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export interface ForGroomersHero {
  /** Small uppercase kicker above the headline. */
  eyebrow: string;
  /** Main headline (rendered with font-display). */
  headline: string;
  /** Supporting subheadline. */
  sub: string;
  /** Primary CTA — drives to sign-up. */
  primaryCta: Cta;
  /** Secondary CTA — jumps to a live demo. */
  secondaryCta: Cta;
  /** Small reassurance line under the CTAs. */
  trust: string;
  /** Business name shown in the mocked browser chrome. */
  mockBusiness: string;
}

// ---------------------------------------------------------------------------
// What you get (bundle items)
// ---------------------------------------------------------------------------

/**
 * Icon hints map to lucide-react icon names, resolved in the component. Keeping
 * them as strings here keeps this content module free of React imports.
 */
export type BundleIcon =
  | 'globe'
  | 'calendar-check'
  | 'route'
  | 'id-card'
  | 'message-square'
  | 'receipt'
  | 'map-pin';

/** A single item included in the bundle. */
export interface BundleItem {
  title: string;
  description: string;
  /** lucide-react icon name hint. */
  icon: BundleIcon;
  /**
   * Relative visual weight for the bento layout. `wide` cells span two columns
   * on large screens; `normal` is 1x1.
   */
  size?: 'normal' | 'wide';
  /**
   * Optional bundled image key (from `@/content/images.generated`) shown inside
   * the cell where a visual helps sell the point.
   */
  image?: 'featureBooking' | 'featureCard' | 'featureRoute';
}

// ---------------------------------------------------------------------------
// Bundle value ("one bundle instead of 3-4 tools")
// ---------------------------------------------------------------------------

/** A separate tool a groomer would otherwise stitch together. */
export interface ReplacedTool {
  /** Generic category label, never a competitor's brand. */
  label: string;
  /** What that separate tool would normally do on its own. */
  role: string;
  /** lucide-react icon name hint. */
  icon: BundleIcon;
}

export interface BundleValueContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** The separate tools that collapse into one PawPort subscription. */
  replaces: ReplacedTool[];
  /** Label on the single merged PawPort card. */
  bundleLabel: string;
  /** One honest line under the merge visual. */
  note: string;
}

// ---------------------------------------------------------------------------
// Pricing (copy only — numbers come from @/lib/plans)
// ---------------------------------------------------------------------------

export interface BundlePricingContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Note shown under the toggle explaining annual savings. */
  annualNote: string;
  /** Per-plan positioning + feature bullets, keyed by tier. */
  solo: { name: string; tagline: string; features: string[] };
  pro: { name: string; tagline: string; features: string[] };
  /** CTA reused on every plan card. */
  cta: Cta;
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export interface ForGroomersFaqItem {
  question: string;
  answer: string;
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

export interface ForGroomersFinalCta {
  title: string;
  sub: string;
  primaryCta: Cta;
  secondaryCta: Cta;
  trust: string;
}

// ---------------------------------------------------------------------------
// Page shape
// ---------------------------------------------------------------------------

export interface ForGroomersContent {
  hero: ForGroomersHero;
  whatYouGet: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: BundleItem[];
  };
  bundleValue: BundleValueContent;
  pricing: BundlePricingContent;
  faq: ForGroomersFaqItem[];
  finalCta: ForGroomersFinalCta;
}

export const forGroomers: ForGroomersContent = {
  hero: {
    eyebrow: 'For solo mobile groomers',
    headline: 'Your own branded website — plus the booking engine behind it.',
    sub: 'PawPort gives you a professional website at your own link and the booking, deposits and routing that run behind it. One subscription, set up in an afternoon.',
    primaryCta: { label: 'Start free — 14 days', href: '/register' },
    secondaryCta: { label: 'See a live demo', href: '/demo/happy-paws' },
    trust: 'No card required · Your own booking link in minutes',
    mockBusiness: 'Happy Paws',
  },

  whatYouGet: {
    eyebrow: "What's in the bundle",
    title: 'A website and a booking business, together',
    subtitle:
      'Not just a pretty page and not just a calendar — the whole thing your clients see and the tools that keep your day running.',
    items: [
      {
        title: 'Branded website at your own link',
        description:
          'A polished site with your name, colours and services at a link you can share anywhere — no web designer, no monthly hosting bill on top.',
        icon: 'globe',
        size: 'wide',
        image: 'featureBooking',
      },
      {
        title: 'Online booking with deposits',
        description:
          'Clients pick a service and a time and pay a deposit up front, so a no-show costs them, not you.',
        icon: 'calendar-check',
      },
      {
        title: 'Order Radar routing',
        description:
          'Every new booking is ranked against your day, so you only say yes to the stops that fit your route.',
        icon: 'route',
        image: 'featureRoute',
      },
      {
        title: 'Digital Pet Cards',
        description:
          'Coat, temperament and past styles travel with each pet, so every visit feels personal.',
        icon: 'id-card',
        image: 'featureCard',
      },
      {
        title: 'Two-way SMS + reminders',
        description:
          'Every client conversation in one inbox, with automatic reminders that quietly cut no-shows.',
        icon: 'message-square',
      },
      {
        title: 'Downloadable receipts',
        description:
          'The moment a deposit is paid, PawPort generates a branded receipt clients can download and keep.',
        icon: 'receipt',
      },
      {
        title: 'Live "on my way" tracking',
        description:
          'Send clients a live arrival link on the day, so they know exactly when your van pulls up.',
        icon: 'map-pin',
      },
    ],
  },

  bundleValue: {
    eyebrow: 'One bundle, not a pile of tools',
    title: 'Stop juggling three or four separate tools',
    subtitle:
      'Most groomers stitch together a website builder, a booking tool, a texting service and a spreadsheet for pet notes. PawPort is all of that in one place, on one bill, that actually talk to each other.',
    replaces: [
      { label: 'Website builder', role: 'Your public site', icon: 'globe' },
      { label: 'Booking tool', role: 'Scheduling + deposits', icon: 'calendar-check' },
      { label: 'SMS / texting service', role: 'Reminders + chat', icon: 'message-square' },
      { label: 'Pet records spreadsheet', role: 'Client & pet notes', icon: 'id-card' },
    ],
    bundleLabel: 'PawPort',
    note: 'Instead of paying for and wiring up several separate tools, you get one subscription where booking, texting, routing and your website already work together.',
  },

  pricing: {
    eyebrow: 'Simple pricing',
    title: 'One plan per van. No surprises.',
    subtitle: 'Website, booking and messaging are all included — pick the plan that fits.',
    annualNote: 'Save two months when you pay annually.',
    solo: {
      name: 'Solo',
      tagline: 'Everything a one-van groomer needs to get booked.',
      features: [
        'Branded website at your own link',
        'Online booking with deposits',
        'Native calendar & ICS feed',
        'Two-way texting included',
        'Digital Pet Cards',
        'Downloadable receipts & reminders',
      ],
    },
    pro: {
      name: 'Pro',
      tagline: 'Route smarts and automation that keep your day full.',
      features: [
        'Everything in Solo',
        'Order Radar route ranking',
        'Fill My Day auto-offers',
        'Live "on my way" tracking',
        'Rebooking autopilot',
        'Before/after share cards',
      ],
    },
    cta: { label: 'Start free — 14 days', href: '/register' },
  },

  faq: [
    {
      question: 'Do I get my own domain?',
      answer:
        'You get your own branded booking link straight away, and you can point a custom domain you own at your PawPort site so clients see your name, not ours. There is no separate hosting bill on top.',
    },
    {
      question: 'Can clients book without downloading an app?',
      answer:
        'Yes. Clients open a normal web link on their phone to book, pay a deposit and track your arrival. There is nothing for them to install — for you or for them.',
    },
    {
      question: 'What does setup take?',
      answer:
        'Most groomers are live in an afternoon. You add your services and prices, set your hours, and your booking site is ready to share. You can import your existing client and pet list so you are not starting from scratch.',
    },
    {
      question: 'Is my data mine?',
      answer:
        'Yes. Your clients, pets and bookings are yours. Plans are month-to-month, and you can export your data any time — including before you leave.',
    },
    {
      question: 'Do the text messages cost extra?',
      answer:
        'A monthly text allowance is included in every plan, so reminders and confirmations are covered out of the box. If you send a lot, you can top up any time.',
    },
  ],

  finalCta: {
    title: 'Your website and your booking book, in one place.',
    sub: 'Set up your branded site, calendar and no-show shield in about an afternoon.',
    primaryCta: { label: 'Start free — 14 days', href: '/register' },
    secondaryCta: { label: 'See a live demo', href: '/demo/happy-paws' },
    trust: 'No card required · Cancel any time',
  },
};

export default forGroomers;
