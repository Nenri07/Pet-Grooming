/**
 * Order Radar feed for the portal dashboard (Master Spec §10.5 step 3–4).
 *
 * GET, auth-scoped to the signed-in groomer. Returns the latest pending /
 * upcoming appointment(s) with their `routeMeta` formatted for the Order Radar
 * card:
 *   "New booking · {fromPrevKm} km from your {prevTime} stop · +{extraDriveMin}
 *    min driving · {label}"
 *
 * When an appointment has no `routeMeta` (e.g. the client's location was
 * unknown at commit time), it is still returned — just without routing text.
 *
 * NOTE (SWR wiring is a later phase): the dashboard is intended to poll this
 * endpoint every ~15s (`ROUTING.radarPollSeconds`). This route only provides
 * the data; the client-side SWR hook lands in a follow-up phase.
 *
 * _Master Spec: §10.5_
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { labelForScore } from '@/lib/routing';

// Mongoose needs Node APIs; the Edge runtime lacks them.
export const runtime = 'nodejs';
// The radar reflects live appointment data and must never be cached.
export const dynamic = 'force-dynamic';

/** How many upcoming appointments the card shows at once. */
const RADAR_LIMIT = 5;

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { connectDB } = await import('@/lib/db/connect');
    const { Appointment } = await import('@/lib/db/models/appointment');
    const { Client } = await import('@/lib/db/models/client');
    const { Pet } = await import('@/lib/db/models/pet');

    await connectDB();

    const groomerId = session.user.id;
    const now = new Date();

    // Latest pending/upcoming appointments (most imminent first).
    const appts = await Appointment.find({
      groomerId,
      status: { $in: ['upcoming', 'in-progress'] },
      scheduledEndDate: { $gte: now },
    })
      .sort({ scheduledDate: 1 })
      .limit(RADAR_LIMIT)
      .lean();

    // Resolve prev-stop times (for "from your {prevTime} stop") and names.
    const prevIds = appts
      .map((a) => a.routeMeta?.prevId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id))
      .map((id) => String(id));

    const prevAppts = prevIds.length
      ? await Appointment.find({ _id: { $in: prevIds } })
          .select({ scheduledDate: 1 })
          .lean()
      : [];
    const prevTimeById = new Map<string, Date>(
      prevAppts.map((p) => [String(p._id), new Date(p.scheduledDate)])
    );

    const clientIds = appts.map((a) => a.clientId).filter(Boolean);
    const petIds = appts.map((a) => a.petId).filter(Boolean);
    const [clients, pets] = await Promise.all([
      Client.find({ _id: { $in: clientIds } }).select({ name: 1 }).lean(),
      Pet.find({ _id: { $in: petIds } }).select({ name: 1 }).lean(),
    ]);
    const clientNameById = new Map(clients.map((c) => [String(c._id), c.name]));
    const petNameById = new Map(pets.map((p) => [String(p._id), (p as { name?: string }).name]));

    const fmtTime = (d: Date) =>
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const items = appts.map((a) => {
      const rm = a.routeMeta;
      const prevTime =
        rm?.prevId != null ? prevTimeById.get(String(rm.prevId)) ?? null : null;

      const hasRouting =
        rm != null && typeof rm.extraDriveMin === 'number' && typeof rm.fromPrevKm === 'number';

      const label = hasRouting
        ? labelForScore(rm.score ?? 0, rm.extraDriveMin as number)
        : null;

      return {
        appointmentId: String(a._id),
        status: a.status,
        scheduledDate: new Date(a.scheduledDate).toISOString(),
        scheduledEndDate: new Date(a.scheduledEndDate).toISOString(),
        clientName: clientNameById.get(String(a.clientId)) ?? null,
        petName: petNameById.get(String(a.petId)) ?? null,
        serviceAddress: a.serviceAddress ?? null,
        // Routing block — null-ish fields when routeMeta is absent.
        fromPrevKm: hasRouting ? (rm!.fromPrevKm as number) : null,
        extraDriveMin: hasRouting ? (rm!.extraDriveMin as number) : null,
        prevTime: prevTime ? fmtTime(prevTime) : null,
        score: rm?.score ?? null,
        label,
        // Pre-formatted card text (§10.5) — null when no routing data.
        radarText:
          hasRouting && prevTime
            ? `New booking · ${rm!.fromPrevKm} km from your ${fmtTime(prevTime)} stop · +${rm!.extraDriveMin} min driving${label ? ` · ${label}` : ''}`
            : null,
      };
    });

    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error('GET /api/portal/radar failed:', err);
    return NextResponse.json({ error: 'radar_failed' }, { status: 500 });
  }
}
