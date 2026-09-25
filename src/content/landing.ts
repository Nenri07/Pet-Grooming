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
  /** Founding-locked monthly price for the Solo plan. */
  soloMonth: number;
  /** Founding-locked monthly price for the Pro plan. */
  proMonth: number;
}

// ---------------------------------------------------------------------------
// Problem strip (Section 7.2)
// ---------------------------------------------------------------------------

/** A single pain-point card in the problem strip. */
export interface ProblemCard {
  /** The pain, stated plainly. */
  title: string;
  /** One line on how it hurts a solo groomer's day. */
  body: string;
}

// ---------------------------------------------------------------------------
// Bento features (Section 7.4)
// ---------------------------------------------------------------------------

/** A feature cell in the bento grid. */
export interface Feature {
  title: string;
  body: string;
  /**
   * Relative visual weight for the bento layout. `wide` cells span two
   * columns on large screens; `tall` cells span two rows; `normal` is 1x1.
   */
  size?: 'normal' | 'wide' | 'tall';
  /** When true, the featured booking image is shown inside the cell. */
  withImage?: boolean;
}

// ---------------------------------------------------------------------------
// Comparison table (Section 7.9)
// ---------------------------------------------------------------------------

/** A single comparison row: PawPort vs typical grooming software. */
export interface ComparisonRow {
  /** The capability being compared. */
  label: string;
  /** PawPort's answer: true = included, false = not, or a short string. */
  pawport: boolean | string;
  /** Typical software's answer. */
  typical: boolean | string;
}

export interface Comparison {
  /** Neutral label for the competitor column (never name a competitor). */
  otherLabel: string;
  rows: ComparisonRow[];
}

// ---------------------------------------------------------------------------
// Pricing (Section 7.10)
// ---------------------------------------------------------------------------

/** A single pricing plan card. */
export interface Plan {
  name: string;
  /** Monthly price in whole dollars. */
  monthly: number;
  /**
   * Annual price in whole dollars (billed yearly). Annual = 2 months free,
   * so it is 10x the monthly price.
   */
  annual: number;
  /** Short positioning line. */
  tagline: string;
  /** Bullet list of what's included. */
  features: string[];
  cta: Cta;
  /** Highlight this card as the recommended plan. */
  featured?: boolean;
}

export interface Pricing {
  plans: Plan[];
  /** Note shown under the toggle explaining annual savings. */
  annualNote: string;
}

// ---------------------------------------------------------------------------
// FAQ (Section 7.11)
// ---------------------------------------------------------------------------

export interface FaqItem {
  question: string;
  answer: string;
}

// ---------------------------------------------------------------------------
// How it works (3-step stepper)
// ---------------------------------------------------------------------------

/** A single step in the "how it works" sequence. */
export interface HowItWorksStep {
  /** Step label, e.g. "Book". */
  title: string;
  /** One line explaining what happens at this step. */
  body: string;
}

export interface HowItWorksContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: HowItWorksStep[];
}

// ---------------------------------------------------------------------------
// Receipt showcase (branded booking receipt / slip)
// ---------------------------------------------------------------------------

/** Sample fields shown on the stylized booking-receipt ticket mockup. */
export interface ReceiptSample {
  /** Booking reference, e.g. "PP-XK4T9M". */
  reference: string;
  /** Numeric amount used by the NumberTicker (deposit paid). */
  amount: number;
  /** Currency prefix for the amount, e.g. "$". */
  currency: string;
  /** Human date label, e.g. "Thu 12 Jun". */
  date: string;
  /** Human time label, e.g. "2:30 PM". */
  time: string;
  /** Pet name shown on the ticket. */
  pet: string;
  /** Service name shown on the ticket. */
  service: string;
  /** Deposit pill label, e.g. "Deposit paid". */
  depositLabel: string;
}

export interface ReceiptContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Label for the download micro-interaction button. */
  downloadLabel: string;
  sample: ReceiptSample;
}

// ---------------------------------------------------------------------------
// Final CTA (Section 7.12)
// ---------------------------------------------------------------------------

export interface FinalCtaContent {
  title: string;
  sub: string;
  primaryCta: Cta;
  secondaryCta: Cta;
  trust: string;
}

// ---------------------------------------------------------------------------
// Landing shape
// ---------------------------------------------------------------------------

export interface Landing {
  hero: HeroContent;
  /** Problem-strip cards (Section 7.2). */
  problems: ProblemCard[];
  /** Bento feature cells (Section 7.4). */
  features: Feature[];
  /** Grooming services / words for the marquee (Section 7.7). */
  services: string[];
  /** Headline metrics. EMPTY by default — hide the stats block when empty. */
  stats: Stat[];
  /** Testimonials. EMPTY by default — hide the section when empty. */
  testimonials: Testimonial[];
  /** Founding program, shown in place of real stats/testimonials for now. */
  founding: Founding;
  /** 3-step "how it works" sequence. */
  howItWorks: HowItWorksContent;
  /** Branded booking-receipt showcase. */
  receipt: ReceiptContent;
  /** Comparison table (Section 7.9). */
  comparison: Comparison;
  /** Pricing plans + toggle copy (Section 7.10). */
  pricing: Pricing;
  /** FAQ accordion items (Section 7.11). */
  faq: FaqItem[];
  /** Closing CTA band (Section 7.12). */
  finalCta: FinalCtaContent;
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

  problems: [
    {
      title: 'Cancelled at 8am. Slot gone.',
      body: 'A last-minute drop-out leaves a hole in your day that never gets filled.',
    },
    {
      title: '40 minutes of zig-zag driving.',
      body: 'Bookings land in random order, so you burn the day criss-crossing town.',
    },
    {
      title: 'Texts, DMs and calls in five places.',
      body: 'Every client talks to you somewhere different, and things slip through.',
    },
  ],

  features: [
    {
      title: 'Smart booking page',
      body: 'A branded page where clients pick a service and a time that fits your route — no back-and-forth.',
      size: 'wide',
      withImage: true,
    },
    {
      title: 'Deposits',
      body: 'Take a deposit up front so no-shows cost them, not you.',
    },
    {
      title: 'Two-way texting',
      body: 'Every client conversation in one inbox, with reminders that cut no-shows.',
    },
    {
      title: 'Native calendar',
      body: 'Your whole week in one place, with a read-only feed for your phone calendar. No third-party sync.',
      size: 'tall',
    },
    {
      title: 'Digital Pet Cards',
      body: 'Coat, temperament and past styles travel with every pet, so each visit feels personal.',
    },
    {
      title: 'Rebooking autopilot',
      body: 'Nudge clients to rebook on the right cycle for their pet\u2019s coat, automatically.',
    },
  ],

  services: [
    'Full groom',
    'Bath & tidy',
    'De-shed',
    'Puppy first groom',
    'Nail trim',
    'Hand-stripping',
    'Cat groom',
    'Teeth brushing',
    'Ear cleaning',
    'Paw & pad tidy',
    'Blow-dry & style',
    'Flea treatment',
  ],

  // Intentionally empty (Section 7.7): do NOT invent stats or testimonials.
  stats: [],
  testimonials: [],

  founding: { spots: 20, soloMonth: 19, proMonth: 39 },

  howItWorks: {
    eyebrow: 'How it works',
    title: 'From booking to doorstep in three steps',
    subtitle:
      'No app for your clients, no zig-zag driving for you — just a booking page that works with your route.',
    steps: [
      {
        title: 'Client books',
        body: 'They pick a service and a time on your branded page and pay a deposit — no back-and-forth texts.',
      },
      {
        title: 'PawPort routes it',
        body: 'Order Radar ranks the booking against your day, so you only say yes to the stops that fit.',
      },
      {
        title: 'Receipt & reminders',
        body: 'Everyone gets a branded receipt to download, plus reminders that quietly cut no-shows.',
      },
    ],
  },

  receipt: {
    eyebrow: 'Branded receipts',
    title: 'Every booking comes with a receipt clients can keep',
    subtitle:
      'The moment a deposit is paid, PawPort generates a branded booking receipt clients can download and show on arrival.',
    downloadLabel: 'Download receipt',
    sample: {
      reference: 'PP-XK4T9M',
      amount: 15,
      currency: '$',
      date: 'Thu 12 Jun',
      time: '2:30 PM',
      pet: 'Bella',
      service: 'Full groom',
      depositLabel: 'Deposit paid',
    },
  },

  comparison: {
    otherLabel: 'Typical grooming software',
    rows: [
      { label: 'Route-aware booking', pawport: true, typical: false },
      { label: 'Shows extra driving per booking', pawport: true, typical: false },
      { label: 'Auto-fills cancelled slots', pawport: true, typical: false },
      { label: 'Text messaging included', pawport: true, typical: 'Extra add-on' },
      { label: 'Digital Pet Cards', pawport: true, typical: false },
      { label: 'Built for a solo van', pawport: true, typical: 'Built for salons' },
      { label: 'Starting price', pawport: '$29/mo', typical: '$49+/mo' },
    ],
  },

  pricing: {
    annualNote: 'Save two months when you pay annually.',
    plans: [
      {
        name: 'Solo',
        monthly: 29,
        annual: 290,
        tagline: 'Everything a one-van groomer needs to get booked.',
        features: [
          'Branded booking page',
          'Deposits & no-show protection',
          'Native calendar & ICS feed',
          'Two-way texting included',
          'Digital Pet Cards',
          'Appointment reminders',
        ],
        cta: { label: 'Start free — 14 days', href: '/register' },
      },
      {
        name: 'Pro',
        monthly: 59,
        annual: 590,
        tagline: 'Route smarts and automation that keep your day full.',
        features: [
          'Everything in Solo',
          'Order Radar route ranking',
          'Fill My Day auto-offers',
          'Live \u201con the way\u201d tracking',
          'Rebooking autopilot',
          'Before/after share cards',
        ],
        cta: { label: 'Start free — 14 days', href: '/register' },
        featured: true,
      },
    ],
  },

  faq: [
    {
      question: 'Do the text messages cost extra?',
      answer:
        'No. A monthly text allowance is included in every plan, so appointment reminders and confirmations are covered out of the box. If you send a lot, you can top up any time.',
    },
    {
      question: 'Can I cancel any time?',
      answer:
        'Yes. Plans are month-to-month and you can cancel whenever you like. Your data stays available so you can export it before you go.',
    },
    {
      question: 'Can I import my existing clients?',
      answer:
        'Yes. You can bring your current client and pet list in when you set up, so you are not starting from scratch on day one.',
    },
    {
      question: 'Do my clients need to download an app?',
      answer:
        'No. Clients book, pay a deposit and track your arrival from a normal web link on their phone. There is nothing for them to install.',
    },
  ],

  finalCta: {
    title: 'Groom more dogs. Drive less.',
    sub: 'Set up your booking page, calendar and no-show shield in about ten minutes.',
    primaryCta: { label: 'Start free — 14 days', href: '/register' },
    secondaryCta: { label: 'See it in action', href: '#order-radar' },
    trust: 'No card required · Cancel any time',
  },
};

export default landing;
