/**
 * Copy for the `/for-groomers` bundle pitch page — single source of truth.
 *
 * This page sells the BUNDLE ("your own booking page + the tools that run your
 * day") to prospective solo mobile pet groomers. All copy lives here so it can
 * be edited in one place; every section is typed.
 *
 * Honesty rules (mirrors `content/landing.ts`, Section 7.7):
 *   - Only describe what exists today. Anything planned is labelled "coming
 *     soon" (own domain, automatic text reminders, client import, data export).
 *     There is NO website builder, custom domain, subdomain site, client
 *     import, data export or brand-colour setting.
 *   - No invented stats, ratings, or testimonials.
 *   - No fabricated competitor prices. The "what it replaces" framing talks
 *     about juggling several separate tools, never a named rival's pricing.
 *   - Prices/founding data are NOT duplicated here — the pricing UI reads the
 *     real numbers from `@/lib/plans` (PLANS / FOUNDING) so they never drift.
 */

import type { Cta } from '@/content/landing';
import { PLAN_FEATURES } from '@/content/plan-features';
import { PLANS } from '@/lib/plans';

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
  /** When true, the cell shows a "Pro" pill: the item needs the Pro plan. */
  pro?: boolean;
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
    headline: 'Your own booking page, plus the tools behind it.',
    sub: 'Pawxis gives you a booking page with your name and logo, and the deposits, reminders and routing that run behind it. One subscription, set up in an afternoon.',
    primaryCta: { label: 'Start free — 14 days', href: '/register' },
    secondaryCta: { label: 'See a demo', href: '/demo/happy-paws' },
    trust: 'No card required · Your own booking link in minutes',
    mockBusiness: 'Happy Paws',
  },

  whatYouGet: {
    eyebrow: "What's in the bundle",
    title: 'The page your clients see, and the tools behind it',
    subtitle:
      'Not just a pretty page and not just a calendar. Everything from the first booking click to the invoice, in one place.',
    items: [
      {
        title: 'Your own booking page',
        description:
          'A page with your name, logo and services, at a link you can share anywhere: pawxis.app/book/yourname. No web designer needed.',
        icon: 'globe',
        size: 'wide',
        image: 'featureBooking',
      },
      {
        title: 'Online booking with deposits',
        description:
          'Clients pick a service and a time and pay a deposit up front. The money goes straight to you, through your own Stripe account or payment link, so a no-show costs them, not you.',
        icon: 'calendar-check',
      },
      {
        title: 'Order Radar routing',
        description:
          'Every new booking is ranked against your day, so you only say yes to the stops that fit your route.',
        icon: 'route',
        image: 'featureRoute',
        pro: true,
      },
      {
        title: 'Digital Pet Cards',
        description:
          'Coat, temperament and past styles travel with each pet, so every visit feels personal.',
        icon: 'id-card',
        image: 'featureCard',
      },
      {
        title: 'Client messaging + reminders',
        description:
          'Confirmations and reminders go out by email in your name, and replies reach your own inbox. Message any client in one tap by WhatsApp, from your own phone, or by email.',
        icon: 'message-square',
      },
      {
        title: 'Professional invoices',
        description:
          'Every booking gets a numbered invoice in your name, with deposit paid and balance due, ready to download as a PDF.',
        icon: 'receipt',
      },
      {
        title: 'Live "on my way" tracking',
        description:
          'Clients get a live arrival link by email on the day, so they can see when your van will arrive.',
        icon: 'map-pin',
        pro: true,
      },
    ],
  },

  bundleValue: {
    eyebrow: 'One bundle, not a pile of tools',
    title: 'Stop juggling three or four separate tools',
    subtitle:
      'Most groomers stitch together a booking tool, a reminder service, an invoice maker and a spreadsheet for pet notes. Pawxis puts them in one place, on one bill, and they work together.',
    replaces: [
      { label: 'Booking tool', role: 'Scheduling + deposits', icon: 'calendar-check' },
      { label: 'Reminder & messaging tool', role: 'Reminders + client messages', icon: 'message-square' },
      { label: 'Invoice maker', role: 'An invoice for every booking', icon: 'receipt' },
      { label: 'Pet records spreadsheet', role: 'Client & pet notes', icon: 'id-card' },
    ],
    bundleLabel: 'Pawxis',
    note: 'Instead of paying for and wiring up several separate tools, you get one subscription where booking, client messaging, routing and invoices already work together.',
  },

  pricing: {
    eyebrow: 'Simple pricing',
    title: 'One plan per van. No surprises.',
    subtitle: 'Booking, deposits and client messaging are all included. Pick the plan that fits.',
    annualNote: 'Save two months when you pay annually.',
    solo: {
      name: 'Solo',
      tagline: 'Everything a one-van groomer needs to get booked.',
      features: [...PLAN_FEATURES.solo],
    },
    pro: {
      name: 'Pro',
      tagline: 'Route smarts and automation that keep your day full.',
      features: [...PLAN_FEATURES.pro],
    },
    cta: { label: 'Start free — 14 days', href: '/register' },
  },

  faq: [
    {
      question: 'Do I get my own domain?',
      answer:
        'Not yet. Your booking page lives at pawxis.app/book/yourname, with your name and logo on it. Using your own domain, like yourname.com, is coming soon.',
    },
    {
      question: 'Can clients book without downloading an app?',
      answer:
        'Yes. Clients open a normal web link on their phone to book and pay a deposit. On Pro they can also follow your arrival on a live map. There is nothing to install, for you or for them.',
    },
    {
      question: 'What does setup take?',
      answer:
        'Most groomers are live in an afternoon. You add your services and prices, set your hours, and your booking page is ready to share. Importing an existing client list is coming soon. Until then, each client is added the first time they book through your link.',
    },
    {
      question: 'Is my data mine?',
      answer:
        'Yes. Your clients, pets and bookings are yours, and plans are month-to-month. A one-click data export is coming soon.',
    },
    {
      question: 'Do you text my clients?',
      answer: `Not automatically yet. Automatic text reminders are coming soon. For now, confirmations, reminders and arrival links go out by email in your name. Every plan includes a monthly allowance of client emails (${PLANS.solo.sms.toLocaleString('en-US')} on Solo, ${PLANS.pro.sms.toLocaleString('en-US')} on Pro), and you can top up any time. You can also message any client by WhatsApp or from your own phone's texting app.`,
    },
  ],

  finalCta: {
    title: 'Your booking page and your day, in one place.',
    sub: 'Set up your booking page, calendar and no-show shield in about an afternoon.',
    primaryCta: { label: 'Start free — 14 days', href: '/register' },
    secondaryCta: { label: 'See a demo', href: '/demo/happy-paws' },
    trust: 'No card required · Cancel any time',
  },
};

export default forGroomers;
