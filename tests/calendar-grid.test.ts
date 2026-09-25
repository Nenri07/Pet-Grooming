/**
 * Calendar grid geometry — unit tests (Master Spec §9.6).
 *
 * Covers the pure drag/resize math the portal calendar relies on: snapping to
 * the 15-min grid, pixel→minute conversion, and shift/resize that preserve the
 * invariants the reschedule action depends on (duration preserved on move; a
 * minimum one-step duration on resize). PURE — no DB, clock, or network.
 */
import { describe, expect, it } from 'vitest';
import {
  SLOT_STEP_MIN,
  MS_PER_MINUTE,
  snapToStep,
  pixelsToSnappedMinutes,
  shiftBlock,
  resizeBlockEnd,
  durationMinutes,
} from '@/lib/calendar/grid';

/** Build an epoch-ms for a given local hour:minute on a fixed day. */
function at(hour: number, minute = 0): number {
  const d = new Date(2024, 0, 15, hour, minute, 0, 0);
  return d.getTime();
}

describe('snapToStep', () => {
  it('snaps to the nearest 15-minute boundary', () => {
    expect(snapToStep(at(9, 7))).toBe(at(9, 0)); // 7 → nearest is :00
    expect(snapToStep(at(9, 8))).toBe(at(9, 15)); // 8 → nearest is :15
    expect(snapToStep(at(9, 22))).toBe(at(9, 15));
    expect(snapToStep(at(9, 23))).toBe(at(9, 30));
  });

  it('leaves an already-aligned time unchanged', () => {
    expect(snapToStep(at(10, 30))).toBe(at(10, 30));
  });
});

describe('pixelsToSnappedMinutes', () => {
  it('converts pixels to a step-aligned minute delta', () => {
    // 1 px/min, snapped to the nearest 15-min step:
    // 20px (≈1.33 steps) → 15, 5px (<0.5 step) → 0, 40px (≈2.67 steps) → 45.
    expect(pixelsToSnappedMinutes(20, 1)).toBe(15);
    expect(pixelsToSnappedMinutes(5, 1)).toBe(0);
    expect(pixelsToSnappedMinutes(40, 1)).toBe(45);
  });

  it('returns 0 for a non-positive scale', () => {
    expect(pixelsToSnappedMinutes(100, 0)).toBe(0);
  });
});

describe('shiftBlock', () => {
  it('moves start and end together, preserving duration', () => {
    const start = at(9, 0);
    const end = at(10, 0);
    const moved = shiftBlock(start, end, 30);
    expect(moved.startMs).toBe(at(9, 30));
    expect(moved.endMs).toBe(at(10, 30));
    expect(durationMinutes(moved.startMs, moved.endMs)).toBe(60);
  });
});

describe('resizeBlockEnd', () => {
  it('extends the end by the delta, keeping the start fixed', () => {
    const start = at(9, 0);
    const end = at(10, 0);
    const resized = resizeBlockEnd(start, end, 30);
    expect(resized.startMs).toBe(start);
    expect(resized.endMs).toBe(at(10, 30));
  });

  it('never shrinks below one step', () => {
    const start = at(9, 0);
    const end = at(9, 30);
    // Try to collapse by 60 minutes → clamp to start + one step.
    const resized = resizeBlockEnd(start, end, -60);
    expect(resized.endMs).toBe(start + SLOT_STEP_MIN * MS_PER_MINUTE);
    expect(resized.endMs).toBeGreaterThan(resized.startMs);
  });
});
