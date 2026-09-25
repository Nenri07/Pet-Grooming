/**
 * Live ETA control (POST /api/portal/track/[id]) — Master Spec §11.2.
 *
 * The groomer's device drives the trip through this one endpoint with an
 * `action`:
 *   - `start`    → mint/ensure the tracking token, stamp startedAt, text the
 *                  client the `/t/{token}` link ("On my way"). Optional lat/lng.
 *   - `position` → update the van position (posted every ~20s while active).
 *   - `stop`     → stamp arrivedAt + clear the Redis position (stops sharing).
 *
 * PRO-GATED SERVER-SIDE (§13.1): `liveEta` is a Pro feature, so we
 * `assertFeature(groomerId, 'liveEta')` → 403 locked envelope when denied.
 * Every op is scoped to the authed groomer's appointment.
 *
 * _Master Spec: §11.2, §13.1, §16_
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { assertFeature, FeatureLockedError } from '@/lib/billing/entitlements';
import { startTracking, stopTracking, updatePosition } from '@/lib/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TrackBody {
  action?: unknown;
  lat?: unknown;
  lng?: unknown;
}

function isLat(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}
function isLng(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const groomerId = session.user.id;

  // PRO GATE (§13.1).
  try {
    await assertFeature(groomerId, 'liveEta');
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return NextResponse.json(
        { error: err.message, code: err.code, feature: err.feature },
        { status: 403 }
      );
    }
    console.error('[track] entitlement check failed:', err);
    return NextResponse.json({ error: 'Could not verify access.' }, { status: 500 });
  }

  let body: TrackBody;
  try {
    body = (await req.json()) as TrackBody;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const action = body.action;
  const appointmentId = params.id;

  if (action === 'start') {
    const lat = isLat(body.lat) ? body.lat : undefined;
    const lng = isLng(body.lng) ? body.lng : undefined;
    const res = await startTracking({ groomerId, appointmentId, lat, lng });
    return NextResponse.json(res, { status: res.ok ? 200 : 404 });
  }

  if (action === 'position') {
    if (!isLat(body.lat) || !isLng(body.lng)) {
      return NextResponse.json({ error: 'invalid_position' }, { status: 400 });
    }
    const res = await updatePosition({ groomerId, appointmentId, lat: body.lat, lng: body.lng });
    return NextResponse.json(res, { status: res.ok ? 200 : 409 });
  }

  if (action === 'stop') {
    const res = await stopTracking({ groomerId, appointmentId });
    return NextResponse.json(res, { status: res.ok ? 200 : 404 });
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
