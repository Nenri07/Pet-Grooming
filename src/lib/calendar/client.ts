/**
 * Google Calendar client (service-account model).
 *
 * LOCKED DECISION: PawPort uses a SINGLE shared Google Calendar accessed via a
 * service account, rather than per-groomer OAuth. Every booking is written to
 * the one calendar identified by `GOOGLE_CALENDAR_ID`, and availability reads
 * busy blocks from that same calendar. This keeps the integration credential-
 * simple (no per-user OAuth token storage / refresh) at the cost of a shared
 * calendar surface.
 *
 * Configuration (all read from the environment):
 *   - GOOGLE_SERVICE_ACCOUNT_JSON  Full service-account key JSON (the file
 *                                  contents, not a path). The `private_key`
 *                                  field commonly arrives with literal "\n"
 *                                  sequences instead of real newlines when
 *                                  pasted into a `.env`, so we normalise those.
 *   - GOOGLE_CALENDAR_ID           The id of the shared calendar to read/write.
 *
 * Resilience contract: NOTHING in this module throws for a missing or
 * malformed configuration. `isCalendarConfigured()` is the guard callers use
 * to decide whether to attempt a call; `getCalendarClient()` returns `null`
 * when the integration cannot be built. Booking and status-change flows must
 * therefore treat calendar work as strictly best-effort.
 *
 * _Requirements: 14.2_
 */
import { google, type calendar_v3 } from 'googleapis';

/** The OAuth scope required to read and write calendar events. */
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

/** Minimal shape of the fields we require from a service-account key JSON. */
interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

/**
 * Parse and validate `GOOGLE_SERVICE_ACCOUNT_JSON`.
 *
 * Returns `null` (never throws) when the variable is absent, is not valid
 * JSON, or is missing the `client_email` / `private_key` fields. Literal "\n"
 * escape sequences in `private_key` are converted to real newlines so keys
 * pasted into a single-line `.env` value work correctly.
 */
function parseServiceAccount(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(
      'Google Calendar: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON; calendar integration disabled.'
    );
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const clientEmail = obj.client_email;
  const privateKey = obj.private_key;
  if (typeof clientEmail !== 'string' || clientEmail.length === 0) return null;
  if (typeof privateKey !== 'string' || privateKey.length === 0) return null;

  return {
    client_email: clientEmail,
    // Normalise escaped newlines that survive .env round-tripping.
    private_key: privateKey.replace(/\\n/g, '\n'),
  };
}

/**
 * True when the calendar integration is fully configured: a parseable
 * service-account key AND a target calendar id are both present.
 *
 * Callers SHOULD gate on this before attempting any calendar work so a missing
 * configuration degrades to a silent no-op rather than an error.
 */
export function isCalendarConfigured(): boolean {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId || calendarId.trim().length === 0) return false;
  return parseServiceAccount() !== null;
}

/**
 * The configured shared calendar id, or `null` when unset. Provided so callers
 * do not need to re-read the environment variable name in multiple places.
 */
export function getSharedCalendarId(): string | null {
  const id = process.env.GOOGLE_CALENDAR_ID;
  return id && id.trim().length > 0 ? id : null;
}

/**
 * Build an authenticated Google Calendar v3 client using the service account.
 *
 * Returns `null` (never throws) when the integration is not configured or the
 * client cannot be constructed, so callers can no-op gracefully.
 */
export function getCalendarClient(): calendar_v3.Calendar | null {
  const credentials = parseServiceAccount();
  if (!credentials) return null;

  try {
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [CALENDAR_SCOPE],
    });

    return google.calendar({ version: 'v3', auth });
  } catch (err) {
    console.error('Google Calendar: failed to construct client:', err);
    return null;
  }
}
