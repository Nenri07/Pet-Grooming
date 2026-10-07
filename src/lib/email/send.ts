/**
 * Email sending for PawPort booking confirmations (Requirement 8).
 *
 * Sends two transactional emails after a booking is created:
 *   - {@link sendClientConfirmationEmail} — to the Client (Req 8.2)
 *   - {@link sendGroomerNotificationEmail} — to the Groomer (Req 8.3)
 *
 * Design constraints:
 *   - Best-effort only. Sends NEVER throw to the caller; they return a boolean
 *     `success`. A booking stays complete even if email delivery fails
 *     (Req 8.2, 8.6). The success page is shown regardless of the outcome.
 *   - Each send is retried up to 3 times (Req 8.5) via {@link withRetry}. If
 *     `src/lib/retry.ts` is added later (task 22.1) this module can be switched
 *     to it; until then a small local retry lives here.
 *   - Resend is initialised lazily and guarded: if `RESEND_API_KEY` is absent
 *     the functions no-op and log, so the app never crashes.
 *   - The `from` address uses `BUSINESS_EMAIL`; the display name uses
 *     `NEXT_PUBLIC_BUSINESS_NAME`.
 *
 * NOTE (Resend test limitation): until a sending domain is verified, Resend
 * only delivers to the account owner's email. That surfaces here as a failed
 * send, which is logged and swallowed rather than crashing the caller.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_
 */
import { Resend } from 'resend';

// ---------------------------------------------------------------------------
// Resend client (lazy + guarded)
// ---------------------------------------------------------------------------

let cachedResend: Resend | null | undefined;

/**
 * Return a Resend client, or `null` when no API key is configured. Cached so
 * repeated sends reuse the same instance. Never throws.
 */
function getResend(): Resend | null {
  if (cachedResend !== undefined) return cachedResend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      '[email] RESEND_API_KEY is not set — confirmation emails will be skipped.'
    );
    cachedResend = null;
    return cachedResend;
  }

  cachedResend = new Resend(apiKey);
  return cachedResend;
}

/**
 * Compose the `from` header. Uses the business display name from
 * `NEXT_PUBLIC_BUSINESS_NAME` and the address from `BUSINESS_EMAIL`.
 * Returns `null` if no business email is configured.
 */
function getFromAddress(): string | null {
  const email = process.env.BUSINESS_EMAIL;
  if (!email) {
    console.warn(
      '[email] BUSINESS_EMAIL is not set — confirmation emails will be skipped.'
    );
    return null;
  }
  const name = process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim();
  return name ? `${name} <${email}>` : email;
}

// ---------------------------------------------------------------------------
// Local retry (mirrors the planned lib/retry.ts withRetry contract, Req 8.5)
// ---------------------------------------------------------------------------

/**
 * Run `fn` up to `maxAttempts` times, backing off between attempts. Rethrows
 * the last error if every attempt fails. Kept local so this module has no hard
 * dependency on `src/lib/retry.ts` (which task 22.1 owns); the signature
 * matches so it can be swapped later.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Public details shapes
// ---------------------------------------------------------------------------

/** Details rendered into the Client confirmation email (Req 8.2). */
export interface ClientConfirmationDetails {
  /** Human-readable appointment date, e.g. "Monday, June 3, 2025". */
  date: string;
  /** Human-readable appointment time, e.g. "10:00 AM". */
  time: string;
  /** Selected service names. */
  services: string[];
  /** Full service address the groomer travels to. */
  serviceAddress: string;
  /** The groomer's business / display name. */
  groomerName: string;
  /** Deposit amount paid, in the transaction currency. */
  depositAmount: number;
  /** ISO currency code, defaults to "USD". */
  currency?: string;
}

/** Details rendered into the Groomer notification email (Req 8.3). */
export interface GroomerNotificationDetails {
  date: string;
  time: string;
  services: string[];
  serviceAddress: string;
  clientName: string;
  clientPhone: string;
  petName: string;
  petBreed: string;
  /** Pet size, e.g. "45 lbs" — free-form so callers can format weight+unit. */
  petSize: string;
  /** Any special handling notes; optional. */
  specialNotes?: string;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Escape a value for safe interpolation into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a monetary amount for display, e.g. `$50.00`. */
function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** A branded outer HTML shell shared by both templates. */
function emailShell(businessName: string, heading: string, body: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,Arial,sans-serif;color:#1f2937;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border-radius:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);overflow:hidden;">
        <div style="background:#5B9BD5;color:#ffffff;padding:20px 24px;">
          <h1 style="margin:0;font-size:18px;font-weight:600;">${escapeHtml(businessName)}</h1>
        </div>
        <div style="padding:24px;">
          <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;">${escapeHtml(heading)}</h2>
          ${body}
        </div>
      </div>
      <p style="text-align:center;color:#6b7280;font-size:12px;margin-top:16px;">
        Sent by ${escapeHtml(businessName)} via Pawxis
      </p>
    </div>
  </body>
</html>`;
}

/** Render a labelled detail row. */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7280;font-size:14px;vertical-align:top;width:140px;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:14px;font-weight:500;">${escapeHtml(value)}</td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

/**
 * Send the booking confirmation to the Client. Best-effort: returns `true` on
 * a successful send and `false` on any failure or missing configuration.
 * Never throws (Req 8.2, 8.6). Retries up to 3 times (Req 8.5).
 */
export async function sendClientConfirmationEmail(
  to: string,
  details: ClientConfirmationDetails
): Promise<boolean> {
  const resend = getResend();
  const from = getFromAddress();
  if (!resend || !from) return false;

  const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim() || details.groomerName;
  const currency = details.currency ?? 'USD';
  const servicesText = details.services.length ? details.services.join(', ') : '—';

  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      Your appointment with ${escapeHtml(details.groomerName)} is confirmed. Here are the details:
    </p>
    <table style="width:100%;border-collapse:collapse;">
      ${row('Date', details.date)}
      ${row('Time', details.time)}
      ${row('Services', servicesText)}
      ${row('Service address', details.serviceAddress)}
      ${row('Groomer', details.groomerName)}
      ${row('Deposit paid', formatMoney(details.depositAmount, currency))}
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      We look forward to seeing you and your pet. If you need to make changes,
      please contact ${escapeHtml(details.groomerName)} directly.
    </p>
    <p style="margin:12px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      On the day, you'll get a text and email with a live link to track your groomer's arrival.
    </p>`;

  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `Your booking with ${businessName} is confirmed`,
        html: emailShell(businessName, 'Booking confirmed', body),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send client confirmation email:', err);
    return false;
  }
}

/**
 * Send the new-booking notification to the Groomer's business inbox
 * (`BUSINESS_EMAIL`). Best-effort: returns `true`/`false`, never throws
 * (Req 8.2, 8.6). Retries up to 3 times (Req 8.5).
 */
export async function sendGroomerNotificationEmail(
  details: GroomerNotificationDetails
): Promise<boolean> {
  const resend = getResend();
  const from = getFromAddress();
  const to = process.env.BUSINESS_EMAIL;
  if (!resend || !from || !to) return false;

  const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim() || 'Pawxis';
  const servicesText = details.services.length ? details.services.join(', ') : '—';

  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      You have a new booking. Appointment and client details are below.
    </p>
    <table style="width:100%;border-collapse:collapse;">
      ${row('Date', details.date)}
      ${row('Time', details.time)}
      ${row('Services', servicesText)}
      ${row('Service address', details.serviceAddress)}
      ${row('Client', details.clientName)}
      ${row('Client phone', details.clientPhone)}
      ${row('Pet', details.petName)}
      ${row('Breed', details.petBreed)}
      ${row('Size', details.petSize)}
      ${row('Special notes', details.specialNotes?.trim() || 'None')}
    </table>`;

  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `New booking: ${details.petName} on ${details.date}`,
        html: emailShell(businessName, 'New booking received', body),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send groomer notification email:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Trial-ending reminder (Master Spec §13.2 — email 3 days before trial ends)
// ---------------------------------------------------------------------------

/** Details rendered into the trial-ending reminder email (§13.2). */
export interface TrialEndingDetails {
  /** Human-readable date the trial ends, e.g. "Monday, June 3". */
  trialEndsOn: string;
  /** Absolute URL to the billing page where they can subscribe. */
  billingUrl: string;
}

/**
 * Send the "your trial ends soon" reminder to a groomer (Master Spec §13.2 —
 * `customer.subscription.trial_will_end`, ~3 days before). Best-effort: never
 * throws, returns a boolean, and no-ops when Resend / the from address are not
 * configured, so a webhook can call it safely.
 *
 * @param to The groomer's email address.
 * @param details The trial-end date + billing link.
 */
export async function sendTrialEndingEmail(
  to: string,
  details: TrialEndingDetails
): Promise<boolean> {
  const resend = getResend();
  const from = getFromAddress();
  if (!resend || !from || !to) return false;

  const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim() || 'Pawxis';
  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      Your Pawxis Pro trial ends on <strong>${escapeHtml(details.trialEndsOn)}</strong>.
      Add a payment method to keep Order Radar, Fill My Day, live ETA, rebooking
      autopilot and the rest of Pro without interruption.
    </p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      Nothing is charged automatically until you choose a plan.
    </p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(details.billingUrl)}"
         style="display:inline-block;padding:12px 20px;border-radius:999px;background:#4338ca;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        Choose your plan
      </a>
    </p>`;

  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `Your Pawxis trial ends ${details.trialEndsOn}`,
        html: emailShell(businessName, 'Your trial ends soon', body),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send trial-ending email:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Email verification link (Billing/Trial-abuse R7.1 — tokened verify link)
// ---------------------------------------------------------------------------

/**
 * Send the email-verification link to a registrant (R7.1).
 *
 * Best-effort and guarded exactly like the other sends in this module: it
 * no-ops and returns `false` when Resend / the from address are not configured,
 * never throws, and retries up to 3 times. The caller (the
 * `requestEmailVerification` server action) treats a `false` return as a
 * dev-friendly degrade — the verification token is already stored, so the link
 * can still be surfaced another way — rather than an error.
 *
 * The `link` is a fully-qualified `${NEXT_PUBLIC_APP_URL}/verify-email?token=…`
 * URL built by the caller; it is only interpolated into an `href`, never echoed
 * as untrusted text.
 *
 * @param to The registrant's email address.
 * @param link The absolute verification URL carrying the one-time token.
 * @returns `true` on a successful send; `false` on any failure / missing config.
 */
export async function sendEmailVerification(to: string, link: string): Promise<boolean> {
  const resend = getResend();
  const from = getFromAddress();
  if (!resend || !from || !to) return false;

  const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim() || 'Pawxis';
  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      Please confirm your email address to continue setting up your
      ${escapeHtml(businessName)} account.
    </p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(link)}"
         style="display:inline-block;padding:12px 20px;border-radius:999px;background:#4338ca;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        Verify my email
      </a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      This link expires shortly for your security. If you didn't request this,
      you can safely ignore this email.
    </p>`;

  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `Verify your email for ${businessName}`,
        html: emailShell(businessName, 'Confirm your email', body),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send email-verification link:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// "On the way" tracker email (Master Spec §11.2 — companion to the SMS)
// ---------------------------------------------------------------------------

/** Details rendered into the "groomer is on the way" email (§11.2). */
export interface OnTheWayDetails {
  /** The groomer's business / display name. */
  businessName: string;
  /** The pet's name, when known. */
  petName?: string;
  /** Absolute `/t/{token}` tracker URL carrying the live-tracking token. */
  trackUrl: string;
  /** Estimated arrival in minutes, when computed; omitted/null when unknown. */
  etaMinutes?: number | null;
}

/**
 * Send the client the "your groomer is on the way" email with a live tracker
 * link (Master Spec §11.2). This is the email companion to the existing
 * "on my way" SMS; both are sent when the groomer taps "On my way".
 *
 * Best-effort and guarded exactly like the other sends in this module: it
 * no-ops and returns `false` when Resend / the from address are not configured,
 * never throws, and retries up to 3 times. The tracking caller treats this as
 * fire-and-forget — a `false` return (or any failure) never blocks the trip
 * start.
 *
 * The `trackUrl` is a fully-qualified `${NEXT_PUBLIC_APP_URL}/t/{token}` link
 * built by the caller via `trackLink`; it is only interpolated into an `href`,
 * never echoed as untrusted text.
 *
 * @param to The client's email address.
 * @param details Business name, optional pet name, tracker URL, optional ETA.
 * @returns `true` on a successful send; `false` on any failure / missing config.
 */
export async function sendOnTheWayEmail(
  to: string,
  details: OnTheWayDetails
): Promise<boolean> {
  const resend = getResend();
  const from = getFromAddress();
  if (!resend || !from || !to) return false;

  const businessName =
    process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim() || details.businessName?.trim() || 'Pawxis';
  const forPet = details.petName?.trim() ? ` for ${escapeHtml(details.petName.trim())}` : '';
  const etaLine =
    typeof details.etaMinutes === 'number' && details.etaMinutes >= 0
      ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#374151;">
          Estimated arrival: ~${Math.round(details.etaMinutes)} min
        </p>`
      : '';

  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      ${escapeHtml(businessName)} is heading to you${forPet}.
    </p>
    ${etaLine}
    <p style="margin:24px 0;">
      <a href="${escapeHtml(details.trackUrl)}"
         style="display:inline-block;padding:12px 20px;border-radius:999px;background:#5B9BD5;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
        Track live
      </a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      The live link updates as your groomer travels and stops working once they
      arrive.
    </p>`;

  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `Your groomer is on the way from ${businessName}`,
        html: emailShell(businessName, 'Your groomer is on the way', body),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send on-the-way email:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Waitlist / coming-soon signup notification
// ---------------------------------------------------------------------------

/**
 * Notify the business (BUSINESS_EMAIL) that someone joined the pre-launch
 * waitlist via the /coming-soon page. Best-effort and guarded exactly like the
 * other sends: no-ops and returns `false` when Resend / the from address /
 * BUSINESS_EMAIL are not configured, never throws, retries up to 3 times. The
 * waitlist signup itself is persisted independently, so a failed notification
 * never blocks the signup.
 *
 * @param signupEmail The visitor's email that was added to the waitlist.
 * @returns `true` on a successful send; `false` on any failure / missing config.
 */
export async function sendWaitlistNotification(signupEmail: string): Promise<boolean> {
  const resend = getResend();
  const from = getFromAddress();
  const to = process.env.BUSINESS_EMAIL;
  if (!resend || !from || !to || !signupEmail) return false;

  const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME?.trim() || 'Pawxis';
  const safeEmail = escapeHtml(signupEmail);
  const body = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">
      A new visitor joined the ${escapeHtml(businessName)} early-access waitlist.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;font-weight:600;color:#111827;">
      ${safeEmail}
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">
      Captured from the coming-soon page.
    </p>`;

  try {
    await withRetry(async () => {
      const { error } = await resend.emails.send({
        from,
        to,
        subject: `New waitlist signup: ${signupEmail}`,
        replyTo: signupEmail,
        html: emailShell(businessName, 'New early-access signup', body),
      });
      if (error) throw error;
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send waitlist notification:', err);
    return false;
  }
}
