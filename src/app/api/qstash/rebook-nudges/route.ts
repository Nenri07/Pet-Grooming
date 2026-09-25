/**
 * Rebooking-autopilot daily job (POST /api/qstash/rebook-nudges) — Master Spec §11.4, §16.
 *
 * QStash calls this once a day; it sweeps pets due within 7 days with no future
 * appointment + SMS consent and sends a `rebook_nudge` with a `/rebook/{token}`
 * link, throttled to one nudge + one 5-day reminder per pet. Each groomer is
 * Pro-gated (`rebookAutopilot`) inside {@link runRebookNudges}.
 *
 * AUTH: two accepted triggers —
 *   1. A valid QStash signature (QSTASH_CURRENT_SIGNING_KEY / _NEXT_SIGNING_KEY).
 *   2. A `Authorization: Bearer {CRON_SECRET}` header (Vercel-cron / manual
 *      fallback, §16 "Fallback: Vercel Cron").
 * When NEITHER signing keys NOR CRON_SECRET are configured we 200 no-op so a
 * credential-free environment does not error.
 *
 * _Master Spec: §11.4, §13.1, §16_
 */
import { NextResponse } from 'next/server';
import { runRebookNudges } from '@/lib/rebooking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function qstashKeysConfigured(): boolean {
  return Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
  );
}

/** Verify the CRON_SECRET bearer fallback trigger. */
function cronSecretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  // Trigger 2: CRON_SECRET bearer fallback.
  if (cronSecretOk(req)) {
    const result = await runRebookNudges();
    return NextResponse.json({ ok: true, via: 'cron', ...result }, { status: 200 });
  }

  // Trigger 1: QStash signature.
  if (!qstashKeysConfigured()) {
    // Neither trigger available in this environment — no-op so it never errors.
    return NextResponse.json(
      { received: true, skipped: 'unconfigured' },
      { status: 200 }
    );
  }

  const signature = req.headers.get('upstash-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
  }

  try {
    const { Receiver } = await import('@upstash/qstash');
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
    });
    const valid = await receiver.verify({ signature, body: rawBody });
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }
  } catch (err) {
    console.error('[qstash:rebook-nudges] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const result = await runRebookNudges();
  return NextResponse.json({ ok: true, via: 'qstash', ...result }, { status: 200 });
}
