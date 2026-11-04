/**
 * Email verify link fails — property tests (bugfix spec `email-verify-link-fails`).
 *
 * HERMETIC: no Mongo, no Redis, no network. Module seams are mocked with
 * in-memory stores, following `tests/verification-provider.test.ts` and
 * `tests/stripe-connect.test.ts`:
 *   - `next-auth`              → `getServerSession` returns the per-case session
 *   - `@/lib/auth/config`      → inert `authOptions`
 *   - `@/lib/db/connect`       → no-op `connectDB`
 *   - `@/lib/db/models/user`   → in-memory `User` array with chainable
 *                                `.select().lean()` / `.select().limit().lean()`
 *                                queries; `email` filters accept a string OR a RegExp
 *   - `@/lib/redis`            → in-memory Map behind `cacheGet/cacheSet/cacheDel`
 *   - `@/lib/email/send`, `@/lib/verification/provider` → inert stubs
 *
 * Client harness: every simulation of the `/verify-email` confirm effect goes
 * through ONE adapter, {@link effectUnderTest}. It mirrors the fixed
 * `VerifyEmailClient` wiring (ref guard via `claimConfirm`, `update`/`router`
 * read through refs, confirm deps `[token]`, `runEmailConfirm`). It originally
 * reproduced the unfixed effect; the assertions below did not change.
 * {@link ComponentHarness} is a tiny model of React's effect semantics
 * (dependency comparison with `Object.is`, cleanup-before-rerun, Strict Mode
 * mount → cleanup → mount, refs preserved across re-runs and remounts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// In-memory stores shared with the hoisted vi.mock factories.
// ---------------------------------------------------------------------------
type StoredUser = { _id: string; email: string; emailVerifiedAt?: Date | null };

const h = vi.hoisted(() => ({
  users: [] as Array<{ _id: string; email: string; emailVerifiedAt?: Date | null }>,
  writes: [] as Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }>,
  redis: new Map<string, unknown>(),
  redisConfigured: true,
  session: null as null | { user: { id: string } },
}));

vi.mock('next-auth', () => ({
  getServerSession: async () => h.session,
}));

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }));

vi.mock('@/lib/db/connect', () => ({ connectDB: async () => undefined }));

vi.mock('@/lib/db/models/user', () => {
  type Filter = { _id?: unknown; email?: string | RegExp };

  function matches(u: StoredUser, filter: Filter): boolean {
    if (filter._id !== undefined && String(filter._id) !== u._id) return false;
    if (filter.email !== undefined) {
      if (filter.email instanceof RegExp) {
        filter.email.lastIndex = 0;
        if (!filter.email.test(u.email)) return false;
      } else if (filter.email !== u.email) {
        return false;
      }
    }
    return true;
  }

  /** Chainable, thenable query over the in-memory array. */
  class Query<T> {
    private n: number | undefined;
    constructor(
      private readonly rows: () => StoredUser[],
      private readonly single: boolean
    ) {}
    select(): this {
      return this;
    }
    limit(n: number): this {
      this.n = n;
      return this;
    }
    private exec(): T {
      let rows = this.rows().map((u) => ({ ...u }));
      if (this.n !== undefined) rows = rows.slice(0, this.n);
      return (this.single ? (rows[0] ?? null) : rows) as T;
    }
    lean<R = T>(): Promise<R> {
      return Promise.resolve(this.exec() as unknown as R);
    }
    then<A, B>(
      onFulfilled?: (v: T) => A | PromiseLike<A>,
      onRejected?: (e: unknown) => B | PromiseLike<B>
    ): Promise<A | B> {
      return Promise.resolve(this.exec()).then(onFulfilled, onRejected);
    }
  }

  const User = {
    findById: (id: unknown) =>
      new Query<StoredUser | null>(() => h.users.filter((u) => u._id === String(id)), true),
    findOne: (filter: Filter) =>
      new Query<StoredUser | null>(() => h.users.filter((u) => matches(u, filter)), true),
    find: (filter: Filter) =>
      new Query<StoredUser[]>(() => h.users.filter((u) => matches(u, filter)), false),
    updateOne: async (filter: Filter, update: { $set?: Partial<StoredUser> }) => {
      h.writes.push({
        filter: filter as Record<string, unknown>,
        update: update as Record<string, unknown>,
      });
      const target = h.users.find((u) => matches(u, filter));
      if (target && update.$set) Object.assign(target, update.$set);
      return { matchedCount: target ? 1 : 0, modifiedCount: target ? 1 : 0 };
    },
  };
  return { User };
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

import {
  confirmEmailVerification,
  type ConfirmEmailVerificationResult,
} from '@/actions/verification';
import { canonicalEmailFilter, normalizeEmail, pickCanonicalMatch } from '@/lib/identity/email';
import { User } from '@/lib/db/models/user';
import { claimConfirm, runEmailConfirm } from '@/lib/verification/email-confirm-flow';

// ---------------------------------------------------------------------------
// Client effect adapter (the ONLY place the confirm effect is reproduced).
// ---------------------------------------------------------------------------
type Phase =
  | { kind: 'verifying' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

// Copied verbatim from the original `VerifyEmailClient.tsx` copy (now exported
// by `@/lib/verification/email-confirm-flow`); kept literal to pin the text.
const MSG_SUCCESS = 'Your email is verified — you can close this tab and continue.';
const MSG_MISSING_TOKEN =
  'This verification link is missing its token. Please request a new one.';

interface HookEnv {
  confirm: (input: { token: string }) => Promise<ConfirmEmailVerificationResult>;
  update: () => Promise<unknown>;
  router: { push: (href: string) => void };
  setPhase: (p: Phase) => void;
  /** React `useRef`: identity-stable per component instance, by call order. */
  useRef: <T>(initial: T) => { current: T };
}

interface EffectSpec {
  /** `undefined` = no dependency array (runs after every render). */
  deps: readonly unknown[] | undefined;
  setup: () => void | (() => void);
}

/**
 * FIXED wiring: mirrors `VerifyEmailClient` — refs created in the same order,
 * then effects in the same order with the same deps: mount flag `[]`, ref sync
 * (no deps), confirm `[token]` guarded by `claimConfirm`.
 */
function effectUnderTest(token: string, env: HookEnv): EffectSpec[] {
  const { update, router, setPhase } = env;
  const confirmedTokenRef = env.useRef<string | null>(null);
  const mountedRef = env.useRef(false);
  const updateRef = env.useRef(update);
  const routerRef = env.useRef(router);
  return [
    {
      deps: [],
      setup: () => {
        mountedRef.current = true;
        return () => {
          mountedRef.current = false;
        };
      },
    },
    {
      deps: undefined,
      setup: () => {
        updateRef.current = update;
        routerRef.current = router;
      },
    },
    {
      deps: [token],
      setup: () => {
        if (!claimConfirm(confirmedTokenRef, token)) return;
        void runEmailConfirm(token, {
          confirm: env.confirm,
          refreshSession: () => updateRef.current(),
          navigate: (href) => routerRef.current.push(href),
          isActive: () => mountedRef.current && confirmedTokenRef.current === token,
          setPhase,
        });
      },
    },
  ];
}

/** Minimal model of React effect semantics for one component instance. */
class ComponentHarness {
  private refs: Array<{ current: unknown }> = [];
  private refIdx = 0;
  private committed: Array<{ deps: readonly unknown[] | undefined; cleanup?: () => void }> = [];
  private last: EffectSpec[] = [];

  constructor(private readonly token: string) {}

  /** Render + commit: re-run only effects whose deps changed (or have none). */
  render(env: Omit<HookEnv, 'useRef'>): void {
    this.refIdx = 0;
    const effects = effectUnderTest(this.token, {
      ...env,
      useRef: <T,>(initial: T) => {
        const i = this.refIdx++;
        if (!this.refs[i]) this.refs[i] = { current: initial };
        return this.refs[i] as { current: T };
      },
    });
    const changed = effects.map((e, i) => {
      const prev = this.committed[i];
      return !prev || e.deps === undefined || !depsEqual(prev.deps, e.deps);
    });
    changed.forEach((c, i) => {
      if (c) this.committed[i]?.cleanup?.();
    });
    effects.forEach((e, i) => {
      if (changed[i]) this.commit(i, e);
    });
    this.last = effects;
  }

  /** Strict Mode: simulated unmount (all cleanups) then remount (all setups). */
  strictRemount(): void {
    this.committed.forEach((c) => c.cleanup?.());
    this.last.forEach((e, i) => this.commit(i, e));
  }

  private commit(i: number, e: EffectSpec): void {
    const cleanup = e.setup();
    this.committed[i] = {
      deps: e.deps,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined,
    };
  }
}

function depsEqual(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
const tokenArb = fc.stringMatching(/^[0-9a-f]{64}$/);

// Reused from tests/properties/email.test.ts (Gmail base local, dots, tag, host).
const gmailBaseLocalArb = fc.stringMatching(/^[a-z0-9]{1,20}$/);

function withDots(base: string, cuts: readonly number[]): string {
  if (base.length <= 1) return base;
  const positions = Array.from(
    new Set(
      cuts.map(
        (c) => 1 + (((c % (base.length - 1)) + (base.length - 1)) % (base.length - 1))
      )
    )
  ).sort((a, b) => a - b);
  let out = '';
  let prev = 0;
  for (const p of positions) {
    out += base.slice(prev, p) + '.';
    prev = p;
  }
  out += base.slice(prev);
  return out;
}

const dotsArb = fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 6 });
const tagArb = fc.option(fc.stringMatching(/^[a-z0-9]{1,10}$/), { nil: null });
const gmailHostArb = fc.constantFrom('gmail.com', 'googlemail.com');

/** A stored Gmail alias whose stored form differs from its canonical form. */
const gmailAliasArb = fc
  .tuple(gmailBaseLocalArb, dotsArb, tagArb, gmailHostArb)
  .map(([base, cuts, tag, host]) => `${withDots(base, cuts)}${tag ? `+${tag}` : ''}@${host}`)
  .filter((alias) => alias !== normalizeEmail(alias) && !alias.startsWith('.'));

/** Other stored accounts (plain, already-lowercased). */
const otherEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,12}$/),
    fc.constantFrom('example.com', 'fastmail.com', 'gmail.com')
  )
  .map(([l, d]) => `${l}@${d}`);

/** Events that re-run the confirm effect before the first confirm resolves. */
const rerunEventArb = fc.oneof(
  fc.record({ kind: fc.constant('depChange' as const), router: fc.boolean() }),
  fc.record({ kind: fc.constant('strictRemount' as const) })
);

function resetStores(): void {
  h.users = [];
  h.writes = [];
  h.redis = new Map();
  h.redisConfigured = true;
  h.session = null;
}

beforeEach(resetStores);

// ---------------------------------------------------------------------------
// Property 1: Bug Condition — verification link succeeds once and stays successful
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4
// ---------------------------------------------------------------------------
describe('Property 1: Bug Condition - verification link succeeds once and stays successful', () => {
  /**
   * effectRerun: fresh token, signed-in owner, confirm effect runs 2–5 times
   * (dependency changes and Strict Mode remounts) before the first confirm
   * resolves.
   * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
   */
  it('effectRerun: one confirm, success phase, one refresh, one navigation to /onboarding', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        fc.array(rerunEventArb, { minLength: 1, maxLength: 4 }),
        async (token, events) => {
          resetStores();
          const owner: StoredUser = { _id: 'u_owner', email: 'groomer@example.com' };
          h.users = [owner];
          h.session = { user: { id: owner._id } };
          h.redis.set(`evf:${token}`, { normalizedEmail: normalizeEmail(owner.email) });

          // Server actions are serialized by the Next router; model that with a
          // chain that is held until every re-run has been triggered.
          let release!: () => void;
          let chain: Promise<unknown> = new Promise<void>((r) => (release = r));
          const confirmCalls: string[] = [];
          const confirm = (input: { token: string }) => {
            confirmCalls.push(input.token);
            const p = chain.then(() => confirmEmailVerification(input));
            chain = p;
            return p;
          };

          const phases: Phase[] = [];
          let updateCalls = 0;
          const navigations: string[] = [];
          const makeUpdate = () => async () => {
            updateCalls += 1;
            return null;
          };
          const makeRouter = () => ({ push: (href: string) => void navigations.push(href) });

          let update = makeUpdate();
          let router = makeRouter();
          const setPhase = (p: Phase) => void phases.push(p);

          const harness = new ComponentHarness(token);
          harness.render({ confirm, update, router, setPhase });
          for (const ev of events) {
            if (ev.kind === 'depChange') {
              update = makeUpdate(); // session finished loading → new `update`
              if (ev.router) router = makeRouter();
              harness.render({ confirm, update, router, setPhase });
            } else {
              harness.strictRemount();
            }
          }

          release();
          await flush();

          expect(confirmCalls).toHaveLength(1);
          expect(phases.at(-1)?.kind).toBe('success');
          expect(updateCalls).toBe(1);
          expect(navigations).toEqual(['/onboarding']);
          expect(h.users[0].emailVerifiedAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 50 }
    );
  }, 60000);

  /**
   * verifiedReplay: consumed (absent) well-formed token, signed-in owner who
   * is already verified.
   * **Validates: Requirements 1.3, 2.3**
   */
  it('verifiedReplay: a verified signed-in owner replaying a consumed token gets ok:true with no writes', async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, otherEmailArb, async (token, email) => {
        resetStores();
        const verifiedAt = new Date('2024-01-01T00:00:00Z');
        h.users = [{ _id: 'u_owner', email, emailVerifiedAt: verifiedAt }];
        h.session = { user: { id: 'u_owner' } };
        // No Redis record: the token was already consumed.

        const res = await confirmEmailVerification({ token });

        expect(res).toMatchObject({ ok: true });
        expect(h.writes).toHaveLength(0);
        expect(h.users[0].emailVerifiedAt).toBe(verifiedAt);
      }),
      { numRuns: 50 }
    );
  });

  async function assertGmailAliasVerified(
    alias: string,
    token: string,
    others: string[],
    sessionKind: 'none' | 'other'
  ): Promise<void> {
    resetStores();
    const canonical = normalizeEmail(alias);
    h.users = [
      { _id: 'u_owner', email: alias },
      ...others.map((email, i) => ({ _id: `u_other_${i}`, email })),
    ];
    const before = h.users.map((u) => ({ ...u }));
    if (sessionKind === 'other' && others.length > 0) {
      h.session = { user: { id: 'u_other_0' } };
    }
    h.redis.set(`evf:${token}`, { normalizedEmail: canonical });

    const res = await confirmEmailVerification({ token });

    expect(res).toMatchObject({ ok: true });
    expect(h.users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect(h.redis.has(`evf:${token}`)).toBe(false);
    for (let i = 1; i < h.users.length; i++) {
      expect(h.users[i]).toEqual(before[i]);
    }
  }

  /**
   * gmailMismatch: fresh token, no session or a different account signed in,
   * stored Gmail alias differs from its canonical form, exactly one canonical
   * match.
   * **Validates: Requirements 1.4, 2.4**
   */
  it('gmailMismatch: the single canonical owner is verified, the token deleted, nobody else changed', async () => {
    await fc.assert(
      fc.asyncProperty(
        gmailAliasArb,
        tokenArb,
        fc.uniqueArray(otherEmailArb, { minLength: 1, maxLength: 4 }),
        fc.constantFrom('none' as const, 'other' as const),
        async (alias, token, rawOthers, sessionKind) => {
          const canonical = normalizeEmail(alias);
          const others = rawOthers.filter(
            (e) => e !== alias && normalizeEmail(e) !== canonical
          );
          await assertGmailAliasVerified(alias, token, others, sessionKind);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('gmailMismatch concrete: first.last@gmail.com and name+promo@googlemail.com', async () => {
    const token = 'a'.repeat(64);
    await assertGmailAliasVerified('first.last@gmail.com', token, ['someone@example.com'], 'none');
    await assertGmailAliasVerified(
      'name+promo@googlemail.com',
      token,
      ['someone@example.com'],
      'other'
    );
  });
});

// ---------------------------------------------------------------------------
// Preservation helpers (Property 2 and Property 3)
// ---------------------------------------------------------------------------

// Copied verbatim from `src/actions/verification.ts` (not exported there).
const MSG_EMAIL_LINK_INVALID =
  'That verification link is invalid or has expired. Please request a new one.';
const MSG_EMAIL_NOT_CONFIGURED =
  "Email verification isn't available right now. Please try again later.";
const MSG_UNEXPECTED = 'Something went wrong. Please try again in a moment.';
const MSG_EMAIL_VERIFIED = 'Your email address has been verified.';

const EXPIRED_ENVELOPE = { ok: false, reason: 'expired', message: MSG_EMAIL_LINK_INVALID };

/** Empty or whitespace-only `?token=` values. */
const blankTokenArb = fc.stringMatching(/^[ \t\r\n]{0,6}$/);

/** Non-empty tokens that are NOT 64 lowercase hex characters (no whitespace). */
const malformedTokenArb = fc.oneof(
  // wrong length
  fc.stringMatching(/^[0-9a-f]{1,63}$/),
  fc.stringMatching(/^[0-9a-f]{65,80}$/),
  // uppercase hex
  fc.stringMatching(/^[0-9a-fA-F]{64}$/).filter((s) => /[A-F]/.test(s)),
  // non-hex characters
  fc.stringMatching(/^[0-9a-z]{64}$/).filter((s) => /[g-z]/.test(s))
);

/** Non-Gmail owner emails (stored lowercased/trimmed, so stored === canonical). */
const nonGmailEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9][a-z0-9._+-]{0,15}$/),
    fc.constantFrom('example.com', 'fastmail.com', 'outlook.com', 'yahoo.com')
  )
  .map(([l, d]) => `${l}@${d}`);

/** Gmail owners already stored in canonical form. */
const canonicalGmailEmailArb = gmailBaseLocalArb.map((l) => `${l}@gmail.com`);

/** Any stored email: non-Gmail, canonical Gmail, or a Gmail alias. */
const anyStoredEmailArb = fc.oneof(nonGmailEmailArb, canonicalGmailEmailArb, gmailAliasArb);

function snapshotUsers(): StoredUser[] {
  return h.users.map((u) => ({ ...u }));
}

// ---------------------------------------------------------------------------
// Property 2: Preservation — non-buggy verification inputs behave as before
//
// Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
// ---------------------------------------------------------------------------
describe('Property 2: Preservation - non-buggy verification inputs behave as before', () => {
  /**
   * Missing or whitespace-only token: missing-token error, no server call.
   * **Validates: Requirements 3.2**
   */
  it('blank token: missing-token error phase, confirm never called', async () => {
    await fc.assert(
      fc.asyncProperty(blankTokenArb, async (token) => {
        resetStores();
        let confirmCalls = 0;
        const confirm = async (input: { token: string }) => {
          confirmCalls += 1;
          return confirmEmailVerification(input);
        };
        const phases: Phase[] = [];
        const navigations: string[] = [];
        const harness = new ComponentHarness(token);
        harness.render({
          confirm,
          update: async () => null,
          router: { push: (href) => void navigations.push(href) },
          setPhase: (p) => void phases.push(p),
        });
        await flush();

        expect(confirmCalls).toBe(0);
        expect(phases).toEqual([{ kind: 'error', message: MSG_MISSING_TOKEN }]);
        expect(navigations).toEqual([]);
      }),
      { numRuns: 30 }
    );
  });

  /**
   * Fresh link, effect runs exactly once, signed-in owner: success, one
   * refresh, one navigation (the path that already worked).
   * **Validates: Requirements 3.5**
   */
  it('single effect run with the owner signed in: success, one refresh, one navigation', async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, nonGmailEmailArb, async (token, email) => {
        resetStores();
        h.users = [{ _id: 'u_owner', email }];
        h.session = { user: { id: 'u_owner' } };
        h.redis.set(`evf:${token}`, { normalizedEmail: normalizeEmail(email) });

        let confirmCalls = 0;
        const confirm = async (input: { token: string }) => {
          confirmCalls += 1;
          return confirmEmailVerification(input);
        };
        const phases: Phase[] = [];
        const navigations: string[] = [];
        let updateCalls = 0;
        const harness = new ComponentHarness(token);
        harness.render({
          confirm,
          update: async () => {
            updateCalls += 1;
            return null;
          },
          router: { push: (href) => void navigations.push(href) },
          setPhase: (p) => void phases.push(p),
        });
        await flush();

        expect(confirmCalls).toBe(1);
        expect(phases).toEqual([{ kind: 'success', message: MSG_SUCCESS }]);
        expect(updateCalls).toBe(1);
        expect(navigations).toEqual(['/onboarding']);
        expect(h.users[0].emailVerifiedAt).toBeInstanceOf(Date);
        expect(h.redis.has(`evf:${token}`)).toBe(false);
      }),
      { numRuns: 30 }
    );
  });

  /**
   * Well-formed token with no Redis record, requested with no session or an
   * unverified session: expired envelope, nothing written.
   * **Validates: Requirements 3.1, 3.4**
   */
  it('absent token from an unauthenticated or unverified requester: expired envelope, no writes', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        anyStoredEmailArb,
        fc.constantFrom('none' as const, 'unverified' as const),
        fc.constantFrom(undefined, null),
        async (token, email, sessionKind, unverifiedValue) => {
          resetStores();
          h.users = [{ _id: 'u_1', email, emailVerifiedAt: unverifiedValue }];
          if (sessionKind === 'unverified') h.session = { user: { id: 'u_1' } };
          const before = snapshotUsers();

          const res = await confirmEmailVerification({ token });

          expect(res).toEqual(EXPIRED_ENVELOPE);
          expect(h.writes).toHaveLength(0);
          expect(h.users).toEqual(before);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Malformed tokens get the expired envelope even for a verified session.
   * **Validates: Requirements 3.1**
   */
  it('malformed token: expired envelope even for a verified signed-in user, no writes', async () => {
    await fc.assert(
      fc.asyncProperty(
        malformedTokenArb,
        anyStoredEmailArb,
        fc.constantFrom('none' as const, 'unverified' as const, 'verified' as const),
        async (token, email, sessionKind) => {
          resetStores();
          const verifiedAt = new Date('2024-01-01T00:00:00Z');
          h.users = [
            {
              _id: 'u_1',
              email,
              emailVerifiedAt: sessionKind === 'verified' ? verifiedAt : null,
            },
          ];
          if (sessionKind !== 'none') h.session = { user: { id: 'u_1' } };
          const before = snapshotUsers();

          const res = await confirmEmailVerification({ token });

          expect(res).toEqual(EXPIRED_ENVELOPE);
          expect(h.writes).toHaveLength(0);
          expect(h.users).toEqual(before);
        }
      ),
      { numRuns: 80 }
    );
  });

  /**
   * Fresh token for a non-Gmail owner or a canonical-form Gmail owner verifies
   * exactly that account on the session and no-session paths, and burns the
   * token. User sets never contain two rows sharing a canonical email.
   * **Validates: Requirements 3.5, 3.6**
   */
  it('fresh token, non-Gmail or canonical Gmail owner: owner verified, token deleted, others untouched', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        fc.oneof(nonGmailEmailArb, canonicalGmailEmailArb),
        fc.uniqueArray(anyStoredEmailArb, { maxLength: 4, selector: normalizeEmail }),
        fc.constantFrom('owner' as const, 'none' as const),
        async (token, ownerEmail, rawOthers, sessionKind) => {
          resetStores();
          const canonical = normalizeEmail(ownerEmail);
          const others = rawOthers.filter((e) => normalizeEmail(e) !== canonical);
          h.users = [
            { _id: 'u_owner', email: ownerEmail },
            ...others.map((email, i) => ({ _id: `u_other_${i}`, email })),
          ];
          if (sessionKind === 'owner') h.session = { user: { id: 'u_owner' } };
          h.redis.set(`evf:${token}`, { normalizedEmail: canonical });
          const before = snapshotUsers();

          const res = await confirmEmailVerification({ token });

          expect(res).toEqual({ ok: true, message: MSG_EMAIL_VERIFIED });
          expect(h.users[0].emailVerifiedAt).toBeInstanceOf(Date);
          expect(h.redis.has(`evf:${token}`)).toBe(false);
          expect(h.writes.every((w) => String(w.filter._id) === 'u_owner')).toBe(true);
          for (let i = 1; i < h.users.length; i++) {
            expect(h.users[i]).toEqual(before[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Redis unconfigured: not_configured envelope, checked before any token or
   * replay logic.
   * **Validates: Requirements 3.7**
   */
  it('Redis unconfigured: not_configured envelope for any non-blank token and session', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(tokenArb, malformedTokenArb),
        fc.boolean(),
        fc.constantFrom('none' as const, 'unverified' as const, 'verified' as const),
        async (token, hasRecord, sessionKind) => {
          resetStores();
          h.redisConfigured = false;
          h.users = [
            {
              _id: 'u_1',
              email: 'groomer@example.com',
              emailVerifiedAt: sessionKind === 'verified' ? new Date('2024-01-01') : null,
            },
          ];
          if (sessionKind !== 'none') h.session = { user: { id: 'u_1' } };
          if (hasRecord) h.redis.set(`evf:${token}`, { normalizedEmail: 'groomer@example.com' });

          const res = await confirmEmailVerification({ token });

          expect(res).toEqual({
            ok: false,
            reason: 'not_configured',
            message: MSG_EMAIL_NOT_CONFIGURED,
          });
          expect(h.writes).toHaveLength(0);
          expect(h.redis.has(`evf:${token}`)).toBe(hasRecord);
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * A throwing User model yields the unexpected envelope; the action never
   * throws.
   * **Validates: Requirements 3.8**
   */
  it('throwing User model: "Something went wrong" envelope, no throw', async () => {
    const boom = () => {
      throw new Error('db down');
    };
    const spies = [
      vi.spyOn(User, 'findById').mockImplementation(boom),
      vi.spyOn(User, 'findOne').mockImplementation(boom),
      vi.spyOn(User, 'find').mockImplementation(boom),
      vi.spyOn(User, 'updateOne').mockImplementation(boom),
    ];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await fc.assert(
        fc.asyncProperty(
          tokenArb,
          fc.constantFrom('none' as const, 'session' as const),
          async (token, sessionKind) => {
            resetStores();
            h.users = [{ _id: 'u_1', email: 'groomer@example.com' }];
            if (sessionKind === 'session') h.session = { user: { id: 'u_1' } };
            h.redis.set(`evf:${token}`, { normalizedEmail: 'groomer@example.com' });

            const res = await confirmEmailVerification({ token });

            expect(res).toEqual({ ok: false, reason: 'unexpected', message: MSG_UNEXPECTED });
            expect(h.redis.has(`evf:${token}`)).toBe(true);
          }
        ),
        { numRuns: 20 }
      );
    } finally {
      spies.forEach((s) => s.mockRestore());
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Property 3: Preservation — a token never verifies a different account
//
// Validates: Requirements 3.3
// ---------------------------------------------------------------------------
describe('Property 3: Preservation - a token never verifies a different account', () => {
  /**
   * With a different account signed in, that account is never written, and no
   * account whose canonical email differs from the token's is ever written.
   * **Validates: Requirements 2.4, 3.3, 3.6**
   */
  it('wrong-account session: signed-in account untouched, only canonical matches may be written', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        fc.uniqueArray(anyStoredEmailArb, { minLength: 1, maxLength: 6 }),
        anyStoredEmailArb,
        fc.nat(),
        fc.boolean(),
        async (token, storedEmails, sessionEmail, pick, recordFromStored) => {
          resetStores();
          h.users = storedEmails.map((email, i) => ({ _id: `u_${i}`, email }));
          const recordEmail = recordFromStored
            ? normalizeEmail(storedEmails[pick % storedEmails.length])
            : normalizeEmail(sessionEmail);

          // Signed-in account whose canonical email differs from the token's.
          let sessionUser = h.users.find((u) => normalizeEmail(u.email) !== recordEmail);
          if (!sessionUser) {
            sessionUser = { _id: 'u_session', email: 'session-only@example.com' };
            h.users.push(sessionUser);
          }
          h.session = { user: { id: sessionUser._id } };
          h.redis.set(`evf:${token}`, { normalizedEmail: recordEmail });
          const before = snapshotUsers();

          await confirmEmailVerification({ token });

          const sessionAfter = h.users.find((u) => u._id === sessionUser!._id);
          const sessionBefore = before.find((u) => u._id === sessionUser!._id);
          expect(sessionAfter).toEqual(sessionBefore);
          for (const w of h.writes) {
            const target = before.find((u) => u._id === String(w.filter._id));
            expect(target).toBeDefined();
            expect(target!._id).not.toBe(sessionUser._id);
            expect(normalizeEmail(target!.email)).toBe(recordEmail);
          }
          h.users.forEach((u, i) => {
            if (normalizeEmail(u.email) !== recordEmail) expect(u).toEqual(before[i]);
          });
        }
      ),
      { numRuns: 150 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 (helper level): canonical Gmail lookup helpers
//
// Domain: stored emails are what `User.email` can hold (lowercased, trimmed).
// Local parts mix letters, digits, dots (leading, trailing, consecutive), '+',
// '@', regex metacharacters, a space, and non-ASCII / non-BMP characters.
// Restriction: the canonical email `e` must have a NON-EMPTY local part. The
// canonical form of `+x@gmail.com` or `.@gmail.com` is `@gmail.com`, for which
// `canonicalEmailFilter` deliberately returns the exact string (no alias set
// to search), so the regex equivalence is not claimed there. Stored emails
// starting with '.' are excluded (accepted limitation from design).
//
// Validates: Requirements 2.4, 3.3, 3.6
// ---------------------------------------------------------------------------
describe('Property 3: Preservation - canonical lookup helpers never select a different account', () => {
  const LOCAL_ALPHABET = [
    'a', 'b', 'n', 'z', '0', '9', '.', '.', '+', '@', '-', '_', '*', '(', ')', '$',
    '[', ']', '\\', '^', '?', '{', '}', '|', '/', "'", ' ', 'é', '😀',
  ];
  const localCharArb = fc.constantFrom(...LOCAL_ALPHABET);
  const nonDotPlusCharArb = fc.constantFrom(
    ...LOCAL_ALPHABET.filter((c) => c !== '.' && c !== '+')
  );
  const hostArb = fc.constantFrom(
    'gmail.com',
    'googlemail.com',
    'gmail.co',
    'evilgmail.com',
    'example.com'
  );

  /** Stored `User.email`: lowercased, trimmed, not starting with '.'. */
  const storedEmailArb = fc
    .tuple(fc.array(localCharArb, { minLength: 1, maxLength: 12 }), hostArb)
    .map(([chars, host]) => `${chars.join('')}@${host}`.trim().toLowerCase())
    .filter((s) => !s.startsWith('.'));

  /** Canonical Gmail emails with a non-empty local part. */
  const canonicalGmailArb = fc
    .tuple(fc.array(nonDotPlusCharArb, { minLength: 1, maxLength: 10 }), gmailHostArb)
    .map(([chars, host]) => normalizeEmail(`${chars.join('')}@${host}`))
    .filter((e) => e.endsWith('@gmail.com') && e !== '@gmail.com');

  /** A stored alias of `e`: dots after each char, optional tag, either host. */
  function aliasOf(e: string, dotCounts: number[], tag: string | null, host: string): string {
    const local = Array.from(e.slice(0, e.lastIndexOf('@')))
      .map((c, i) => c + '.'.repeat(dotCounts[i % dotCounts.length] ?? 0))
      .join('');
    return `${local}${tag === null ? '' : `+${tag}`}@${host}`;
  }

  const tagCharsArb = fc.option(
    fc.array(localCharArb, { maxLength: 6 }).map((a) => a.join('')),
    { nil: null }
  );

  const pairArb = canonicalGmailArb.chain((e) =>
    fc.tuple(
      fc.constant(e),
      fc.oneof(
        storedEmailArb,
        fc
          .tuple(
            fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 5 }),
            tagCharsArb,
            gmailHostArb
          )
          .map(([dots, tag, host]) => aliasOf(e, dots, tag, host)),
        // Near-miss: an alias with one extra character appended to the local part.
        fc
          .tuple(nonDotPlusCharArb, gmailHostArb)
          .map(([c, host]) => `${e.slice(0, e.lastIndexOf('@'))}${c}@${host}`)
      )
    )
  );

  /**
   * **Validates: Requirements 2.4, 3.3, 3.6**
   */
  it('canonicalEmailFilter(e).test(s) === (normalizeEmail(s) === e)', () => {
    fc.assert(
      fc.property(pairArb, ([e, s]) => {
        const filter = canonicalEmailFilter(e);
        expect(filter).toBeInstanceOf(RegExp);
        expect((filter as RegExp).test(s)).toBe(normalizeEmail(s) === e);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 2.4, 3.3**
   */
  it('pickCanonicalMatch returns one only for exactly one canonical match, never a non-match', () => {
    const candidateArb = fc.record(
      { id: fc.nat(), email: fc.option(storedEmailArb, { nil: undefined }) },
      { requiredKeys: ['id'] }
    );
    fc.assert(
      fc.property(
        fc.array(candidateArb, { maxLength: 6 }),
        fc.oneof(canonicalGmailArb, storedEmailArb.map(normalizeEmail)),
        fc.nat(),
        fc.boolean(),
        (candidates, randomE, pick, fromCandidate) => {
          const withEmail = candidates.filter((c) => c.email !== undefined);
          const e =
            fromCandidate && withEmail.length > 0
              ? normalizeEmail(withEmail[pick % withEmail.length].email!)
              : randomE;
          const matching = candidates.filter((c) => normalizeEmail(c.email ?? '') === e);
          const res = pickCanonicalMatch(candidates, e);

          if (matching.length === 0) expect(res).toEqual({ kind: 'none' });
          else if (matching.length > 1) expect(res).toEqual({ kind: 'ambiguous' });
          else {
            expect(res.kind).toBe('one');
            if (res.kind === 'one') {
              expect(res.user).toBe(matching[0]);
              expect(normalizeEmail(res.user.email ?? '')).toBe(e);
            }
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});
