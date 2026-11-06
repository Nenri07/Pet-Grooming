/**
 * Daily email cap guard (plan-claims-audit, task 14.1).
 *
 * Redis and the Resend SDK are replaced with in-memory fakes; the real
 * `deliver()` path in `src/lib/email/send.ts` runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string | number>(),
  incrCalls: 0,
  send: vi.fn(async (_m: { to: string; subject: string }) => ({
    data: { id: 'email_1' } as { id: string } | null,
    error: null as null | { name: string; statusCode: number; message: string },
  })),
}));

vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => true,
  getRedis: () => ({
    incr: async (key: string) => {
      h.incrCalls++;
      const n = Number(h.store.get(key) ?? 0) + 1;
      h.store.set(key, n);
      return n;
    },
    expire: async () => 1,
    get: async (key: string) => h.store.get(key) ?? null,
    set: async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && h.store.has(key)) return null;
      h.store.set(key, value);
      return 'OK';
    },
  }),
  keys: {
    emailDay: (d: string) => `email:day:${d}`,
    emailDayAlert: (d: string) => `email:day:${d}:alert`,
  },
  TTL: { EMAIL_DAY: 172_800 },
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.send };
  },
}));

vi.mock('@/lib/sms/quota', () => ({
  getUsage: async () => 0,
  incrementUsage: async () => 1,
}));

vi.mock('@/lib/billing/entitlements', () => ({
  getEntitlements: async () => ({ smsIncluded: 800, smsTopupBalance: 0 }),
  invalidateEntitlements: async () => {},
}));

import { captureEmails, sendEmailVerification } from '@/lib/email/send';
import { recordEmailSent, utcDay } from '@/lib/email/daily-cap';
import { canSendOptionalMessage } from '@/lib/messaging/usage';

const ENV_KEYS = ['RESEND_API_KEY', 'BUSINESS_EMAIL', 'ADMIN_EMAIL', 'EMAIL_DAILY_LIMIT'] as const;
const savedEnv: Record<string, string | undefined> = {};

const todayKey = () => `email:day:${utcDay(new Date())}`;
const alertsSent = () => h.send.mock.calls.filter(([m]) => m.to === 'founder@example.com');

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.RESEND_API_KEY = 're_test';
  process.env.BUSINESS_EMAIL = 'support@example.com';
  process.env.ADMIN_EMAIL = 'founder@example.com';
  process.env.EMAIL_DAILY_LIMIT = '10';
  h.store.clear();
  h.incrCalls = 0;
  h.send.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('daily cap alert', () => {
  it('sends ONE founder alert when the count first reaches 80%, and not again that day', async () => {
    for (let i = 0; i < 7; i++) await sendEmailVerification(`c${i}@example.com`, 'https://x/verify');
    expect(alertsSent()).toHaveLength(0);
    expect(h.store.get(todayKey())).toBe(7);

    // 8th email: 8 of 10 = 80% -> warn -> alert.
    await sendEmailVerification('c7@example.com', 'https://x/verify');
    expect(alertsSent()).toHaveLength(1);
    const [alert] = alertsSent()[0];
    expect(alert.subject).toContain('8 of 10');
    // The alert itself is counted, without triggering another alert.
    expect(h.store.get(todayKey())).toBe(9);

    // Further sends (warn and reserve) do not re-alert.
    await sendEmailVerification('c8@example.com', 'https://x/verify');
    await sendEmailVerification('c9@example.com', 'https://x/verify');
    expect(alertsSent()).toHaveLength(1);
    expect(h.store.get(todayKey())).toBe(11);
  });

  it('alerts again on the next UTC day', async () => {
    const alert = vi.fn(async () => true);
    const day1 = new Date('2025-03-04T10:00:00Z');
    const day2 = new Date('2025-03-05T10:00:00Z');
    for (let i = 0; i < 10; i++) await recordEmailSent(alert, day1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(8, 10);
    for (let i = 0; i < 10; i++) await recordEmailSent(alert, day2);
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('never alerts when the guard is disabled (EMAIL_DAILY_LIMIT=0)', async () => {
    process.env.EMAIL_DAILY_LIMIT = '0';
    const alert = vi.fn(async () => true);
    for (let i = 0; i < 20; i++) await recordEmailSent(alert);
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('canSendOptionalMessage and the daily reserve', () => {
  it('is false while the platform is in reserve (>= 90%)', async () => {
    h.store.set(todayKey(), 9);
    expect(await canSendOptionalMessage('g1')).toBe(false);
  });

  it('is true below the reserve threshold when the groomer has allowance', async () => {
    h.store.set(todayKey(), 8);
    expect(await canSendOptionalMessage('g1')).toBe(true);
  });

  it('ignores the reserve when the guard is disabled', async () => {
    process.env.EMAIL_DAILY_LIMIT = '0';
    h.store.set(todayKey(), 500);
    expect(await canSendOptionalMessage('g1')).toBe(true);
  });
});

describe('counting', () => {
  it('does not count captured (preview) emails', async () => {
    const out = await captureEmails(() => sendEmailVerification('c@example.com', 'https://x/verify'));
    expect(out).toHaveLength(1);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.incrCalls).toBe(0);
    expect(h.store.has(todayKey())).toBe(false);
  });

  it('does not count or retry a send Resend rejects for daily quota, and logs it', async () => {
    h.send.mockResolvedValueOnce({
      data: null,
      error: { name: 'daily_quota_exceeded', statusCode: 429, message: 'quota' },
    });
    const ok = await sendEmailVerification('c@example.com', 'https://x/verify');
    expect(ok).toBe(false);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.incrCalls).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('daily_quota_exceeded'),
      expect.anything()
    );
  });
});
