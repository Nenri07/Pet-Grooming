/**
 * Fill My Day trigger (POST /api/portal/fill) — Master Spec §11.1.
 *
 * The groomer taps "Fill this gap" on the dashboard for a freed interval; this
 * endpoint gathers waitlist + due-pet candidates, ranks them by route-fit, and
 * texts the top 3 a claim link.
 *
 * PRO-GATED SERVER-SIDE (§13.1: "Never gate only in the UI"): `fillMyDay` is a
 * Pro feature, so we `assertFeature(groomerId, 'fillMyDay')` and respond 403
 * with a locked envelope when the plan lacks it or the subscription is inactive.
 *
 * Body: { gapStartMs, gapEndMs } (epoch ms). Every query in the orchestrator is
 * scoped to the authed groomer.
 *
 * _Master Spec: §11.1, §13.1, §16_
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { assertFeature, FeatureLockedError } from '@/lib/billing/entitlements';
import { fillMyDay } from '@/lib/fill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FillBody {
  gapStartMs?: unknown;
  gapEndMs?: unknown;
}

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const groomerId = session.user.id;

  // PRO GATE (§13.1). Throws FeatureLockedError → 403 when locked.
  try {
    await assertFeature(groomerId, 'fillMyDay');
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return NextResponse.json(
        { error: err.message, code: err.code, feature: err.feature },
        { status: 403 }
      );
    }
    console.error('[fill] entitlement check failed:', err);
    return NextResponse.json({ error: 'Could not verify access.' }, { status: 500 });
  }

  let body: FillBody;
  try {
    body = (await req.json()) as FillBody;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { gapStartMs, gapEndMs } = body;
  if (!isEpochMs(gapStartMs) || !isEpochMs(gapEndMs) || gapEndMs <= gapStartMs) {
    return NextResponse.json({ error: 'invalid_gap' }, { status: 400 });
  }

  const result = await fillMyDay(groomerId, gapStartMs, gapEndMs);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
