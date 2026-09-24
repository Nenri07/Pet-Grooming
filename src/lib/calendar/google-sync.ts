/**
 * Google Calendar sync (service-account, shared-calendar model).
 *
 * LOCKED DECISION: all bookings are written to a single shared calendar
 * (`GOOGLE_CALENDAR_ID`) via a service account (see `./client.ts`). This module
 * exposes the three operations the app needs against that calendar:
 *
 *   - createCalendarEventForAppointment — outbound: mirror a new booking as a
 *     calendar event and return its event id (persisted on the Appointment).
 *   - updateCalendarEventStatus         — outbound: reflect a status change by
 *     prefixing the event summary ([Completed]/[Cancelled]).
 *   - fetchBusyBlocks                   — inbound: read events in a window so
 *     availability can treat them as blocked time.
 *
 * RESILIENCE CONTRACT (Requirements 8.4, 12.3, 14.5): every function here is
 * best-effort. If the integration is not configured, or the Google API call
 * fails after retries, the function logs and returns a benign value (null /
 * false / []) — it NEVER throws. A calendar problem must never crash a booking
 * or a status change. All Google calls are wrapped in `withRetry` for up to 3
 * attempts (Requirement 14.5). Status updates target completion within 30s
 * (Requirement 12.3), which the bounded retry budget respects.
 *
 * _Requirements: 8.4, 12.3, 14.2, 14.3, 14.5_
 */
import type { calendar_v3 } from 'googleapis';
import { getCalendarClient, getSharedCalendarId, isCalendarConfigured } from './client';
import type { TimeBlock } from './availability';
import { withRetry } from '@/lib/retry';

/** Number of attempts for every outbound/inbound Google call (Req 14.5). */
const RETRY_ATTEMPTS = 3;
/** Delay between retry attempts, in milliseconds. */
const RETRY_DELAY_MS = 1000;

/** Status-prefix markers applied to an event summary on status change. */
const STATUS_PREFIXES: Record<string, string> = {
  completed: '[Completed] ',
  cancelled: '[Cancelled] ',
};
/** Every known prefix, used to strip a stale marker before applying a new one. */
const ALL_PREFIXES = ['[Completed] ', '[Cancelled] '];

/**
 * Details needed to create a calendar event mirroring an appointment.
 * The summary is assembled from `serviceName` + `petName`; the description
 * carries the human-facing client / pet / address context.
 */
export interface CreateCalendarEventInput {
  /** Name of the booked service (e.g. "Full Groom"). */
  serviceName: string;
  /** Name of the pet being groomed. */
  petName: string;
  /** Client name, shown in the event description. */
  clientName?: string;
  /** Client phone, shown in the event description. */
  clientPhone?: string;
  /** ISO-8601 start of the appointment. */
  startISO: string;
  /** ISO-8601 end of the appointment. */
  endISO: string;
  /** Service address; used as the event location and in the description. */
  location?: string;
  /** Optional extra notes appended to the description. */
  notes?: string;
}

/** Compose the event summary from the service + pet names. */
function buildSummary(serviceName: string, petName: string): string {
  const parts = [serviceName, petName].filter((p) => p && p.trim().length > 0);
  return parts.join(' — ') || 'Grooming appointment';
}

/** Compose the event description from the client / pet / address context. */
function buildDescription(input: CreateCalendarEventInput): string {
  const lines: string[] = [];
  if (input.clientName) lines.push(`Client: ${input.clientName}`);
  if (input.clientPhone) lines.push(`Phone: ${input.clientPhone}`);
  lines.push(`Pet: ${input.petName}`);
  lines.push(`Service: ${input.serviceName}`);
  if (input.location) lines.push(`Address: ${input.location}`);
  if (input.notes) lines.push(`Notes: ${input.notes}`);
  return lines.join('\n');
}

/**
 * Create a Google Calendar event mirroring an appointment.
 *
 * Best-effort: returns the created event id on success, or `null` when the
 * integration is unconfigured or the call fails after retries. NEVER throws
 * (Requirement 8.4).
 */
export async function createCalendarEventForAppointment(
  input: CreateCalendarEventInput
): Promise<string | null> {
  if (!isCalendarConfigured()) return null;
  const calendar = getCalendarClient();
  const calendarId = getSharedCalendarId();
  if (!calendar || !calendarId) return null;

  const requestBody: calendar_v3.Schema$Event = {
    summary: buildSummary(input.serviceName, input.petName),
    description: buildDescription(input),
    start: { dateTime: input.startISO },
    end: { dateTime: input.endISO },
    ...(input.location ? { location: input.location } : {}),
  };

  try {
    const eventId = await withRetry(
      async () => {
        const res = await calendar.events.insert({ calendarId, requestBody });
        const id = res.data.id;
        if (!id) throw new Error('Google Calendar insert returned no event id');
        return id;
      },
      RETRY_ATTEMPTS,
      RETRY_DELAY_MS
    );
    return eventId;
  } catch (err) {
    console.error('Google Calendar: createCalendarEventForAppointment failed:', err);
    return null;
  }
}

/**
 * Reflect an appointment status change on its calendar event by prefixing the
 * summary with a status marker ([Completed] / [Cancelled]). Other statuses are
 * a no-op (no prefix needed) and report success.
 *
 * Best-effort boolean: `true` when the event was patched (or no change was
 * needed), `false` when unconfigured or the call failed after retries. NEVER
 * throws. Targets completion within 30s via the bounded retry budget
 * (Requirement 12.3).
 */
export async function updateCalendarEventStatus(
  googleEventId: string | null | undefined,
  status: string
): Promise<boolean> {
  if (!googleEventId) return false;
  if (!isCalendarConfigured()) return false;
  const calendar = getCalendarClient();
  const calendarId = getSharedCalendarId();
  if (!calendar || !calendarId) return false;

  const prefix = STATUS_PREFIXES[status];
  // Statuses without a marker (e.g. upcoming / in-progress) need no summary
  // change — treat as a successful no-op.
  if (!prefix) return true;

  try {
    await withRetry(
      async () => {
        // Read the current summary so we can strip any stale marker before
        // applying the new one (keeps repeated transitions idempotent).
        const current = await calendar.events.get({ calendarId, eventId: googleEventId });
        let summary = current.data.summary ?? '';
        for (const p of ALL_PREFIXES) {
          if (summary.startsWith(p)) {
            summary = summary.slice(p.length);
            break;
          }
        }
        await calendar.events.patch({
          calendarId,
          eventId: googleEventId,
          requestBody: { summary: `${prefix}${summary}` },
        });
      },
      RETRY_ATTEMPTS,
      RETRY_DELAY_MS
    );
    return true;
  } catch (err) {
    console.error('Google Calendar: updateCalendarEventStatus failed:', err);
    return false;
  }
}

/**
 * Fetch busy time blocks from the shared calendar within [startDate, endDate].
 *
 * Maps every event with resolvable start/end times to a {@link TimeBlock}.
 * All-day events (which expose `date` rather than `dateTime`) are included
 * using their date boundaries. Cancelled events are skipped.
 *
 * Best-effort: returns `[]` when unconfigured or on failure after retries.
 * NEVER throws.
 */
export async function fetchBusyBlocks(startDate: Date, endDate: Date): Promise<TimeBlock[]> {
  if (!isCalendarConfigured()) return [];
  const calendar = getCalendarClient();
  const calendarId = getSharedCalendarId();
  if (!calendar || !calendarId) return [];

  try {
    const events = await withRetry(
      async () => {
        const res = await calendar.events.list({
          calendarId,
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 2500,
        });
        return res.data.items ?? [];
      },
      RETRY_ATTEMPTS,
      RETRY_DELAY_MS
    );

    const blocks: TimeBlock[] = [];
    for (const event of events) {
      if (event.status === 'cancelled') continue;
      const startStr = event.start?.dateTime ?? event.start?.date;
      const endStr = event.end?.dateTime ?? event.end?.date;
      if (!startStr || !endStr) continue;

      const start = new Date(startStr);
      const end = new Date(endStr);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      blocks.push({ start, end });
    }
    return blocks;
  } catch (err) {
    console.error('Google Calendar: fetchBusyBlocks failed:', err);
    return [];
  }
}
