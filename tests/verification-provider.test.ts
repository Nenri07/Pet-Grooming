/**
 * Verification-provider selection + Noop behaviour tests (task 8.4).
 *
 * HERMETIC: no real Twilio, no real Redis, no real SMS network. We:
 *   - set/unset the relevant env vars directly (`TWILIO_VERIFY_SERVICE_SID`,
 *     the SMS trio `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/
 *     `TWILIO_MESSAGING_SERVICE_SID`) — `isTwilioVerifyConfigured()` and
 *     `isSmsConfigured()` read `process.env` live, so this is enough to toggle
 *     those two gates between cases;
 *   - mock `@/lib/redis` so `isRedisConfigured()` is controllable per-case
 *     (the real one captures `UPSTASH_*` at import time, so env can't toggle
 *     it) while the remaining Redis helpers are harmless no-ops (none are
 *     reached — we only ever do provider selection + Noop envelopes here);
 *   - call `resetVerificationProvider()` between cases because the factory
 *     caches its instance, and restore `process.env` in `afterEach`.
 *
 * No provider METHOD that touches a backend is ever invoked on the Twilio/OTP
 * paths — we only assert the selected concrete class via `instanceof`. The only
 * methods we call are on `NoopVerificationProvider`, which never does I/O.
 *
 * _Requirements: 13.1, 18.3_
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock `@/lib/redis` at the module boundary. `isRedisConfigured` is driven
// per-test through a hoisted mutable flag; everything else is a stub that is
// never reached by provider SELECTION or Noop behaviour.
// ---------------------------------------------------------------------------
const r = vi.hoisted(() => ({ redisConfigured: false }));

vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => r.redisConfigured,
  // Stubs so the import graph resolves; unused by these tests.
  TTL: { OTP: 300, OTP_RATE: 60 },
  keys: { otp: (h: string) => `otp:${h}`, otpRate: (h: string) => `otp:rl:${h}` },
  getRedis: () => {
    throw new Error('getRedis should not be called in provider-selection tests');
  },
  cacheGet: async () => null,
  cacheSet: async () => undefined,
}));

import {
  NoopVerificationProvider,
  OtpSmsProvider,
  TwilioVerifyProvider,
  getVerificationProvider,
  isVerificationConfigured,
  resetVerificationProvider,
  type VerificationProvider,
} from '@/lib/verification/provider';

// Env keys this suite mutates; snapshot + restore around every test.
const ENV_KEYS = [
  'TWILIO_VERIFY_SERVICE_SID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE_SID',
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) original[k] = process.env[k];
  // Start every case from a known-empty baseline.
  for (const k of ENV_KEYS) delete process.env[k];
  r.redisConfigured = false;
  resetVerificationProvider();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  r.redisConfigured = false;
  resetVerificationProvider();
});

/** Configure the full SMS trio with non-placeholder values. */
function setSmsConfigured(): void {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test_account_sid';
  process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
  process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test_messaging_sid';
}

// ---------------------------------------------------------------------------
// Provider selection by config
// ---------------------------------------------------------------------------
describe('getVerificationProvider — selection by config', () => {
  it('returns a TwilioVerifyProvider when a non-placeholder Verify SID is set', () => {
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA0123456789abcdef0123456789abcdef';
    // Verify path needs neither SMS nor Redis.
    expect(getVerificationProvider()).toBeInstanceOf(TwilioVerifyProvider);
  });

  it('returns an OtpSmsProvider when Verify is unset but SMS + Redis are configured', () => {
    setSmsConfigured();
    r.redisConfigured = true;
    expect(getVerificationProvider()).toBeInstanceOf(OtpSmsProvider);
  });

  it('returns a NoopVerificationProvider when nothing is configured', () => {
    // No Verify SID, no SMS, no Redis.
    expect(getVerificationProvider()).toBeInstanceOf(NoopVerificationProvider);
  });

  it('falls back to Noop when SMS is configured but Redis is NOT', () => {
    setSmsConfigured();
    r.redisConfigured = false;
    expect(getVerificationProvider()).toBeInstanceOf(NoopVerificationProvider);
  });

  it('falls back to Noop when Redis is configured but SMS is NOT', () => {
    r.redisConfigured = true;
    expect(getVerificationProvider()).toBeInstanceOf(NoopVerificationProvider);
  });

  it('treats a placeholder Verify SID as not configured', () => {
    // The `isSet` convention classifies `…replace_me` / `your-…` as unset.
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_replace_me';
    expect(getVerificationProvider()).toBeInstanceOf(NoopVerificationProvider);
  });

  it('caches the selected provider until reset', () => {
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA0123456789abcdef0123456789abcdef';
    const first = getVerificationProvider();
    // Change config WITHOUT resetting: the cached instance must persist.
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    const second = getVerificationProvider();
    expect(second).toBe(first);

    // After reset, selection re-runs against the current (empty) config.
    resetVerificationProvider();
    expect(getVerificationProvider()).toBeInstanceOf(NoopVerificationProvider);
  });
});

// ---------------------------------------------------------------------------
// Noop behaviour — never throws, always a `not_configured` envelope
// ---------------------------------------------------------------------------
describe('NoopVerificationProvider', () => {
  it('startPhoneVerification resolves to a not_configured envelope', async () => {
    const provider: VerificationProvider = new NoopVerificationProvider();
    const res = await provider.startPhoneVerification({ phoneE164: '+14155552671' });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ ok: false, reason: 'not_configured' });
    // A user-safe message is present and leaks no provider internals.
    expect(res.ok === false && typeof res.message === 'string' && res.message.length > 0).toBe(
      true
    );
  });

  it('checkPhoneVerification resolves to a not_configured envelope', async () => {
    const provider: VerificationProvider = new NoopVerificationProvider();
    const res = await provider.checkPhoneVerification({
      phoneE164: '+14155552671',
      code: '123456',
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ ok: false, reason: 'not_configured' });
  });

  it('does not throw from either method', async () => {
    const provider: VerificationProvider = new NoopVerificationProvider();
    await expect(
      provider.startPhoneVerification({ phoneE164: '+14155552671' })
    ).resolves.toBeDefined();
    await expect(
      provider.checkPhoneVerification({ phoneE164: '+14155552671', code: '000000' })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// isVerificationConfigured()
// ---------------------------------------------------------------------------
describe('isVerificationConfigured', () => {
  it('is true when a non-placeholder Verify SID is set (Redis/SMS irrelevant)', () => {
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA0123456789abcdef0123456789abcdef';
    expect(isVerificationConfigured()).toBe(true);
  });

  it('is true when SMS + Redis are both configured (no Verify SID)', () => {
    setSmsConfigured();
    r.redisConfigured = true;
    expect(isVerificationConfigured()).toBe(true);
  });

  it('is false when SMS is configured but Redis is not', () => {
    setSmsConfigured();
    r.redisConfigured = false;
    expect(isVerificationConfigured()).toBe(false);
  });

  it('is false when Redis is configured but SMS is not', () => {
    r.redisConfigured = true;
    expect(isVerificationConfigured()).toBe(false);
  });

  it('is false when nothing is configured', () => {
    expect(isVerificationConfigured()).toBe(false);
  });

  it('treats a placeholder Verify SID as not configured', () => {
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_replace_me';
    // Placeholder reads as unset, and with no SMS/Redis the whole thing is false.
    expect(isVerificationConfigured()).toBe(false);
  });
});
