/**
 * Fill My Day auto-start property tests (plan-claims-audit, Property 4).
 *
 * Feature: plan-claims-audit, Property 4: Auto-fill timing
 *
 * The pure `shouldAutoFill(slotStartMs, nowMs)` is true exactly when the
 * cancelled slot starts more than 2 hours from now. The example tests for
 * `autoFillCancelledSlot` mock only the entitlement lookup and the DB-backed
 * `fillMyDay` so the plan and timing gates can be exercised without Mongoose.
 *
 * **Validates: Requirements 3.3**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

vi.mock('@/lib/billing/entitlements', () => ({
  getEntitlements: vi.fn(),
  checkFeature: vi.fn(),
}));
vi.mock('@/lib/fill/fill', () => ({
  fillMyDay: vi.fn(),
}));

import {
  AUTO_FILL_MIN_LEAD_MS,
  autoFillCancelledSlot,
  shouldAutoFill,
} from '@/lib/fill/auto';
import { checkFeature, getEntitlements } from '@/lib/billing/entitlements';
import { fillMyDay } from '@/lib/fill/fill';

const HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * HOUR_MS;
const NOW_MS = Date.parse('2025-06-15T12:00:00.000Z');
const YEAR_MS = 365 * 24 * HOUR_MS;

describe('Feature: plan-claims-audit, Property 4: Auto-fill timing', () => {
  it('uses a 2-hour minimum lead time', () => {
    expect(AUTO_FILL_MIN_LEAD_MS).toBe(TWO_HOURS_MS);
  });

  it('is true exactly when the slot starts more than 2h from now (integer ms)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: NOW_MS - 10 * YEAR_MS, max: NOW_MS + 10 * YEAR_MS }),
        fc.integer({ min: -3 * TWO_HOURS_MS, max: 3 * TWO_HOURS_MS }),
        (nowMs, offsetMs) => {
          const slotStartMs = nowMs + offsetMs;
          expect(shouldAutoFill(slotStartMs, nowMs)).toBe(
            offsetMs > TWO_HOURS_MS
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it('is true exactly when start - now > 2h for any finite doubles', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (slotStartMs, nowMs) => {
          expect(shouldAutoFill(slotStartMs, nowMs)).toBe(
            slotStartMs - nowMs > TWO_HOURS_MS
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it('is false for any non-finite input', () => {
    const nonFinite = fc.constantFrom(NaN, Infinity, -Infinity);
    const anyNumber = fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      nonFinite
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.tuple(nonFinite, anyNumber),
          fc.tuple(anyNumber, nonFinite)
        ),
        ([slotStartMs, nowMs]) => {
          expect(shouldAutoFill(slotStartMs, nowMs)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles the 2h boundary', () => {
    expect(shouldAutoFill(NOW_MS + TWO_HOURS_MS, NOW_MS)).toBe(false);
    expect(shouldAutoFill(NOW_MS + TWO_HOURS_MS + 1, NOW_MS)).toBe(true);
    expect(shouldAutoFill(NOW_MS + TWO_HOURS_MS - 1, NOW_MS)).toBe(false);
  });
});

describe('autoFillCancelledSlot', () => {
  const now = new Date(NOW_MS);
  const locked = { code: 'FEATURE_LOCKED' };

  function slot(hoursAhead: number) {
    const start = new Date(NOW_MS + hoursAhead * HOUR_MS);
    const end = new Date(start.getTime() + HOUR_MS);
    return { scheduledDate: start, scheduledEndDate: end };
  }

  beforeEach(() => {
    vi.mocked(getEntitlements).mockReset();
    vi.mocked(checkFeature).mockReset();
    vi.mocked(fillMyDay).mockReset();
    vi.mocked(getEntitlements).mockResolvedValue({} as never);
    vi.mocked(fillMyDay).mockResolvedValue({ ok: true } as never);
  });

  it('does not start Fill My Day on Solo (fillMyDay locked)', async () => {
    vi.mocked(checkFeature).mockReturnValue(locked as never);
    await autoFillCancelledSlot('g1', slot(3), now);
    expect(checkFeature).toHaveBeenCalledWith(expect.anything(), 'fillMyDay');
    expect(fillMyDay).not.toHaveBeenCalled();
  });

  it('starts Fill My Day once on Pro when the slot is 3h ahead', async () => {
    vi.mocked(checkFeature).mockReturnValue(null);
    const appt = slot(3);
    await autoFillCancelledSlot('g1', appt, now);
    expect(fillMyDay).toHaveBeenCalledTimes(1);
    expect(fillMyDay).toHaveBeenCalledWith(
      'g1',
      appt.scheduledDate.getTime(),
      appt.scheduledEndDate.getTime()
    );
  });

  it('does not start Fill My Day on Pro when the slot is 1h ahead', async () => {
    vi.mocked(checkFeature).mockReturnValue(null);
    await autoFillCancelledSlot('g1', slot(1), now);
    expect(fillMyDay).not.toHaveBeenCalled();
  });

  it('resolves without throwing when fillMyDay throws', async () => {
    vi.mocked(checkFeature).mockReturnValue(null);
    vi.mocked(fillMyDay).mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      autoFillCancelledSlot('g1', slot(3), now)
    ).resolves.toBeUndefined();
    expect(fillMyDay).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
