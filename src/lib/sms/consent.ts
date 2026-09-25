/**
 * SMS consent gate + inbound keyword handling (Master Spec §12.3) — PURE.
 *
 * Rules:
 *   - Never send to an opted-out number (STOP).
 *   - Never send without recorded consent (`smsConsentAt`), EXCEPT a single
 *     transactional booking confirmation when the client provided their phone
 *     as a required contact (legal review noted in §12.4). We implement that
 *     exception narrowly: only `booking_confirmed` may go out without explicit
 *     consent; every other kind requires consent.
 *   - STOP / START / HELP inbound keywords toggle opt-out / opt-in / help.
 *
 * All functions here are PURE (no I/O). Loading the client's consent state and
 * persisting opt-out changes is the caller's job (orchestrator / webhook).
 *
 * _Master Spec: §12.3, §12.4_
 */
import type { SmsKind } from './provider';

/** The consent state we gate on (a projection of the Client record). */
export interface ConsentState {
  /** When the client consented to SMS, if ever (Master Spec §14). */
  consentAt?: Date | string | null;
  /** Whether the client has opted out via STOP. */
  optOut?: boolean | null;
}

/**
 * PURE: may this client receive a message of `kind`?
 *
 * - Opted-out numbers can never be messaged → `false`.
 * - With recorded consent → `true`.
 * - Without consent → only a single transactional `booking_confirmed` is
 *   allowed (the "required contact" exception, §12.3); everything else → `false`.
 */
export function mayReceive(kind: SmsKind, state: ConsentState): boolean {
  // Opt-out is absolute.
  if (state.optOut === true) return false;

  const hasConsent = Boolean(state.consentAt);
  if (hasConsent) return true;

  // No explicit consent: allow only the transactional booking confirmation.
  return kind === 'booking_confirmed';
}

/** The classification of an inbound message body. */
export type InboundIntent = 'stop' | 'start' | 'help' | 'reply';

/**
 * Standard carrier opt-out / opt-in / help keywords. Matching is
 * case-insensitive and tolerant of surrounding whitespace/punctuation.
 */
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_WORDS = new Set(['start', 'yes', 'unstop']);
const HELP_WORDS = new Set(['help', 'info']);

/**
 * PURE: classify an inbound SMS body into a STOP/START/HELP keyword or a normal
 * reply. Only a message whose FIRST token is a recognised keyword is treated as
 * a command (matching carrier behaviour); anything else is a `reply`.
 */
export function interpretInbound(body: string): InboundIntent {
  const firstToken = (body ?? '')
    .trim()
    .toLowerCase()
    // strip surrounding punctuation and take the first whitespace-delimited word
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)[0];

  if (!firstToken) return 'reply';
  if (STOP_WORDS.has(firstToken)) return 'stop';
  if (START_WORDS.has(firstToken)) return 'start';
  if (HELP_WORDS.has(firstToken)) return 'help';
  return 'reply';
}
