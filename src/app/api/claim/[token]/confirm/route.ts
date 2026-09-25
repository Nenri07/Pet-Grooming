/**
 * Public claim confirmation (POST /api/claim/[token]/confirm) — Master Spec §11.1.
 *
 * FIRST-TO-WIN: `confirmClaim` runs `SET claimwon:{gid}:{startMs} NX` — the
 * first caller wins and is booked via the normal commit path; losers get
 * `{ error: 'taken' }` (409) so the page can say "this slot was just taken".
 *
 * No auth — the token is the capability. Rate-limited by the booking limiter
 * keyed by IP to blunt token-guessing / spam.
 *
 * _Master Spec: §11.1, §9.4, §16_
 */
import { NextResponse } from 'next/server';
import { confirmClaim } from '@/lib/fill';
import { bookingRateLimit, checkRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function POST(
  req: Request,
  { params }: { params: { token: string } }
): Promise<Response> {
  const rl = await checkRateLimit(bookingRateLimit(), `claim:${clientIp(req)}`);
  if (!rl.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const result = await confirmClaim(params.token);
  if (result.ok) {
    return NextResponse.json({ ok: true, appointmentId: result.appointmentId }, { status: 200 });
  }

  const statusByReason: Record<string, number> = {
    expired: 404,
    taken: 409,
    commit_failed: 409,
    error: 500,
  };
  return NextResponse.json(
    { ok: false, reason: result.reason },
    { status: statusByReason[result.reason] ?? 500 }
  );
}
