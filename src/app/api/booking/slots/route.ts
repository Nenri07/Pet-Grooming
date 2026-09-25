/**
 * Public slot-availability endpoint (GET /api/booking/slots).
 *
 * Returns the bookable time slots for a groomer on a given day, computed by the
 * native calendar engine (`lib/calendar/slots.ts`) which composes recurring
 * availability windows, existing appointments, manual blocks, and live Redis
 * holds, then caches the result for 60 s.
 *
 * Query params:
 *   - groomerSlug OR groomerId  — the groomer to compute slots for (one required).
 *   - date=yyyy-mm-dd           — the day to generate slots for (required).
 *   - serviceId (optional)      — resolves the service duration; falls back to
 *                                 the groomer's first active service.
 *
 * Rate-limited with the booking limiter keyed by `slots:{ip}` (30/min/IP). The
 * limiter fails OPEN — a rate-limit outage or unconfigured Redis never blocks
 * legitimate availability reads.
 *
 * Node runtime (Mongoose + Redis) and never cached (holds are live).
 *
 * _Master Spec: §9.3, §16_
 */
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Service } from '@/lib/db/models/service';
import { getSlotsForDate } from '@/lib/calendar/slots';
import { getGeocodeProvider, type LatLng } from '@/lib/routing';
import { bookingRateLimit, checkRateLimit } from '@/lib/ratelimit';

// Mongoose + Redis need Node APIs; the Edge runtime lacks them.
export const runtime = 'nodejs';
// Availability depends on live holds/appointments, so never cache the route.
export const dynamic = 'force-dynamic';

/** yyyy-mm-dd shape guard so a malformed date can't reach the day-bounds math. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Best-effort client IP for rate-limit keying (proxy headers, else "unknown"). */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Resolve the groomer's `userId` from either an explicit `groomerId` or a public
 * `groomerSlug`. Returns null when neither resolves to a profile.
 */
async function resolveGroomerId(
  groomerId: string | null,
  groomerSlug: string | null
): Promise<string | null> {
  if (groomerId) {
    const byId = await GroomerProfile.findOne({ userId: groomerId }).select('userId').lean();
    if (byId) return String(byId.userId);
    return null;
  }
  if (groomerSlug) {
    const bySlug = await GroomerProfile.findOne({ groomerSlug }).select('userId').lean();
    if (bySlug) return String(bySlug.userId);
  }
  return null;
}

export async function GET(req: Request): Promise<Response> {
  // Rate-limit first (fail open) so abusive polling can't hammer the engine.
  const rl = await checkRateLimit(bookingRateLimit(), `slots:${clientIp(req)}`);
  if (!rl.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const url = new URL(req.url);
  const groomerId = url.searchParams.get('groomerId');
  const groomerSlug = url.searchParams.get('groomerSlug');
  const date = url.searchParams.get('date');
  const serviceId = url.searchParams.get('serviceId');
  // Optional Order Radar inputs (§10.5): explicit coords, or an address to
  // geocode. When neither resolves, routing is a pass-through (all slots pass).
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');
  const addressParam = url.searchParams.get('address');

  if (!groomerId && !groomerSlug) {
    return NextResponse.json({ error: 'missing_groomer' }, { status: 400 });
  }
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }

  try {
    await connectDB();

    const resolvedGroomerId = await resolveGroomerId(groomerId, groomerSlug);
    if (!resolvedGroomerId) {
      return NextResponse.json({ error: 'groomer_not_found' }, { status: 404 });
    }

    // Resolve the service duration: explicit service id when given (scoped to the
    // groomer), else the groomer's first active service.
    const service = serviceId
      ? await Service.findOne({ _id: serviceId, groomerId: resolvedGroomerId })
          .select('durationMinutes')
          .lean()
      : await Service.findOne({ groomerId: resolvedGroomerId, isActive: true })
          .select('durationMinutes')
          .sort({ createdAt: 1 })
          .lean();

    if (!service) {
      return NextResponse.json({ error: 'no_service' }, { status: 404 });
    }

    // Resolve the client's location for routing, if any was supplied. Explicit
    // lat/lng wins; otherwise try to geocode the address (returns null today,
    // so routing stays a pass-through until a geocoder is configured).
    let clientLoc: LatLng | null = null;
    const lat = latParam != null ? Number(latParam) : NaN;
    const lng = lngParam != null ? Number(lngParam) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      clientLoc = { lat, lng };
    } else if (addressParam) {
      clientLoc = await getGeocodeProvider().geocode(addressParam).catch(() => null);
    }

    const slots = await getSlotsForDate(
      resolvedGroomerId,
      date,
      service.durationMinutes,
      new Date(),
      { clientLoc, view: 'client' }
    );

    // Serialise Dates to ISO for JSON transport. Routing annotations are
    // included when present (undefined when the client's location is unknown).
    return NextResponse.json({
      groomerId: resolvedGroomerId,
      date,
      serviceDurationMinutes: service.durationMinutes,
      routed: clientLoc != null,
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        available: s.available,
        score: s.score,
        label: s.label,
        extraDriveMin: s.extraDriveMin,
        fromPrevKm: s.fromPrevKm,
      })),
    });
  } catch (err) {
    console.error('GET /api/booking/slots failed:', err);
    return NextResponse.json({ error: 'slots_failed' }, { status: 500 });
  }
}
