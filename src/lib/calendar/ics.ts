/**
 * iCalendar (ICS) feed generation (Master Spec §9.6).
 *
 * Produces an RFC 5545 VCALENDAR/VEVENT document a groomer can subscribe to
 * (read-only) in Apple/Google/Outlook calendars. The pure {@link buildIcs}
 * function takes plain event data and needs no DB; {@link loadGroomerIcsEvents}
 * loads a groomer's upcoming appointments and maps them into that shape.
 *
 * The feed is served at `GET /api/ics/{feedToken}.ics` (route added later); the
 * long random `icsFeedToken` lives on the GroomerProfile.
 *
 * _Master Spec: §9.6_
 */

/** One calendar event in feed-ready form. */
export interface IcsEvent {
  /** Stable unique id (without the domain suffix). */
  uid: string;
  /** Event start. */
  start: Date;
  /** Event end. */
  end: Date;
  /** One-line title. */
  summary: string;
  /** Optional location (service address). */
  location?: string;
  /** Optional longer description (client, pet, services, notes). */
  description?: string;
}

/**
 * Format a Date as an RFC 5545 UTC timestamp: `YYYYMMDDTHHMMSSZ`.
 * PURE.
 */
export function formatIcsDate(date: Date): string {
  const iso = date.toISOString(); // 2025-01-31T09:30:00.000Z
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Escape a text value per RFC 5545 §3.3.11 (backslash, semicolon, comma,
 * newline). PURE.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Fold a content line to ≤ 75 octets per RFC 5545 §3.1, using CRLF + a single
 * leading space on continuation lines. Folding is byte-aware so multi-byte
 * UTF-8 characters are not split. PURE.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let first = true;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    // Continuation lines start with a space, so their budget is 74 octets.
    const limit = first ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      out.push(first ? current : ' ' + current);
      first = false;
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current) out.push(first ? current : ' ' + current);

  return out.join('\r\n');
}

/**
 * Build a complete, RFC 5545-compliant VCALENDAR string from events.
 *
 * Emits UID, DTSTAMP, DTSTART/DTEND (UTC Zulu), SUMMARY, and optional LOCATION
 * and DESCRIPTION, with proper escaping, line folding, and CRLF endings. PURE.
 *
 * @param events   Feed events.
 * @param calName  Calendar display name (X-WR-CALNAME).
 * @param dtstamp  Timestamp for DTSTAMP (injected for deterministic tests).
 */
export function buildIcs(events: IcsEvent[], calName: string, dtstamp: Date = new Date()): string {
  const stamp = formatIcsDate(dtstamp);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PawPort//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
  ];

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(ev.uid)}@pawport.app`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatIcsDate(ev.start)}`);
    lines.push(`DTEND:${formatIcsDate(ev.end)}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // Fold each line, then join with CRLF and terminate with a trailing CRLF.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * Load a groomer's upcoming (non-cancelled) appointments and map them to
 * {@link IcsEvent}s ready for {@link buildIcs}. DB-backed; imported lazily so
 * the pure helpers above stay DB-free for tests.
 */
export async function loadGroomerIcsEvents(groomerId: string): Promise<IcsEvent[]> {
  const { connectDB } = await import('@/lib/db/connect');
  const { Appointment } = await import('@/lib/db/models/appointment');

  await connectDB();

  const now = new Date();
  const appointments = await Appointment.find({
    groomerId,
    status: { $ne: 'cancelled' },
    scheduledEndDate: { $gte: now },
  })
    .populate('clientId', 'name')
    .populate('petId', 'name')
    .populate('serviceId', 'name')
    .lean();

  return appointments.map((a: Record<string, unknown>) => {
    const client = a.clientId as { name?: string } | null;
    const pet = a.petId as { name?: string } | null;
    const service = a.serviceId as { name?: string } | null;

    const summaryParts = [pet?.name, service?.name].filter(Boolean);
    const summary = summaryParts.length ? summaryParts.join(' — ') : 'Grooming appointment';

    const descParts = [
      client?.name ? `Client: ${client.name}` : null,
      pet?.name ? `Pet: ${pet.name}` : null,
      service?.name ? `Service: ${service.name}` : null,
      a.notes ? `Notes: ${a.notes as string}` : null,
    ].filter(Boolean) as string[];

    return {
      uid: String(a._id),
      start: new Date(a.scheduledDate as Date),
      end: new Date(a.scheduledEndDate as Date),
      summary,
      location: (a.serviceAddress as string | undefined) || undefined,
      description: descParts.join('\\n') || undefined,
    };
  });
}
