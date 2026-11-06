/**
 * Reschedule → Fill My Day (plan-claims-audit, task 13.2).
 *
 * Moving an appointment frees its old window; when the old and new windows
 * don't overlap, the freed time is offered via `autoFillCancelledSlot`.
 *
 * **Validates: Requirements 3.3**
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { freedWindowAfterMove } from '@/lib/fill/auto';

const HOUR_MS = 60 * 60 * 1000;
const T0 = Date.parse('2025-06-15T09:00:00.000Z');

describe('freedWindowAfterMove', () => {
  const oldStart = T0;
  const oldEnd = T0 + HOUR_MS;

  it('returns the old window when the move is to a non-overlapping time later', () => {
    expect(
      freedWindowAfterMove(oldStart, oldEnd, T0 + 3 * HOUR_MS, T0 + 4 * HOUR_MS)
    ).toEqual({ startMs: oldStart, endMs: oldEnd });
  });

  it('returns the old window when the move is to an earlier day', () => {
    const dayMs = 24 * HOUR_MS;
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldStart - dayMs, oldEnd - dayMs)
    ).toEqual({ startMs: oldStart, endMs: oldEnd });
  });

  it('treats touching windows as non-overlapping (half-open)', () => {
    // New window starts exactly when the old one ends.
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldEnd, oldEnd + HOUR_MS)
    ).toEqual({ startMs: oldStart, endMs: oldEnd });
    // New window ends exactly when the old one starts.
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldStart - HOUR_MS, oldStart)
    ).toEqual({ startMs: oldStart, endMs: oldEnd });
  });

  it('returns null for a partial overlap', () => {
    const half = HOUR_MS / 2;
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldStart + half, oldEnd + half)
    ).toBeNull();
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldStart - half, oldEnd - half)
    ).toBeNull();
  });

  it('returns null when one window contains the other (resize)', () => {
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldStart, oldEnd + HOUR_MS)
    ).toBeNull();
    expect(
      freedWindowAfterMove(oldStart, oldEnd, oldStart, oldStart + HOUR_MS / 4)
    ).toBeNull();
  });

  it('returns null for identical windows', () => {
    expect(freedWindowAfterMove(oldStart, oldEnd, oldStart, oldEnd)).toBeNull();
  });

  it('returns null for invalid inputs', () => {
    expect(freedWindowAfterMove(NaN, oldEnd, T0 + 3 * HOUR_MS, T0 + 4 * HOUR_MS)).toBeNull();
    expect(freedWindowAfterMove(oldEnd, oldStart, T0 + 3 * HOUR_MS, T0 + 4 * HOUR_MS)).toBeNull();
  });
});

describe('rescheduleAppointment source guard', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src', 'actions', 'appointments.ts'),
    'utf8'
  );
  const fnStart = src.indexOf('export async function rescheduleAppointment(');
  const fnEnd = src.indexOf('\nexport ', fnStart + 1);
  const body = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  it('captures the old window before overwriting it', () => {
    expect(fnStart).toBeGreaterThan(-1);
    const capture = body.indexOf('oldStartMs = new Date(appointment.scheduledDate)');
    const overwrite = body.indexOf('appointment.scheduledDate = new Date(newStartMs)');
    expect(capture).toBeGreaterThan(-1);
    expect(overwrite).toBeGreaterThan(capture);
  });

  it('calls freedWindowAfterMove and autoFillCancelledSlot inside a try/catch after the save', () => {
    const save = body.indexOf('await appointment.save()');
    const freed = body.indexOf('freedWindowAfterMove(');
    const autoFill = body.indexOf('await autoFillCancelledSlot(');
    expect(save).toBeGreaterThan(-1);
    expect(freed).toBeGreaterThan(save);
    expect(autoFill).toBeGreaterThan(freed);

    const tryIdx = body.lastIndexOf('try {', freed);
    expect(tryIdx).toBeGreaterThan(save);
    const catchIdx = body.indexOf('} catch (err) {', autoFill);
    expect(catchIdx).toBeGreaterThan(autoFill);
    expect(body.slice(catchIdx, catchIdx + 200)).toContain(
      '[move] auto-fill failed (non-fatal)'
    );
  });
});
