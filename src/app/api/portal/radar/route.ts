/**
 * Order Radar endpoint (GET /api/portal/radar) — Master Spec §10.5.
 *
 * Returns the groomer's latest upcoming bookings carrying route metadata
 * (distance / extra drive / best-fit label) for the dashboard's Order Radar
 * card, which polls this every ~15s (§10.5).
 *
 * PRO-GATED SERVER-SIDE (§13.1: "Never gate only in the UI"): this is an
 * `orderRadar` Pro feature, so we call `assertFeature(groomerId, 'orderRadar')`
 * and respond 403 when the groomer's plan lacks it or their subscription is
 * inactive. The UI hint on the dashboard is advisory; THIS gate is authoritative.
 *
 * _Master Spec: §10.5, §13.1, §16_
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { assertFeature, FeatureLockedError } from '@/lib/billing/entitlements';
import type { AppointmentStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Phase-7 gating seams (Master Spec §11, §13.1). These Pro endpoints do not
// exist yet; when they are built, gate them server-side exactly like this
// route does with orderRadar:
//   /api/portal/fill         → await assertFeature(groomerId, 'fillMyDay');
//   /api/portal/optimize-day → await assertFeature(groomerId, 'optimizeDay');
//   /api/portal/track/*       → await assertFeature(groomerId, 'liveEta');
//   rebooking nudges job      → await assertFeature(groomerId, 'rebookAutopilot');
//   review-request sends      → await assertFeature(groomerId, 'reviewRequests');
//   before/after share cards  → await assertFeature(groomerId, 'beforeAfter');
// ---------------------------------------------------------------------------

interface LeanRadarAppt {
  _id: unknown;
  clientId?: { name?: string } | null;
  petId?: { name?: string } | null;
  scheduledDate: Date;
  status: AppointmentStatus;
  routeMeta?: {
    extraDriveMin?: number;
    fromPrevKm?: number;
    score?: number;
  } | null;
}

/** "Best fit" / "Nearby stop" label from a routeMeta score (§10.4). */
function routeLabel(meta: LeanRadarAppt['routeMeta']): string | null {
  if (!meta) return null;
  if (typeof meta.score === 'number' && meta.score >= 80) return 'Best fit';
  if (typeof meta.extraDriveMin === 'number' && meta.extraDriveMin <= 8) {
    return 'Nearby stop';
  }
  return null;
}

export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const groomerId = session.user.id;

  // PRO GATE (§13.1). Throws FeatureLockedError → 403 when locked.
  try {
    await assertFeature(groomerId, 'orderRadar');
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return NextResponse.json(
        { error: err.message, code: err.code, feature: err.feature },
        { status: 403 }
      );
    }
    console.error('[radar] entitlement check failed:', err);
    return NextResponse.json({ error: 'Could not verify access.' }, { status: 500 });
  }

  try {
    await connectDB();

    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const docs = await Appointment.find({
      groomerId,
      scheduledDate: { $gte: now, $lte: in7d },
      status: 'upcoming',
      'routeMeta.extraDriveMin': { $exists: true },
    })
      .populate('clientId', 'name')
      .populate('petId', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean<LeanRadarAppt[]>();

    const items = docs.map((doc) => {
      const start = new Date(doc.scheduledDate);
      return {
        id: String(doc._id),
        petName: doc.petId?.name ?? null,
        clientName: doc.clientId?.name ?? null,
        scheduledDate: start.toISOString(),
        fromPrevKm:
          typeof doc.routeMeta?.fromPrevKm === 'number'
            ? Number(doc.routeMeta.fromPrevKm.toFixed(1))
            : null,
        extraDriveMin:
          typeof doc.routeMeta?.extraDriveMin === 'number'
            ? Math.max(0, Math.round(doc.routeMeta.extraDriveMin))
            : null,
        label: routeLabel(doc.routeMeta),
      };
    });

    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    console.error('[radar] query failed:', err);
    return NextResponse.json({ error: 'Could not load Order Radar.' }, { status: 500 });
  }
}
