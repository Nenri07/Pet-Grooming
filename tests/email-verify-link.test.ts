/**
 * Unit tests for the email-verify-link bugfix.
 *
 * Covers the pure confirm-flow helpers in `src/lib/verification/email-confirm-flow.ts`
 * and the replay handling in `confirmEmailVerification` (hermetic: next-auth,
 * Mongo, and Redis are mocked with in-memory stores).
 *
 * Validates: Requirements 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredUser = { _id: string; email: string; emailVerifiedAt?: Date | null };

const h = vi.hoisted(() => ({
  users: [] as Array<{ _id: string; email: string; emailVerifiedAt?: Date | null }>,
  writes: [] as unknown[],
  redis: new Map<string, unknown>(),
  redisConfigured: true,
  session: null as null | { user: { id: string } },
}));

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }));
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }));
vi.mock('@/lib/db/connect', () => ({ connectDB: async () => undefined }));
vi.mock('@/lib/db/models/user', () => {
  const query = <T,>(rows: () => T) => {
    const q = {
      select: () => q,
      limit: () => q,
      lean: async () => rows(),
    };
    return q;
  };
  return {
    User: {
      findById: (id: unknown) =>
        query(() => {
          const u = h.users.find((x: StoredUser) => x._id === String(id));
          return u ? { ...u } : null;
        }),
      findOne: (filter: { email?: string }) =>
        query(() => {
          const u = h.users.find((x: StoredUser) => x.email === filter.email);
          return u ? { ...u } : null;
        }),
      find: (filter: { email?: string | RegExp }) =>
        query(() =>
          h.users
            .filter((x: StoredUser) =>
              filter.email instanceof RegExp ? filter.email.test(x.email) : x.email === filter.email
            )
            .map((x: StoredUser) => ({ ...x }))
        ),
      updateOne: async (
        filter: { _id?: unknown },
        update: { $set?: Partial<StoredUser> }
      ) => {
        h.writes.push({ filter, update });
        const u = h.users.find((x: StoredUser) => x._id === String(filter?._id));
        if (u && update?.$set) Object.assign(u, update.$set);
        return { matchedCount: u ? 1 : 0, modifiedCount: u ? 1 : 0 };
      },
    },
  };
});
vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => h.redisConfigured,
  TTL: { EMAIL_VERIFY: 1800, EMAIL_VERIFY_RESEND: 60 },
  keys: {
    emailVerify: (token: string) => `evf:${token}`,
    emailVerifyResend: (e: string) => `evf:rl:${e}`,
  },
  cacheGet: async (key: string) => (h.redis.has(key) ? h.redis.get(key) : null),
  cacheSet: async (key: string, value: unknown) => {
    h.redis.set(key, value);
  },
  cacheDel: async (key: string) => {
    h.redis.delete(key);
  },
  getRedis: () => {
    throw new Error('getRedis is not used by confirmEmailVerification');
  },
}));
vi.mock('@/lib/email/send', () => ({ sendEmailVerification: async () => false }));
vi.mock('@/lib/verification/provider', () => ({
  getVerificationProvider: () => {
    throw new Error('provider is not used by confirmEmailVerification');
  },
}));

import { confirmEmailVerification } from '@/actions/verification';
import { canonicalEmailFilter, normalizeEmail, pickCanonicalMatch } from '@/lib/identity/email';
import {
  MSG_CLIENT_UNEXPECTED,
  MSG_MISSING_TOKEN,
  MSG_SUCCESS,
  claimConfirm,
  isWellFormedVerifyToken,
  runEmailConfirm,
  type ConfirmResult,
  type EmailConfirmDeps,
  type Phase,
} from '@/lib/verification/email-confirm-flow';

const TOKEN = 'a'.repeat(64);

function makeDeps(overrides: Partial<EmailConfirmDeps> = {}) {
  const phases: Phase[] = [];
  const navigations: string[] = [];
  const deps = {
    confirm: vi.fn<(input: { token: string }) => Promise<ConfirmResult>>(async () => ({
      ok: true as const,
      message: 'Email verified.',
    })),
    refreshSession: vi.fn(async () => undefined),
    navigate: vi.fn((href: string) => {
      navigations.push(href);
    }),
    isActive: vi.fn(() => true),
    setPhase: vi.fn((p: Phase) => {
      phases.push(p);
    }),
    ...overrides,
  };
  return { deps, phases, navigations };
}

describe('runEmailConfirm', () => {
  it('on success: confirms once, sets success, refreshes once, navigates to /onboarding', async () => {
    const { deps, phases, navigations } = makeDeps();
    await runEmailConfirm(TOKEN, deps);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledWith({ token: TOKEN });
    expect(phases).toEqual([{ kind: 'success', message: MSG_SUCCESS }]);
    expect(deps.refreshSession).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual(['/onboarding']);
  });

  it('still navigates when refreshSession rejects', async () => {
    const { deps, phases, navigations } = makeDeps({
      refreshSession: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    await expect(runEmailConfirm(TOKEN, deps)).resolves.toBeUndefined();
    expect(phases).toEqual([{ kind: 'success', message: MSG_SUCCESS }]);
    expect(navigations).toEqual(['/onboarding']);
  });

  it('shows the server message on an error envelope and does not navigate', async () => {
    const { deps, phases, navigations } = makeDeps({
      confirm: vi.fn(async () => ({ ok: false as const, message: 'Link invalid.' })),
    });
    await runEmailConfirm(TOKEN, deps);
    expect(phases).toEqual([{ kind: 'error', message: 'Link invalid.' }]);
    expect(deps.refreshSession).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
  });

  it('shows the generic message when confirm throws', async () => {
    const { deps, phases } = makeDeps({
      confirm: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(runEmailConfirm(TOKEN, deps)).resolves.toBeUndefined();
    expect(phases).toEqual([{ kind: 'error', message: MSG_CLIENT_UNEXPECTED }]);
  });

  it('suppresses navigation when isActive() is false', async () => {
    const { deps, phases, navigations } = makeDeps({ isActive: vi.fn(() => false) });
    await runEmailConfirm(TOKEN, deps);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(phases).toEqual([]);
    expect(navigations).toEqual([]);
  });

  it.each(['', '   ', '\t\n'])('missing token %j: error phase, confirm never called', async (t) => {
    const { deps, phases } = makeDeps();
    await runEmailConfirm(t, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(phases).toEqual([{ kind: 'error', message: MSG_MISSING_TOKEN }]);
  });
});

describe('claimConfirm', () => {
  it('claims a token once, rejects repeats, and accepts a new token', () => {
    const guard = { current: null as string | null };
    expect(claimConfirm(guard, 'tok-a')).toBe(true);
    expect(claimConfirm(guard, 'tok-a')).toBe(false);
    expect(claimConfirm(guard, 'tok-a')).toBe(false);
    expect(claimConfirm(guard, 'tok-b')).toBe(true);
    expect(guard.current).toBe('tok-b');
  });

  it('Strict Mode mount → cleanup → mount plus a dependency change confirms once and ends in success', async () => {
    // Simulates the fixed wiring: refs survive the simulated remount.
    const guard = { current: null as string | null };
    const mounted = { current: false };
    let resolveConfirm: (r: ConfirmResult) => void = () => {};
    const { deps, phases, navigations } = makeDeps({
      confirm: vi.fn(
        () =>
          new Promise<ConfirmResult>((resolve) => {
            resolveConfirm = resolve;
          }),
      ),
      isActive: () => mounted.current && guard.current === TOKEN,
    });

    const pending: Promise<void>[] = [];
    const effect = () => {
      if (!claimConfirm(guard, TOKEN)) return;
      pending.push(runEmailConfirm(TOKEN, deps));
    };

    // mount
    mounted.current = true;
    effect();
    // Strict Mode cleanup + remount
    mounted.current = false;
    mounted.current = true;
    effect();
    // dependency change re-run (e.g. session finished loading)
    effect();

    resolveConfirm({ ok: true, message: 'Email verified.' });
    await Promise.all(pending);

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(phases.at(-1)).toEqual({ kind: 'success', message: MSG_SUCCESS });
    expect(deps.refreshSession).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual(['/onboarding']);
  });
});

describe('isWellFormedVerifyToken', () => {
  it('accepts 64 lowercase hex characters', () => {
    expect(isWellFormedVerifyToken('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['63 chars', 'a'.repeat(63)],
    ['65 chars', 'a'.repeat(65)],
    ['uppercase', 'A'.repeat(64)],
    ['non-hex', 'g'.repeat(64)],
  ])('rejects %s', (_label, t) => {
    expect(isWellFormedVerifyToken(t)).toBe(false);
  });
});

describe('confirmEmailVerification replay handling', () => {
  // Copied from `src/actions/verification.ts` (not exported there).
  const MSG_EMAIL_VERIFIED = 'Your email address has been verified.';
  const MSG_EMAIL_LINK_INVALID =
    'That verification link is invalid or has expired. Please request a new one.';
  const MSG_EMAIL_NOT_CONFIGURED =
    "Email verification isn't available right now. Please try again later.";
  const EXPIRED = { ok: false, reason: 'expired', message: MSG_EMAIL_LINK_INVALID };
  const verifiedAt = new Date('2024-01-01T00:00:00Z');

  beforeEach(() => {
    h.users = [];
    h.writes = [];
    h.redis = new Map();
    h.redisConfigured = true;
    h.session = null;
  });

  it('verified signed-in user replaying a consumed token: ok:true, no writes', async () => {
    h.users = [{ _id: 'u1', email: 'groomer@example.com', emailVerifiedAt: verifiedAt }];
    h.session = { user: { id: 'u1' } };

    const res = await confirmEmailVerification({ token: TOKEN });

    expect(res).toEqual({ ok: true, message: MSG_EMAIL_VERIFIED });
    expect(h.writes).toHaveLength(0);
    expect(h.users[0].emailVerifiedAt).toBe(verifiedAt);
  });

  it('unauthenticated replay: expired envelope, no writes', async () => {
    h.users = [{ _id: 'u1', email: 'groomer@example.com', emailVerifiedAt: verifiedAt }];

    expect(await confirmEmailVerification({ token: TOKEN })).toEqual(EXPIRED);
    expect(h.writes).toHaveLength(0);
  });

  it('unverified signed-in replay: expired envelope, no writes', async () => {
    h.users = [{ _id: 'u1', email: 'groomer@example.com', emailVerifiedAt: null }];
    h.session = { user: { id: 'u1' } };

    expect(await confirmEmailVerification({ token: TOKEN })).toEqual(EXPIRED);
    expect(h.writes).toHaveLength(0);
  });

  it('malformed token from a verified signed-in user: expired envelope', async () => {
    h.users = [{ _id: 'u1', email: 'groomer@example.com', emailVerifiedAt: verifiedAt }];
    h.session = { user: { id: 'u1' } };

    expect(await confirmEmailVerification({ token: 'abc' })).toEqual(EXPIRED);
    expect(h.writes).toHaveLength(0);
  });

  it('Redis off: not_configured envelope, even for a verified signed-in user', async () => {
    h.redisConfigured = false;
    h.users = [{ _id: 'u1', email: 'groomer@example.com', emailVerifiedAt: verifiedAt }];
    h.session = { user: { id: 'u1' } };

    expect(await confirmEmailVerification({ token: TOKEN })).toEqual({
      ok: false,
      reason: 'not_configured',
      message: MSG_EMAIL_NOT_CONFIGURED,
    });
    expect(h.writes).toHaveLength(0);
  });
});

describe('confirmEmailVerification canonical no-session lookup', () => {
  const MSG_EMAIL_VERIFIED = 'Your email address has been verified.';
  const MSG_EMAIL_LINK_INVALID =
    'That verification link is invalid or has expired. Please request a new one.';

  beforeEach(() => {
    h.users = [];
    h.writes = [];
    h.redis = new Map();
    h.redisConfigured = true;
    h.session = null;
  });

  it('Gmail alias with no session: owner verified and token deleted', async () => {
    h.users = [
      { _id: 'u0', email: 'someone@gmail.com', emailVerifiedAt: null },
      { _id: 'u1', email: 'first.last+promo@googlemail.com', emailVerifiedAt: null },
    ];
    h.redis.set(`evf:${TOKEN}`, { normalizedEmail: 'firstlast@gmail.com' });

    const res = await confirmEmailVerification({ token: TOKEN });

    expect(res).toEqual({ ok: true, message: MSG_EMAIL_VERIFIED });
    expect(h.users[1].emailVerifiedAt).toBeInstanceOf(Date);
    expect(h.users[0].emailVerifiedAt).toBeNull();
    expect(h.writes).toHaveLength(1);
    expect(h.redis.has(`evf:${TOKEN}`)).toBe(false);
  });

  it('ambiguous canonical email: invalid_code, no writes, token kept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.users = [
      { _id: 'u1', email: 'ab@gmail.com', emailVerifiedAt: null },
      { _id: 'u2', email: 'a.b@gmail.com', emailVerifiedAt: null },
    ];
    h.redis.set(`evf:${TOKEN}`, { normalizedEmail: 'ab@gmail.com' });

    const res = await confirmEmailVerification({ token: TOKEN });

    expect(res).toEqual({ ok: false, reason: 'invalid_code', message: MSG_EMAIL_LINK_INVALID });
    expect(h.writes).toHaveLength(0);
    expect(h.users.every((u) => !u.emailVerifiedAt)).toBe(true);
    expect(h.redis.has(`evf:${TOKEN}`)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[verification] confirmEmailVerification: ambiguous canonical email match, refusing'
    );
    warn.mockRestore();
  });
});

describe('canonicalEmailFilter', () => {
  function gmailFilter(normalized: string): RegExp {
    const f = canonicalEmailFilter(normalized);
    expect(f).toBeInstanceOf(RegExp);
    return f as RegExp;
  }

  it.each([
    ['first.last@gmail.com', 'firstlast@gmail.com'],
    ['name+tag@gmail.com', 'name@gmail.com'],
    ['name@googlemail.com', 'name@gmail.com'],
    ['n.a.m.e+x@googlemail.com', 'name@gmail.com'],
    ['n..a.m.e.@gmail.com', 'name@gmail.com'],
    ['name.+x.y@gmail.com', 'name@gmail.com'],
    ['name@gmail.com', 'name@gmail.com'],
  ])('alias %s matches the filter for %s', (stored, canonical) => {
    expect(normalizeEmail(stored)).toBe(canonical);
    expect(gmailFilter(canonical).test(stored)).toBe(true);
  });

  it.each([
    'namex@gmail.com',
    'nam@gmail.com',
    'xname@gmail.com',
    'name@gmail.co',
    'name@evilgmail.com',
    'name@gmail.com.evil.com',
    'name@yahoo.com',
  ])('near-miss %s does not match the filter for name@gmail.com', (stored) => {
    expect(normalizeEmail(stored)).not.toBe('name@gmail.com');
    expect(gmailFilter('name@gmail.com').test(stored)).toBe(false);
  });

  it.each(['a*b', 'a(b)', 'a$b', 'a[b]', 'a\\b', 'a^b'])(
    'escapes regex metacharacters in local part %s',
    (local) => {
      const re = gmailFilter(`${local}@gmail.com`);
      expect(re.test(`${local}@gmail.com`)).toBe(true);
      expect(re.test(`${local}+tag@googlemail.com`)).toBe(true);
      expect(re.test('ab@gmail.com')).toBe(false);
      expect(re.test('aab@gmail.com')).toBe(false);
      expect(re.test('b@gmail.com')).toBe(false);
    }
  );

  it('returns the exact string for non-Gmail, empty-local, and malformed inputs', () => {
    expect(canonicalEmailFilter('a.b+x@fastmail.com')).toBe('a.b+x@fastmail.com');
    expect(canonicalEmailFilter('groomer@example.com')).toBe('groomer@example.com');
    expect(canonicalEmailFilter('@gmail.com')).toBe('@gmail.com');
    expect(canonicalEmailFilter('plainaddress')).toBe('plainaddress');
  });
});

describe('pickCanonicalMatch', () => {
  it('returns the single canonical match', () => {
    const owner = { _id: 'u1', email: 'first.last@gmail.com' };
    const res = pickCanonicalMatch(
      [{ _id: 'u0', email: 'someone@gmail.com' }, owner],
      'firstlast@gmail.com'
    );
    expect(res).toEqual({ kind: 'one', user: owner });
  });

  it('returns ambiguous for two accounts sharing a canonical email', () => {
    const res = pickCanonicalMatch(
      [
        { _id: 'u1', email: 'ab@gmail.com' },
        { _id: 'u2', email: 'a.b@gmail.com' },
      ],
      'ab@gmail.com'
    );
    expect(res).toEqual({ kind: 'ambiguous' });
  });

  it('returns none when no candidate canonicalizes to the email', () => {
    expect(pickCanonicalMatch([], 'ab@gmail.com')).toEqual({ kind: 'none' });
    expect(
      pickCanonicalMatch([{ _id: 'u1', email: 'abc@gmail.com' }, { _id: 'u2' }], 'ab@gmail.com')
    ).toEqual({ kind: 'none' });
  });
});
