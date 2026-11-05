/**
 * Transactional email (Resend).
 *
 * Client-facing emails are sent "as" the groomer: From shows
 * "<Business> via Pawxis", the header shows the groomer's business, and
 * Reply-To is the groomer's own email so a client's reply goes straight to
 * them. Platform emails (verification, trial, waitlist) come from "Pawxis".
 *
 * Every email gets a plain-text part. Layout is email-safe (see ./layout).
 * Sends are best-effort: they never throw, return a boolean, and retry 3x.
 */
import { Resend } from 'resend';
import { EMAIL_COPY } from './theme';
import {
  button,
  cleanDisplayName,
  detailRows,
  escapeHtml,
  formatMoney,
  layout,
  paragraph,
  toPlainText,
  totalRow,
} from './layout';

export { toPlainText } from './layout';

let cachedResend: Resend | null | undefined;

function getResend(): Resend | null {
  if (cachedResend !== undefined) return cachedResend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY is not set — emails will be skipped.');
    cachedResend = null;
    return cachedResend;
  }
  cachedResend = new Resend(apiKey);
  return cachedResend;
}

/** Verified sending address (e.g. support@pawxis.app). */
function senderAddress(): string | null {
  const email = process.env.BUSINESS_EMAIL?.trim();
  if (!email) {
    console.warn('[email] BUSINESS_EMAIL is not set — emails will be skipped.');
    return null;
  }
  return email;
}

/** From header. With a groomer business: "Happy Paws via Pawxis" <support@…>. */
export function fromHeader(business?: string | null): string | null {
  const email = senderAddress();
  if (!email) return null;
  const name = cleanDisplayName(business);
  return `"${name ? EMAIL_COPY.via(name) : EMAIL_COPY.platformName}" <${email}>`;
}

/** A Reply-To value only when it looks like a real address. */
function safeReplyTo(addr: string | undefined | null): string | undefined {
  const a = (addr ?? '').trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(a) ? a : undefined;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastError;
}

export interface CapturedEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

let captureHook: ((m: CapturedEmail) => void) | null = null;

/**
 * Render emails instead of sending them while `fn` runs (previews + tests).
 * Never use in request handlers in production.
 */
export async function captureEmails(fn: () => Promise<unknown>): Promise<CapturedEmail[]> {
  const out: CapturedEmail[] = [];
  const prev = captureHook;
  captureHook = (m) => out.push(m);
  try {
    await fn();
  } finally {
    captureHook = prev;
  }
  return out;
}

/** Send one email with HTML + plain text. Never throws. */
async function deliver(
  label: string,
  msg: { from: string | null; to: string | undefined | null; subject: string; html: string; replyTo?: string }
): Promise<boolean> {
  const replyTo = safeReplyTo(msg.replyTo);
  if (captureHook) {
    captureHook({
      from: msg.from ?? '"Pawxis" <preview@example.com>',
      to: msg.to ?? 'preview@example.com',
      subject: msg.subject,
      html: msg.html,
      text: toPlainText(msg.html),
      replyTo,
    });
    return true;
  }
  const resend = getResend();
  if (!resend || !msg.from || !msg.to) return false;
  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from: msg.from as string,
        to: msg.to as string,
        subject: msg.subject,
        html: msg.html,
        text: toPlainText(msg.html),
        ...(replyTo ? { replyTo } : {}),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error(`[email] Failed to send ${label}:`, err);
    return false;
  }
}

/** Digits-only phone for wa.me links (keeps a leading country code). */
export function whatsappLink(phone: string | undefined | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? `https://wa.me/${digits}` : null;
}

/** "Call · Text · WhatsApp" links for the groomer, or ''. */
function contactLinks(phone: string | undefined | null): string {
  const p = phone?.trim();
  if (!p) return '';
  const wa = whatsappLink(p);
  const link = (href: string, text: string) => `<a href="${escapeHtml(href)}" style="color:#1e4b8f;font-weight:600;text-decoration:none;">${text}</a>`;
  return [link(`tel:${p}`, 'Call'), link(`sms:${p}`, 'Text'), wa ? link(wa, 'WhatsApp') : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
}

// ---------------------------------------------------------------------------
// Booking confirmation (client)
// ---------------------------------------------------------------------------

export interface ClientConfirmationDetails {
  /** Human-readable date in the groomer's time zone. */
  date: string;
  time: string;
  services: string[];
  serviceAddress: string;
  /** The groomer's business name. */
  groomerName: string;
  /** Deposit paid now, whole currency units. */
  depositAmount: number;
  /** ISO currency code, defaults to USD. */
  currency?: string;
  petName?: string;
  /** Service list price, for the balance-due line. */
  servicePrice?: number;
  petCardUrl?: string;
  /** Deposit still owed through the groomer's payment link. */
  depositDue?: number;
  depositLinkUrl?: string;
  depositLinkLabel?: string;
  /** Groomer's email: Reply-To and the "message" button. */
  groomerEmail?: string;
  groomerPhone?: string;
}

export async function sendClientConfirmationEmail(to: string, d: ClientConfirmationDetails): Promise<boolean> {
  const business = d.groomerName?.trim() || 'your groomer';
  const currency = d.currency ?? 'USD';
  const pet = d.petName?.trim() || 'your pet';
  const depositDue = d.depositDue && d.depositDue > 0 ? d.depositDue : 0;
  const paid = Math.max(0, d.depositAmount || 0);
  const price = typeof d.servicePrice === 'number' && d.servicePrice > 0 ? d.servicePrice : null;
  const balance = price !== null ? Math.max(0, price - paid - depositDue) : null;
  const c = EMAIL_COPY.confirmation;
  const replyTo = safeReplyTo(d.groomerEmail);

  const body = [
    paragraph(escapeHtml(c.intro(business, pet))),
    detailRows([
      ['Date', d.date],
      ['Time', d.time],
      ['Service', d.services.length ? d.services.join(', ') : 'Grooming'],
      ['Address', d.serviceAddress],
      price !== null ? ['Service price', formatMoney(price, currency)] : null,
      paid > 0 ? ['Deposit paid', formatMoney(paid, currency)] : null,
      depositDue > 0 ? ['Deposit due now', formatMoney(depositDue, currency)] : null,
    ]),
    balance !== null ? totalRow('Balance due on the day', formatMoney(balance, currency)) : '',
    depositDue > 0 && d.depositLinkUrl
      ? button(d.depositLinkUrl, `Pay ${formatMoney(depositDue, currency)} deposit with ${d.depositLinkLabel ?? 'the payment link'}`)
      : '',
    replyTo ? button(`mailto:${replyTo}`, c.contactButton(business), depositDue > 0 ? 'secondary' : 'primary') : '',
    d.groomerPhone ? `<div style="margin-top:12px;">${paragraph(contactLinks(d.groomerPhone), true)}</div>` : '',
    d.petCardUrl ? button(d.petCardUrl, c.petCardButton, 'secondary') : '',
    `<div style="margin-top:20px;">${paragraph(escapeHtml(c.trackingLine), true)}${paragraph(escapeHtml(c.cancelLine(business)), true)}</div>`,
  ].join('');

  return deliver('client confirmation', {
    from: fromHeader(business),
    to,
    replyTo,
    subject: c.subject(business, d.date),
    html: layout({ brand: business, heading: c.heading, body, preheader: `${d.date} at ${d.time}`, footer: EMAIL_COPY.footer(business) }),
  });
}

// ---------------------------------------------------------------------------
// New-booking notice (groomer)
// ---------------------------------------------------------------------------

export interface GroomerNotificationDetails {
  /** The groomer's own email. Without it nothing is sent. */
  to?: string;
  businessName?: string;
  date: string;
  time: string;
  services: string[];
  serviceAddress: string;
  clientName: string;
  clientPhone: string;
  /** Client email: Reply-To, so the groomer can answer straight away. */
  clientEmail?: string;
  petName: string;
  petBreed: string;
  petSize: string;
  specialNotes?: string;
  /** Link to the appointment in the portal. */
  appointmentUrl?: string;
}

export async function sendGroomerNotificationEmail(d: GroomerNotificationDetails): Promise<boolean> {
  const g = EMAIL_COPY.groomerNotice;
  const body = [
    paragraph(escapeHtml(g.intro)),
    detailRows([
      ['When', `${d.date}, ${d.time}`],
      ['Service', d.services.join(', ') || 'Grooming'],
      ['Pet', `${d.petName} (${d.petBreed}, ${d.petSize})`],
      ['Client', d.clientName],
      ['Phone', d.clientPhone],
      ['Address', d.serviceAddress],
      d.specialNotes?.trim() ? ['Notes', d.specialNotes.trim()] : null,
    ]),
    d.appointmentUrl ? button(d.appointmentUrl, 'Open appointment') : '',
  ].join('');
  return deliver('groomer notification', {
    from: fromHeader(null),
    to: d.to,
    replyTo: d.clientEmail,
    subject: g.subject(d.petName, d.date),
    html: layout({ brand: d.businessName?.trim() || EMAIL_COPY.platformName, heading: g.heading, body }),
  });
}

// ---------------------------------------------------------------------------
// Platform emails (from "Pawxis")
// ---------------------------------------------------------------------------

export interface TrialEndingDetails {
  trialEndsOn: string;
  billingUrl: string;
}

export async function sendTrialEndingEmail(to: string, d: TrialEndingDetails): Promise<boolean> {
  const body = [
    paragraph(`Your Pawxis Pro trial ends on <strong>${escapeHtml(d.trialEndsOn)}</strong>. Choose a plan to keep Order Radar, Fill My Day, live ETA and the rest of Pro without a break.`),
    paragraph('Nothing is charged until you choose a plan.', true),
    button(d.billingUrl, 'Choose your plan'),
  ].join('');
  return deliver('trial-ending', {
    from: fromHeader(null),
    to,
    subject: `Your Pawxis trial ends ${d.trialEndsOn}`,
    html: layout({ brand: 'Pawxis', heading: 'Your trial ends soon', body }),
  });
}

export async function sendEmailVerification(to: string, link: string): Promise<boolean> {
  const body = [
    paragraph('Confirm your email address to finish setting up your Pawxis account.'),
    button(link, 'Verify my email'),
    `<div style="margin-top:18px;">${paragraph("This link expires shortly. If you didn't sign up for Pawxis, you can ignore this email.", true)}</div>`,
  ].join('');
  return deliver('email verification', {
    from: fromHeader(null),
    to,
    subject: 'Verify your email for Pawxis',
    html: layout({ brand: 'Pawxis', heading: 'Confirm your email', body }),
  });
}

export async function sendWaitlistNotification(signupEmail: string): Promise<boolean> {
  const to = process.env.BUSINESS_EMAIL;
  if (!signupEmail) return false;
  const body = [
    paragraph('A new visitor joined the Pawxis early-access waitlist.'),
    paragraph(`<strong>${escapeHtml(signupEmail)}</strong>`),
    paragraph('Captured from the coming-soon page.', true),
  ].join('');
  return deliver('waitlist notification', {
    from: fromHeader(null),
    to,
    replyTo: signupEmail,
    subject: `New waitlist signup: ${signupEmail}`,
    html: layout({ brand: 'Pawxis', heading: 'New early-access signup', body }),
  });
}

// ---------------------------------------------------------------------------
// Client emails sent as the groomer
// ---------------------------------------------------------------------------

export interface OnTheWayDetails {
  businessName: string;
  petName?: string;
  trackUrl: string;
  etaMinutes?: number | null;
  /** Groomer's email for Reply-To. */
  replyTo?: string;
  groomerPhone?: string;
}

export async function sendOnTheWayEmail(to: string, d: OnTheWayDetails): Promise<boolean> {
  const business = d.businessName?.trim() || 'Your groomer';
  const forPet = d.petName?.trim() ? ` for ${escapeHtml(d.petName.trim())}` : '';
  const body = [
    paragraph(`${escapeHtml(business)} is heading to you${forPet}.`),
    typeof d.etaMinutes === 'number' && d.etaMinutes >= 0 ? paragraph(`Estimated arrival: about ${Math.round(d.etaMinutes)} min.`) : '',
    button(d.trackUrl, 'Track live'),
    d.groomerPhone ? `<div style="margin-top:12px;">${paragraph(contactLinks(d.groomerPhone), true)}</div>` : '',
    `<div style="margin-top:18px;">${paragraph('The live link updates as your groomer travels and stops once they arrive.', true)}</div>`,
  ].join('');
  return deliver('on-the-way', {
    from: fromHeader(business),
    to,
    replyTo: d.replyTo,
    subject: `${business} is on the way`,
    html: layout({ brand: business, heading: 'Your groomer is on the way', body, footer: EMAIL_COPY.footer(business) }),
  });
}

export interface AppointmentReminderDetails {
  kind: '24h' | '2h';
  businessName: string;
  petName: string;
  date: string;
  time: string;
  serviceAddress?: string;
  groomerPhone?: string;
  /** Groomer's email for Reply-To. */
  replyTo?: string;
}

export async function sendAppointmentReminderEmail(to: string, d: AppointmentReminderDetails): Promise<boolean> {
  const business = d.businessName?.trim() || 'Your groomer';
  const pet = d.petName || 'your pet';
  const lead =
    d.kind === '24h'
      ? `A quick reminder: ${escapeHtml(pet)}&#39;s grooming with ${escapeHtml(business)} is tomorrow.`
      : `See you soon! ${escapeHtml(business)} is coming for ${escapeHtml(pet)} today.`;
  const body = [
    paragraph(lead),
    detailRows([
      ['Date', d.date],
      ['Time', d.time],
      ['Address', d.serviceAddress ?? ''],
    ]),
    d.groomerPhone ? `<div style="margin-top:16px;">${paragraph(`Need to change it? ${contactLinks(d.groomerPhone)}`, true)}</div>` : '',
    `<div style="margin-top:8px;">${paragraph(escapeHtml(EMAIL_COPY.replyHint(business)), true)}</div>`,
  ].join('');
  return deliver('reminder', {
    from: fromHeader(business),
    to,
    replyTo: d.replyTo,
    subject: d.kind === '24h' ? `Reminder: ${pet}'s grooming on ${d.date} at ${d.time}` : `Today at ${d.time}: ${pet}'s grooming`,
    html: layout({ brand: business, heading: d.kind === '24h' ? 'Appointment tomorrow' : 'See you soon', body, footer: EMAIL_COPY.footer(business) }),
  });
}

export interface ClientMessageDetails {
  businessName: string;
  body: string;
  /** Groomer's email, so the client's reply goes straight to them. */
  replyTo?: string;
  groomerPhone?: string;
}

export async function sendClientMessageEmail(to: string, d: ClientMessageDetails): Promise<boolean> {
  const business = d.businessName?.trim() || 'Your groomer';
  const body = [
    `<p style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#1f2a37;white-space:pre-wrap;">${escapeHtml(d.body)}</p>`,
    `<div style="margin-top:18px;">${paragraph(escapeHtml(EMAIL_COPY.replyHint(business)), true)}</div>`,
    d.groomerPhone ? paragraph(contactLinks(d.groomerPhone), true) : '',
  ].join('');
  return deliver('client message', {
    from: fromHeader(business),
    to,
    replyTo: d.replyTo,
    subject: `Message from ${business}`,
    html: layout({ brand: business, heading: `A message from ${business}`, body, footer: EMAIL_COPY.footer(business) }),
  });
}
