/**
 * Read-only iCalendar feed (GET /api/ics/{feedToken}.ics).
 *
 * A groomer subscribes to this URL in Apple/Google/Outlook to mirror their
 * upcoming PawPort appointments into their personal calendar (Master Spec
 * §9.6). Access is by the long random `icsFeedToken` stored on the profile —
 * possession of the token is the only credential, so it must be unguessable and
 * regenerable (see `actions/calendar-feed.ts`).
 *
 * The `[token]` param may arrive with or without a trailing `.ics` (calendar
 * clients often append it), so we strip a single trailing `.ics` before
 * matching. No match → 404. On match we load the groomer's upcoming events and
 * emit an RFC 5545 document with a 5-minute cache window.
 *
 * Node runtime (Mongoose) and never statically cached (the calendar changes).
 *
 * _Master Spec: §9.6, §16_
 */
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { buildIcs, loadGroomerIcsEvents } from '@/lib/calendar/ics';

// Mongoose needs Node APIs; the Edge runtime lacks them.
export const runtime = 'nodejs';
// The feed reflects live appointment data; do not statically cache the route.
export const dynamic = 'force-dynamic';

/** Strip a single trailing `.ics` suffix (case-insensitive) if present. */
function normaliseToken(raw: string): string {
  return raw.replace(/\.ics$/i, '');
}

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
): Promise<Response> {
  const token = normaliseToken(params.token ?? '');
  if (!token) {
    return new Response('Not found', { status: 404 });
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ icsFeedToken: token })
      .select('userId businessName')
      .lean();

    if (!profile) {
      return new Response('Not found', { status: 404 });
    }

    const groomerId = String(profile.userId);
    const calName =
      (typeof profile.businessName === 'string' && profile.businessName.trim()) ||
      'PawPort Appointments';

    const events = await loadGroomerIcsEvents(groomerId);
    const ics = buildIcs(events, calName);

    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `inline; filename="pawport-${token}.ics"`,
        'Cache-Control': 'max-age=300',
      },
    });
  } catch (err) {
    console.error('GET /api/ics/[token] failed:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
