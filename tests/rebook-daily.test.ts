/**
 * Once-per-day rebook sweep (plan-claims-audit, task 8.2, Requirement 4.1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  configured: true,
  store: new Map<string, string>(),
  setThrows: false,
  setCalls: [] as Array<{ key: string; opts: unknown }>,
  runRebookNudges: vi.fn(async () => ({ examined: 2, sent: 1, gatedGroomers: 0 })),
}));

vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => h.configured,
  getRedis: () => ({
    set: async (key: string, value: string, opts: { nx?: boolean }) => {
      h.setCalls.push({ key, opts });
      if (h.setThrows) throw new Error('redis down');
      if (opts?.nx && h.store.has(key)) return null;
      h.store.set(key, value);
      return 'OK';
    },
  }),
  keys: { rebookDaily: (d: string) => `cron:rebook:${d}` },
  TTL: { REBOOK_DAILY: 90_000 },
}));

vi.mock('@/lib/rebooking/nudges', () => ({
  runRebookNudges: h.runRebookNudges,
}));

import { rebookDailyKey, runRebookNudgesOncePerDay } from '@/lib/rebooking/daily';

const NOW = new Date('2025-03-04T23:30:00Z');

beforeEach(() => {
  h.configured = true;
  h.store.clear();
  h.setThrows = false;
  h.setCalls = [];
  h.runRebookNudges.mockClear();
});

describe('rebookDailyKey', () => {
  it('uses the UTC date of now', () => {
    expect(rebookDailyKey(NOW)).toBe('cron:rebook:2025-03-04');
    expect(rebookDailyKey(new Date('2025-03-05T00:00:00Z'))).toBe('cron:rebook:2025-03-05');
  });
});

describe('runRebookNudgesOncePerDay', () => {
  it('runs the sweep on the first call and skips the second on the same day', async () => {
    const first = await runRebookNudgesOncePerDay(NOW);
    expect(first).toEqual({ examined: 2, sent: 1, gatedGroomers: 0 });
    expect(h.runRebookNudges).toHaveBeenCalledWith(NOW);
    expect(h.setCalls[0]).toEqual({
      key: 'cron:rebook:2025-03-04',
      opts: { nx: true, ex: 90_000 },
    });

    const second = await runRebookNudgesOncePerDay(NOW);
    expect(second).toEqual({ skipped: 'already_ran_today' });
    expect(h.runRebookNudges).toHaveBeenCalledTimes(1);
  });

  it('runs again on the next UTC day', async () => {
    await runRebookNudgesOncePerDay(NOW);
    await runRebookNudgesOncePerDay(new Date('2025-03-05T00:15:00Z'));
    expect(h.runRebookNudges).toHaveBeenCalledTimes(2);
  });

  it('runs the sweep when Redis is not configured', async () => {
    h.configured = false;
    await runRebookNudgesOncePerDay(NOW);
    await runRebookNudgesOncePerDay(NOW);
    expect(h.runRebookNudges).toHaveBeenCalledTimes(2);
    expect(h.setCalls).toHaveLength(0);
  });

  it('runs the sweep when the marker SET throws', async () => {
    h.setThrows = true;
    const res = await runRebookNudgesOncePerDay(NOW);
    expect(res).toEqual({ examined: 2, sent: 1, gatedGroomers: 0 });
  });
});
