import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { canReserve, RESERVATION_TTL_MS } from '@/lib/calendar/reservation';

// Feature: pawport, Property 8: Slot reservation atomicity
//
// For any time slot, if two concurrent booking sessions attempt to reserve the
// same slot, exactly one SHALL succeed and the other SHALL be rejected. A slot
// that is already reserved by a different session within the 10-minute window
// SHALL NOT be reservable.
//
// The reservation decision is exercised through the PURE, DB-free helper
// `canReserve({ existing, sessionId, now })`, where `existing` is
// `{ sessionId: string; expiresAt: Date } | null | undefined`.
//
// Validates: Requirements 6.3, 6.4

/** A time (ms since epoch) used as "now" in the decision. */
const nowMsArb = fc.integer({ min: 0, max: 4_000_000_000_000 });

/** Two distinct session identifiers (A !== B). */
const twoDistinctSessionsArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.string({ minLength: 1, maxLength: 24 })
  )
  .filter(([a, b]) => a !== b);

/** Any non-empty session id. */
const sessionIdArb = fc.string({ minLength: 1, maxLength: 24 });

describe('Feature: pawport, Property 8: Slot reservation atomicity', () => {
  it('exclusivity: an unexpired hold by A blocks any other session B, but A may refresh its own hold', () => {
    fc.assert(
      fc.property(
        twoDistinctSessionsArb,
        nowMsArb,
        // How far in the FUTURE the hold expires (strictly > 0 => unexpired).
        fc.integer({ min: 1, max: RESERVATION_TTL_MS }),
        ([sessionA, sessionB], nowMs, futureMs) => {
          const now = new Date(nowMs);
          const expiresAt = new Date(nowMs + futureMs); // strictly after now => unexpired
          const existing = { sessionId: sessionA, expiresAt };

          // A different session B cannot reserve an unexpired hold owned by A.
          expect(canReserve({ existing, sessionId: sessionB, now })).toBe(false);

          // The owning session A can always re-select / refresh its own hold.
          expect(canReserve({ existing, sessionId: sessionA, now })).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('expiry: an expired hold (expiresAt <= now) is reservable by ANY session', () => {
    fc.assert(
      fc.property(
        sessionIdArb, // the (former) holder
        sessionIdArb, // the requester (may or may not equal the holder)
        nowMsArb,
        // How far in the PAST (or exactly at now) the hold expired: 0 => at now.
        fc.integer({ min: 0, max: RESERVATION_TTL_MS }),
        (holder, requester, nowMs, pastMs) => {
          const now = new Date(nowMs);
          const expiresAt = new Date(nowMs - pastMs); // <= now => expired
          const existing = { sessionId: holder, expiresAt };

          expect(canReserve({ existing, sessionId: requester, now })).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('unheld: a null/undefined existing hold is reservable by any session', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        nowMsArb,
        fc.constantFrom<null | undefined>(null, undefined),
        (sessionId, nowMs, existing) => {
          expect(canReserve({ existing, sessionId, now: new Date(nowMs) })).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('exactly one of two concurrent sessions succeeds on an initially-unheld slot (XOR)', () => {
    fc.assert(
      fc.property(
        twoDistinctSessionsArb,
        nowMsArb,
        // Whether A or B is the one that arrives first.
        fc.boolean(),
        // Gap between the two attempts, kept within the TTL so the first hold
        // is still live when the second attempt races it.
        fc.integer({ min: 0, max: RESERVATION_TTL_MS - 1 }),
        ([sessionA, sessionB], nowMs, aArrivesFirst, gapMs) => {
          const first = aArrivesFirst ? sessionA : sessionB;
          const second = aArrivesFirst ? sessionB : sessionA;

          const firstNow = new Date(nowMs);
          const secondNow = new Date(nowMs + gapMs);

          // First attempt on an unheld slot: must succeed and establish a hold.
          const firstSucceeded = canReserve({ existing: null, sessionId: first, now: firstNow });
          expect(firstSucceeded).toBe(true);

          // The established hold, threaded into the second attempt. It expires a
          // full TTL after the first attempt, which is strictly after secondNow
          // (gap < TTL), so it is still unexpired when the second session races.
          const establishedHold = {
            sessionId: first,
            expiresAt: new Date(nowMs + RESERVATION_TTL_MS),
          };

          // Second (distinct) session attempts against that live hold: must fail.
          const secondSucceeded = canReserve({
            existing: establishedHold,
            sessionId: second,
            now: secondNow,
          });
          expect(secondSucceeded).toBe(false);

          // Exactly one of the two concurrent attempts succeeded (XOR).
          expect(firstSucceeded !== secondSucceeded).toBe(true);
          expect([firstSucceeded, secondSucceeded].filter(Boolean).length).toBe(1);
        }
      ),
      { numRuns: 200 }
    );
  });
});
