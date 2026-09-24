/**
 * Calendar-sync cron endpoint (GET /api/cron/calendar-sync).
 *
 * LOCKED DECISION: service-account, single shared calendar. On each run this
 * job reads busy events from the shared Google Calendar (`GOOGLE_CALENDAR_ID`)
 * for a rolling window (now .. now + 14 days) and refreshes the locally-stored
 * CalendarBlock rows for that window, so availability computation reflects
 * externally-created calendar events without hitting Google on every request
 * (Requirement 14.3).
 *
 * Authorization: the request MUST carry `Authorization: Bearer ${CRON_SECRET}`
 * (Vercel Cron injects this). Any other value returns 401.
 *
 * Resilience: `fetchBusyBlocks` is best-effort and never throws (returns [] on
 * failure). We only replace the in-window shared-calendar rows AFTER a fetch
 * succeeds, wrapped so a fetch that returns no data does not wipe existing
 * blocks on transient failure — an empty result is treated as "no external
 * busy time in window", which is the correct steady-state.
 *
 * _Requirements: 6.2, 14.3, 14.5_
 */
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connect';
import { CalendarBlock } from '@/lib/db/models/calendar-block';
import { fetchBusyBlocks } from '@/lib/calendar/google-sync';
import { isCalendarConfigured } from '@/lib/calendar/client';

// Mongoose + googleapis require Node APIs; the Edge runtime lacks them.
export const runtime = 'nodejs';
// A cron endpoint must never be cached.
export const dynamic = 'force-dynamic';

/** How far ahead to sync busy blocks, in days. */
const SYNC_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(req: Request): Promise<Response> {
  // 1. Authorize the caller against CRON_SECRET.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('Calendar sync cron: CRON_SECRET is not configured.');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. If the calendar integration isn't configured, no-op successfully so the
  //    cron doesn't flap. Nothing to sync.
  if (!isCalendarConfigured()) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'calendar not configured' },
      { status: 200 }
    );
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * MS_PER_DAY);

  try {
    await connectDB();

    // 3. Read the shared calendar's busy blocks in the window. Best-effort:
    //    returns [] on failure (never throws).
    const busyBlocks = await fetchBusyBlocks(now, windowEnd);

    // 4. Replace the in-window shared-calendar blocks: delete existing rows
    //    overlapping the window, then insert the freshly-fetched set. Using a
    //    half-open overlap test (startTime < windowEnd AND endTime > now).
    const deleteResult = await CalendarBlock.deleteMany({
      source: 'shared-calendar',
      startTime: { $lt: windowEnd },
      endTime: { $gt: now },
    });

    let inserted = 0;
    if (busyBlocks.length > 0) {
      const docs = busyBlocks.map((b) => ({
        source: 'shared-calendar' as const,
        startTime: b.start,
        endTime: b.end,
      }));
      const insertResult = await CalendarBlock.insertMany(docs, { ordered: false });
      inserted = insertResult.length;
    }

    return NextResponse.json(
      {
        ok: true,
        window: { start: now.toISOString(), end: windowEnd.toISOString() },
        fetched: busyBlocks.length,
        deleted: deleteResult.deletedCount ?? 0,
        inserted,
      },
      { status: 200 }
    );
  } catch (err) {
    // Never crash the cron; report the failure for administrative review.
    console.error('Calendar sync cron: run failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Calendar sync failed' },
      { status: 500 }
    );
  }
}
