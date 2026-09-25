/**
 * SMS provider interface + factory (Master Spec §4.5, §12.1).
 *
 * Every third party sits behind an interface so it can be swapped
 * (Telnyx/Vonage could replace Twilio). Nothing here imports the Twilio SDK at
 * module scope — the concrete {@link TwilioProvider} is loaded lazily by
 * {@link getSmsProvider} only when the env is configured, so importing this
 * module NEVER throws and the whole app builds and runs without Twilio
 * credentials.
 *
 * When Twilio is not configured, {@link getSmsProvider} returns a
 * {@link NoopSmsProvider} that logs the intended message and returns a
 * synthetic id with status `"skipped"`. Callers therefore never need to branch
 * on configuration — they always get a working provider.
 *
 * _Master Spec: §4.5, §12.1_
 */
import { TwilioProvider } from './twilio';

/**
 * The kinds of SMS PawPort sends (Master Spec §12.2). The union is the single
 * source of truth used by templates, quota classification, quiet-hours and
 * consent gating.
 */
export type SmsKind =
  | 'booking_confirmed'
  | 'reminder_24h'
  | 'reminder_2h'
  | 'on_my_way'
  | 'running_late'
  | 'rescheduled'
  | 'cancelled'
  | 'fill_my_day_offer'
  | 'rebook_nudge'
  | 'review_request'
  | 'deposit_receipt'
  // Inbound / freeform groomer reply (Inbox). Treated as transactional so a
  // groomer can always answer a client who texted them.
  | 'reply';

/** Every valid {@link SmsKind}, handy for validation and tests. */
export const SMS_KINDS: readonly SmsKind[] = [
  'booking_confirmed',
  'reminder_24h',
  'reminder_2h',
  'on_my_way',
  'running_late',
  'rescheduled',
  'cancelled',
  'fill_my_day_offer',
  'rebook_nudge',
  'review_request',
  'deposit_receipt',
  'reply',
] as const;

/** Arguments accepted by {@link SmsProvider.send}. */
export interface SmsSendParams {
  /** Destination phone number (E.164 preferred, e.g. `+15555550123`). */
  to: string;
  /** Fully-rendered message body. */
  body: string;
  /** The groomer this message is sent on behalf of (for logging/segmentation). */
  groomerId: string;
  /** The message kind. */
  kind: SmsKind;
  /** Optional free-form metadata (appointmentId, clientId, etc.). */
  meta?: Record<string, unknown>;
}

/** Result of a send attempt. */
export interface SmsSendResult {
  /** Provider message id (Twilio SID) or a synthetic id for the no-op. */
  id: string;
  /** Provider status (`queued`/`sent`/... for Twilio, `skipped` for no-op). */
  status: string;
}

/**
 * The messaging seam. `TwilioProvider` implements this using a Messaging
 * Service SID; a `NoopSmsProvider` implements it as a log-only fallback.
 *
 * _Master Spec: §4.5, §12.1_
 */
export interface SmsProvider {
  send(params: SmsSendParams): Promise<SmsSendResult>;
}

/**
 * Whether Twilio is configured. Requires the account SID, auth token, and a
 * Messaging Service SID (Master Spec §12.1). Callers that need to render a
 * "SMS not configured" state (e.g. the Inbox) branch on this.
 */
export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_MESSAGING_SERVICE_SID
  );
}

/**
 * A log-only SMS provider used when Twilio is not configured. It never sends a
 * real message; it logs the intent and returns a synthetic id with status
 * `"skipped"` so the orchestrator can still record a {@link SmsMessage} row and
 * the app degrades gracefully with zero credentials.
 */
export class NoopSmsProvider implements SmsProvider {
  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const preview = params.body.length > 60 ? `${params.body.slice(0, 60)}…` : params.body;
    console.info(
      `[sms:noop] would send kind=${params.kind} to=${maskPhone(params.to)} groomer=${params.groomerId} body="${preview}"`
    );
    return { id: `noop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, status: 'skipped' };
  }
}

/** Mask a phone number for safe logging (keep last 4 digits). */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}

// Cached instances so we don't rebuild a Twilio client on every send.
let _cachedProvider: SmsProvider | undefined;

/**
 * Return the active SMS provider.
 *
 * - Twilio configured → a {@link TwilioProvider} (loaded lazily so its SDK is
 *   never imported when unconfigured).
 * - Otherwise → a {@link NoopSmsProvider} that logs and returns `skipped`.
 *
 * Never throws. The instance is cached; call {@link resetSmsProvider} in tests
 * if the env changes between cases.
 */
export function getSmsProvider(): SmsProvider {
  if (_cachedProvider) return _cachedProvider;

  if (isSmsConfigured()) {
    try {
      _cachedProvider = new TwilioProvider();
      return _cachedProvider;
    } catch (err) {
      console.error('[sms] Failed to initialise Twilio provider, falling back to no-op:', err);
      _cachedProvider = new NoopSmsProvider();
      return _cachedProvider;
    }
  }

  _cachedProvider = new NoopSmsProvider();
  return _cachedProvider;
}

/** Clear the cached provider (used by tests that toggle env between cases). */
export function resetSmsProvider(): void {
  _cachedProvider = undefined;
}
