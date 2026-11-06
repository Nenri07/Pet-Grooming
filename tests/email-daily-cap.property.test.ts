/**
 * Feature: plan-claims-audit, task 14.1: daily email cap thresholds.
 *
 * Pure core only: `emailCapState(sent, limit)` is 'ok' below 80% of the daily
 * limit, 'warn' from 80%, 'reserve' from 90%, and always 'ok' when the limit
 * is 0 (guard disabled).
 *
 * **Validates: Requirements 3.2, 4.4**
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { emailCapState, emailDailyLimit } from '@/lib/email/daily-cap';

const limitArb = fc.integer({ min: 1, max: 100_000 });
const sentArb = fc.integer({ min: 0, max: 200_000 });

describe('Feature: plan-claims-audit, daily email cap: emailCapState thresholds', () => {
  it('matches the 80% / 90% thresholds for every sent count and limit', () => {
    fc.assert(
      fc.property(sentArb, limitArb, (sent, limit) => {
        // Exact percentages (sent / limit >= 90% / 80%), without float rounding.
        const expected = sent * 10 >= limit * 9 ? 'reserve' : sent * 10 >= limit * 8 ? 'warn' : 'ok';
        expect(emailCapState(sent, limit)).toBe(expected);
      }),
      { numRuns: 500 }
    );
  });

  it('never goes back to a lower state as the count grows', () => {
    const rank = { ok: 0, warn: 1, reserve: 2 } as const;
    fc.assert(
      fc.property(sentArb, fc.nat({ max: 1_000 }), limitArb, (sent, more, limit) => {
        expect(rank[emailCapState(sent + more, limit)]).toBeGreaterThanOrEqual(
          rank[emailCapState(sent, limit)]
        );
      }),
      { numRuns: 300 }
    );
  });

  it('is always ok when the guard is disabled (limit 0)', () => {
    fc.assert(
      fc.property(sentArb, (sent) => {
        expect(emailCapState(sent, 0)).toBe('ok');
      }),
      { numRuns: 100 }
    );
  });

  it.each([
    [79, 100, 'ok'],
    [80, 100, 'warn'],
    [89, 100, 'warn'],
    [90, 100, 'reserve'],
    [100, 100, 'reserve'],
    [150, 100, 'reserve'],
  ] as const)('sent %i of %i is %s', (sent, limit, state) => {
    expect(emailCapState(sent, limit)).toBe(state);
  });
});

describe('emailDailyLimit', () => {
  it.each([
    [undefined, 100],
    ['', 100],
    ['abc', 100],
    ['-5', 100],
    ['0', 0],
    ['3000', 3000],
  ] as const)('EMAIL_DAILY_LIMIT=%s gives %i', (raw, expected) => {
    expect(emailDailyLimit(raw)).toBe(expected);
  });
});
