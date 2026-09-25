/**
 * SMS message templates (Master Spec §12.2) — PURE.
 *
 * Every message is prefixed with the business name. Templates use the
 * variables `{pet} {date} {time} {business} {link}`. {@link renderTemplate} is a
 * pure function: no I/O, no env reads, deterministic output — so it is trivial
 * to unit-test.
 *
 * Custom per-groomer templates (Pro) are a documented SEAM: {@link renderTemplate}
 * accepts an optional `customTemplates` map and falls back to the Solo defaults
 * for any kind not overridden. Wiring the Pro editor + storage is a follow-up
 * (see GroomerProfile.smsTemplates in Master Spec §14); nothing here depends on
 * it.
 *
 * _Master Spec: §12.2_
 */
import type { SmsKind } from './provider';

/** The variables interpolable into a template. All optional; missing → ''. */
export interface TemplateVars {
  /** Pet's name. */
  pet?: string;
  /** Human-readable date, e.g. "Mon, Jun 3". */
  date?: string;
  /** Human-readable time, e.g. "10:00 AM". */
  time?: string;
  /** Business / groomer display name (also used as the message prefix). */
  business?: string;
  /** A short link (tracking, claim, rebook, review, etc.). */
  link?: string;
}

/**
 * Default (Solo) template bodies keyed by kind. The `{business}` prefix is
 * added by {@link renderTemplate}, so these bodies are the part AFTER the
 * business name. `reply` has no default body (the groomer supplies it).
 */
export const DEFAULT_TEMPLATES: Record<SmsKind, string> = {
  booking_confirmed:
    "You're booked for {pet} on {date} at {time}. Reply STOP to opt out.",
  reminder_24h:
    'Reminder: {pet}\u2019s grooming is tomorrow {date} at {time}. Reply C to confirm.',
  reminder_2h: 'See you soon! {pet}\u2019s appointment is today at {time}.',
  on_my_way: "We're on the way to {pet}! Track arrival: {link}",
  running_late:
    'Running a little behind for {pet}\u2019s {time} appointment. Thanks for your patience.',
  rescheduled:
    "{pet}\u2019s appointment has been moved to {date} at {time}. See you then!",
  cancelled:
    "{pet}\u2019s appointment on {date} at {time} has been cancelled. Reply to rebook.",
  fill_my_day_offer:
    'A spot just opened for {pet} on {date} at {time}. First to claim it wins: {link}',
  rebook_nudge:
    "It's about time for {pet}\u2019s next groom. Book your spot: {link}",
  review_request:
    'Thanks for choosing us for {pet}! We\u2019d love your feedback: {link}',
  deposit_receipt:
    'Deposit received for {pet}\u2019s appointment on {date} at {time}. Thank you!',
  reply: '{link}',
};

/** Escape a value for RegExp (defensive; keys are known, values are data). */
function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(pet|date|time|business|link)\}/g, (_m, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key];
    return value != null ? String(value) : '';
  });
}

/**
 * Render an SMS body for `kind`, interpolating `{pet}{date}{time}{business}{link}`
 * and prefixing the business name (Master Spec §12.2).
 *
 * Pure. `customTemplates` (Pro seam) overrides a kind's body when present;
 * anything not overridden falls back to {@link DEFAULT_TEMPLATES}. For the
 * `reply` kind the caller's own body should be passed via `vars.link` (or use
 * {@link renderReply}); its "template" is just the passthrough.
 *
 * The `{business}` prefix is applied unless the resolved body already begins
 * with the business name (so a custom template that includes its own prefix is
 * not doubled).
 */
export function renderTemplate(
  kind: SmsKind,
  vars: TemplateVars,
  customTemplates?: Partial<Record<SmsKind, string>>
): string {
  const raw = customTemplates?.[kind] ?? DEFAULT_TEMPLATES[kind];
  const business = (vars.business ?? '').trim();
  const bodyOnly = interpolate(raw, vars).trim();

  if (!business) return collapse(bodyOnly);
  if (bodyOnly.toLowerCase().startsWith(business.toLowerCase())) {
    return collapse(bodyOnly);
  }
  return collapse(`${business}: ${bodyOnly}`);
}

/**
 * Render a freeform groomer reply (Inbox). Prefixes the business name and
 * returns the body verbatim. Pure.
 */
export function renderReply(body: string, business?: string): string {
  const trimmed = body.trim();
  const b = (business ?? '').trim();
  if (!b) return collapse(trimmed);
  if (trimmed.toLowerCase().startsWith(b.toLowerCase())) return collapse(trimmed);
  return collapse(`${b}: ${trimmed}`);
}

/** Collapse repeated whitespace so interpolation gaps don't leave double spaces. */
function collapse(s: string): string {
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}
