/**
 * Single source of truth for transactional email look and wording.
 *
 * Email clients ignore external CSS and web fonts, so templates use these
 * values as inline styles with system / Georgia font stacks.
 */
export const EMAIL_THEME = {
  width: 600,
  colors: {
    page: '#f4f1ea',
    card: '#ffffff',
    ink: '#1f2a37',
    muted: '#6b7280',
    faint: '#9ca3af',
    border: '#e8e3d8',
    brand: '#1e4b8f',
    brandText: '#ffffff',
    accent: '#d98a3d',
    soft: '#f7f4ee',
    success: '#1f7a4d',
    warning: '#9a5b00',
  },
  fonts: {
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    heading: "Georgia, 'Times New Roman', serif",
  },
  radius: 14,
} as const;

/** All user-facing copy for platform emails. Groomer-specific values are interpolated. */
export const EMAIL_COPY = {
  platformName: 'Pawxis',
  via: (business: string) => `${business} via Pawxis`,
  footer: (business: string) => `Sent for ${business} by Pawxis, booking software for mobile groomers.`,
  platformFooter: 'Pawxis, booking software for mobile pet groomers.',
  confirmation: {
    subject: (business: string, date: string) => `Booked with ${business}: ${date}`,
    heading: 'Your booking is confirmed',
    intro: (business: string, pet: string) => `Thanks for booking with ${business}. Here are the details for ${pet}.`,
    contactButton: (business: string) => `Message ${business}`,
    cancelLine: (business: string) =>
      `Need to change or cancel? Reply to this email or contact ${business} directly. Deposit refunds follow ${business}\u2019s own policy.`,
    trackingLine: 'On the day, you\u2019ll get an email with a live link to track your groomer\u2019s arrival.',
    petCardButton: 'Open your pet\u2019s card',
  },
  groomerNotice: {
    subject: (pet: string, date: string) => `New booking: ${pet} on ${date}`,
    heading: 'New booking',
    intro: 'You have a new booking. Reply to this email to message the client.',
  },
  replyHint: (business: string) => `Reply to this email to answer ${business}.`,
} as const;
