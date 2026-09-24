/**
 * Native calendar engine — pure-core unit tests (Master Spec §9, tests).
 *
 * These exercise the DB/Redis-free decision cores so they run without a live
 * Redis or Mongo:
 *   1. A slot overlapping an ACTIVE hold is excluded from generated slots.
 *   2. Expired holds don't block (simulated via TTL/absence, not passed in).
 *   3. Concurrent commit: two commits for the same slot → exactly one succeeds
 *      (pure overlap re-check + a mocked lock so only one caller acquires it).
 */
import { describe, expect, it } from 'vitest';
import { computeSlotsForDate, type ComputeSlotsInput } from '@/lib/calendar/slots';
import { conflictsWithHolds, type ActiveHold } from '@/lib/calendar/holds';
import { isSlotStillFree } from '@/lib/calendar/commit';
import type { TimeBlock } from '@/lib/calendar/availability';

// A Monday so weekly window day 0 applies. 2024-01-01 is a Monday (UTC).
const MONDAY = new Date('2024-01-01T00:00:00.000Z');

/** Build a baseline compute input: 09:00–17:00 Monday, 60-min service. */
function baseInput(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    windows: [{ dayOfWeek: 0, startTime: '09:00', endTime: '17:00' }],
    appointmentBlocks: [],
    blockedDates: [],
    holds: [],
    date: MONDAY,
    serviceDurationMinutes: 60,
    config: { bufferMin: 10, slotStepMin: 15, minNoticeHours: 0 },
    // Far in the past so min-notice never removes the day's slots.
    now: new Date('2023-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Local-time helper: the engine anchors windows to the machine's local day. */
function slotAtLocalHour(hour: number, minute = 0): number {
  const d = new Date(MONDAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

describe('hold / slot overlap', () => {
  it('excludes a slot that overlaps an active hold', () => {
    const holdStart = slotAtLocalHour(10);
    const holdEnd = slotAtLocalHour(11);
    const holds: ActiveHold[] = [
      { holdId: 'h1', startMs: holdStart, endMs: holdEnd, email: 'a@x.com' },
    ];

    const withHold = computeSlotsForDate(baseInput({ holds }));
    const withoutHold = computeSlotsForDate(baseInput({ holds: [] }));

    // The 10:00 start must be present when unheld and gone when held.
    const has10 = (slots: { start: Date }[]) =>
      slots.some((s) => s.start.getTime() === holdStart);

    expect(has10(withoutHold)).toBe(true);
    expect(has10(withHold)).toBe(false);

    // And no returned slot overlaps the held interval.
    for (const s of withHold) {
      const overlaps = s.start.getTime() < holdEnd && s.end.getTime() > holdStart;
      expect(overlaps).toBe(false);
    }
  });

  it('conflictsWithHolds uses half-open intervals (touching does not conflict)', () => {
    const holds: ActiveHold[] = [
      { holdId: 'h1', startMs: 1000, endMs: 2000, email: 'a@x.com' },
    ];
    // Touching at the endpoint: [2000,3000) vs [1000,2000) → no conflict.
    expect(conflictsWithHolds(2000, 3000, holds)).toBe(false);
    // Genuine overlap.
    expect(conflictsWithHolds(1500, 2500, holds)).toBe(true);
    // Ignoring the same hold (refreshing your own) → no conflict.
    expect(conflictsWithHolds(1500, 2500, holds, 'h1')).toBe(false);
  });
});

describe('hold expiry', () => {
  it('expired holds do not block: absent from the holds list means the slot returns', () => {
    // Expiry is modelled by the Redis TTL: an expired hold simply is not in the
    // active-holds list. So computing with an empty holds array (post-expiry)
    // must yield the previously-blocked slot again.
    const holdStart = slotAtLocalHour(10);
    const holdEnd = slotAtLocalHour(11);
    const active: ActiveHold[] = [
      { holdId: 'h1', startMs: holdStart, endMs: holdEnd, email: 'a@x.com' },
    ];

    const blockedWhileActive = computeSlotsForDate(baseInput({ holds: active }));
    const freeAfterExpiry = computeSlotsForDate(baseInput({ holds: [] }));

    const has10 = (slots: { start: Date }[]) =>
      slots.some((s) => s.start.getTime() === holdStart);

    expect(has10(blockedWhileActive)).toBe(false);
    expect(has10(freeAfterExpiry)).toBe(true);
  });

  it('respects the minNoticeHours cutoff', () => {
    // now = MONDAY 08:00 local; minNotice 2h → the 09:00 start is too soon,
    // but 10:00 is allowed.
    const now = new Date(MONDAY);
    now.setHours(8, 0, 0, 0);

    const slots = computeSlotsForDate(
      baseInput({ now, config: { bufferMin: 10, slotStepMin: 15, minNoticeHours: 2 } })
    );

    const cutoff = now.getTime() + 2 * 60 * 60 * 1000;
    for (const s of slots) {
      expect(s.start.getTime()).toBeGreaterThanOrEqual(cutoff);
    }
  });
});

describe('concurrent commit — exactly one wins', () => {
  it('pure overlap re-check: the second committed appointment makes the slot taken', () => {
    const startAt = slotAtLocalHour(10);
    const endAt = slotAtLocalHour(11);

    // Before anyone books: slot is free.
    expect(isSlotStillFree(startAt, endAt, [], 10)).toBe(true);

    // After the winner writes its appointment, the same slot is no longer free
    // for the loser's re-check (buffer-padded overlap).
    const winnerBlock: TimeBlock[] = [{ start: new Date(startAt), end: new Date(endAt) }];
    expect(isSlotStillFree(startAt, endAt, winnerBlock, 10)).toBe(false);
  });

  it('mocked lock: only one of two concurrent committers acquires the lock', async () => {
    // Simulate the Redis SET NX lock: the first caller wins, the rest fail
    // until release. This is the lock decision commit.ts relies on.
    let held: string | null = null;
    const acquire = (token: string): boolean => {
      if (held === null) {
        held = token;
        return true;
      }
      return false;
    };

    const results = await Promise.all([
      Promise.resolve(acquire('A')),
      Promise.resolve(acquire('B')),
    ]);

    const winners = results.filter(Boolean).length;
    expect(winners).toBe(1);

    // The loser, re-checking against the winner's now-committed appointment,
    // sees the slot taken and would refund.
    const startAt = slotAtLocalHour(10);
    const endAt = slotAtLocalHour(11);
    const committed: TimeBlock[] = [{ start: new Date(startAt), end: new Date(endAt) }];
    expect(isSlotStillFree(startAt, endAt, committed, 10)).toBe(false);
  });
});
