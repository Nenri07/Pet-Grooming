import { describe, expect, it } from 'vitest';
import {
  buildResetLink,
  hashResetToken,
  isWellFormedResetToken,
  newResetToken,
} from '@/lib/password-reset';
import { resolveRedirect } from '@/middleware';

describe('password reset helpers', () => {
  it('generates 64-char lowercase hex tokens that are unique', () => {
    const a = newResetToken();
    const b = newResetToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(isWellFormedResetToken(a)).toBe(true);
  });

  it.each(['', 'abc', 'G'.repeat(64), 'a'.repeat(63), 'A'.repeat(64), null, undefined, 42])(
    'rejects malformed token %p',
    (bad) => {
      expect(isWellFormedResetToken(bad)).toBe(false);
    }
  );

  it('hashes deterministically and never returns the token itself', () => {
    const t = newResetToken();
    expect(hashResetToken(t)).toBe(hashResetToken(t));
    expect(hashResetToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(t)).not.toBe(t);
  });

  it('builds a link under the base URL, tolerating trailing slashes', () => {
    const t = 'a'.repeat(64);
    expect(buildResetLink('https://x.app', t)).toBe(`https://x.app/reset-password?token=${t}`);
    expect(buildResetLink('https://x.app///', t)).toBe(`https://x.app/reset-password?token=${t}`);
  });
});

describe('reset pages are reachable while signed out', () => {
  it.each(['/forgot-password', '/reset-password'])('%s is not bounced to login', (pathname) => {
    expect(
      resolveRedirect({
        pathname,
        isAuthenticated: false,
        onboardingComplete: undefined,
        emailVerified: undefined,
      })
    ).toBeNull();
  });
});
