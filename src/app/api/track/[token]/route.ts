/**
 * Public tracker poll (GET /api/track/[token]) — Master Spec §11.2, §16.
 *
 * The public `/t/{token}` page polls this every ~10s for the current van
 * position + ETA. No auth — the token is the capability. Returns 404 when the
 * token doesn't map to a live trip.
 *
 * _Master Spec: §11.2, §16_
 */
import { NextResponse } from 'next/server';
import { resolveTracker } from '@/lib/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
): Promise<Response> {
  const data = await resolveTracker(params.token);
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(
    {
      business: data.business,
      logoUrl: data.logoUrl,
      petName: data.petName,
      groomerPhone: data.groomerPhone,
      van: data.van,
      etaMinutes: data.etaMinutes,
      ended: data.ended,
    },
    { status: 200 }
  );
}
