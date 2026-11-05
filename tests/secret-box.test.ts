import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSecretBoxConfigured, openSecret, sealSecret } from '@/lib/crypto/secret-box';

const KEY = 'a'.repeat(64);

describe('secret box', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.PAYMENT_KEYS_SECRET;
    process.env.PAYMENT_KEYS_SECRET = KEY;
  });
  afterEach(() => {
    process.env.PAYMENT_KEYS_SECRET = prev;
  });

  it('round-trips and never stores the plain value', () => {
    const sealed = sealSecret('rk_live_abc123');
    expect(sealed).not.toContain('rk_live');
    expect(openSecret(sealed)).toBe('rk_live_abc123');
    expect(sealSecret('x')).not.toBe(sealSecret('x'));
  });

  it('rejects tampered data', () => {
    const sealed = sealSecret('secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => openSecret(parts.join('.'))).toThrow();
  });

  it('is off without a valid key', () => {
    process.env.PAYMENT_KEYS_SECRET = '';
    expect(isSecretBoxConfigured()).toBe(false);
    expect(() => sealSecret('x')).toThrow();
  });
});
