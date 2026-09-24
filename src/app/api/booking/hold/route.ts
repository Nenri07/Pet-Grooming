/**
 * Public tentative-hold endpoint (POST /api/booking/hold).
 *
 * When a client picks a slot we place a 10-minute Redis hold so a second client
 * can't book the same time mid-checkout (Master Spec §9.4). The authoritative
 * race-safety still happens at commit time under the booking lock; this hold is
 * an early, best-effort guard.
 *
 * Body: { groomerSlug | groomerId, startMs, endMs, clientEmail }.
 *
 * Rate-limited with the hold limiter keyed by `hold:{ip}` (10/min/IP); on limit
 * returns 429. On {@link SlotHeldError} returns 409 { error: 'slot_taken' }.
 * On success returns { holdId }.
 *
 * Graceful degradation: when Redis is NOT configured (local/dev without Upstash
 * env vars) we cannot place a real hold, so we return a synthetic OK with
 * `held: false` and no holdId. This keeps the booking flow working end-to-end
 * locally — the commit path re-checks Mongo for conflicts regardless, so
 * skipping the hold only removes the early guard, not correctness.
 *
 * Node runtime (Redis) and never cached.
 *
 * _Master Spec: §9.4, §16_
 */
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { createHold, SlotHeldError } from '@/lib/calendar/holds';
import { holdRateLimit, checkRateLimit } from '@/lib/ratelimit';
import { isRedisConfigured } from '@/lib/redis';

// Redis needs Node APIs; the Edge runtime lacks them.
export const runtime = 'nodejs';
// Holds are stateful and must never be cached.
export const dynamic = 'force-dynamic';

/** Best-effort client IP for rate-limit keying (proxy headers, else "unknown"). */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Whether a value is a finite, non-negative epoch-ms number. */
function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

interface HoldBody {
  groomerId?: unknown;
  groomerSlug?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  clientEmail?: unknown;
}

/** Resolve the groomer's `userId` from an explicit id or a public slug. */
async function resolveGroomerId(
  groomerId: string | undefined,
  groomerSlug: string | undefined
): Promise<string | null> {
  if (groomerId) {
    const byId = await GroomerProfile.findOne({ userId: groomerId }).select('userId').lean();
    return byId ? String(byId.userId) : null;
  }
  if (groomerSlug) {
    const bySlug = await GroomerProfile.findOne({ groomerSlug }).select('userId').lean();
    return bySlug ? String(bySlug.userId) : null;
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  // Rate-limit: 10/min/IP. On limit, 429.
  const rl = await checkRateLimit(holdRateLimit(), `hold:${clientIp(req)}`);
  if (!rl.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: HoldBody;
  try {
    body = (await req.json()) as HoldBody;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const groomerId = typeof body.groomerId === 'string' ? body.groomerId : undefined;
  const groomerSlug = typeof body.groomerSlug === 'string' ? body.groomerSlug : undefined;
  const startMs = body.startMs;
  const endMs = body.endMs;
  const clientEmail =
    typeof body.clientEmail === 'string' ? body.clientEmail.trim().toLowerCase() : '';

  if (!groomerId && !groomerSlug) {
    return NextResponse.json({ error: 'missing_groomer' }, { status: 400 });
  }
  if (!isEpochMs(startMs) || !isEpochMs(endMs) || endMs <= startMs) {
    return NextResponse.json({ error: 'invalid_slot' }, { status: 400 });
  }
  if (!clientEmail) {
    return NextResponse.json({ error: 'missing_email' }, { status: 400 });
  }

  try {
    await connectDB();

    const resolvedGroomerId = await resolveGroomerId(groomerId, groomerSlug);
    if (!resolvedGroomerId) {
      return NextResponse.json({ error: 'groomer_not_found' }, { status: 404 });
    }

    // Local/dev fallback: without Upstash configured we can't place a real hold.
    // Return a synthetic OK so the client flow proceeds; commit-time re-check in
    // Mongo still prevents double-booking, so correctness is preserved.
    if (!isRedisConfigured()) {
      return NextResponse.json({ ok: true, held: false, holdId: null });
    }

    const { holdId } = await createHold(resolvedGroomerId, startMs, endMs, clientEmail);
    return NextResponse.json({ ok: true, held: true, holdId });
  } catch (err) {
    if (err instanceof SlotHeldError) {
      return NextResponse.json({ error: 'slot_taken' }, { status: 409 });
    }
    console.error('POST /api/booking/hold failed:', err);
    return NextResponse.json({ error: 'hold_failed' }, { status: 500 });
  }
}
