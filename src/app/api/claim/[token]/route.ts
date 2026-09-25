/**
 * Public claim lookup (GET /api/claim/[token]) — Master Spec §11.1.
 *
 * Validates a Fill My Day claim token and returns the slot + groomer branding
 * for the public claim page. No auth (clients aren't signed in); the token
 * itself is the capability. Returns 404 when the token is missing/expired.
 *
 * _Master Spec: §11.1, §16_
 */
import { NextResponse } from 'next/server';
import { resolveClaim } from '@/lib/fill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
): Promise<Response> {
  const claim = await resolveClaim(params.token);
  if (!claim) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(
    {
      token: claim.token,
      startMs: claim.startMs,
      endMs: claim.endMs,
      business: claim.business,
      logoUrl: claim.logoUrl ?? null,
      timezone: claim.timezone,
      clientName: claim.clientName ?? null,
      petName: claim.petName ?? null,
      alreadyTaken: claim.alreadyTaken,
    },
    { status: 200 }
  );
}
