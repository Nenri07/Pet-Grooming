/**
 * Reminder sweep trigger (GET/POST /api/cron/reminders).
 *
 * Call every ~15 minutes with `Authorization: Bearer ${CRON_SECRET}`.
 * Vercel Cron sends that header automatically when CRON_SECRET is set; an
 * external free scheduler (e.g. cron-job.org) can send it too.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDueReminders } from '@/lib/reminders/run-due';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runDueReminders();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
