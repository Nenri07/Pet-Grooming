/**
 * IdentityBinding persistence / integration tests (Phase 2, task 9.4).
 *
 * These exercise the DURABLE anti-abuse trial ledger against a real persisted
 * MongoDB (in-memory via mongodb-memory-server) rather than invoking the full
 * `startTrialGated` server action — that action needs a NextAuth session, the
 * Stripe provider, and `next/headers`, none of which are available/driveable in
 * a plain unit test. Instead we test the two pieces the pipeline *composes*:
 *
 *   1. the `IdentityBinding` MODEL (unique `phoneHash`, account-independence), and
 *   2. the pure `identityConsumedTrial` decision applied to real persisted rows.
 *
 * All DB-touching tests guard on `isDbAvailable()` and skip gracefully when the
 * in-memory `mongod` binary can't start in this environment (exactly like
 * `tests/properties/slug.test.ts`). Clean state between tests is handled by
 * `tests/setup.ts`'s `afterEach`.
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 1.4
 */
import { describe, expect, it } from 'vitest';
import { isDbAvailable } from './setup';
import { identityConsumedTrial } from '@/lib/identity/binding';

describe('Feature: billing-trial-and-payments, IdentityBinding ledger persistence', () => {
  // --- Pure decision (no DB) ---------------------------------------------
  it('treats an absent identity as NOT consumed (pure, no DB) — R11.2', () => {
    // No binding exists ⇒ the identity may start a trial.
    expect(identityConsumedTrial(null, new Date())).toBe(false);
  });

  // --- Binding survives account deletion (R11.4) -------------------------
  it('keeps the IdentityBinding after the User + GroomerProfile are deleted — R11.4', async () => {
    if (!isDbAvailable()) {
      console.warn('Skipping DB-backed binding-survival check: no MongoDB available.');
      return;
    }

    const { Types } = await import('mongoose');
    const { User } = await import('@/lib/db/models/user');
    const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
    const { IdentityBinding } = await import('@/lib/db/models/identity-binding');
    await IdentityBinding.syncIndexes();

    const userId = new Types.ObjectId();
    const phoneHash = 'hash-survives-deletion';

    // A registered groomer: User + GroomerProfile + the identity ledger row.
    await User.create({ _id: userId, email: 'owner@example.com', name: 'Owner' });
    await GroomerProfile.create({ userId });
    await IdentityBinding.create({
      normalizedEmail: 'owner@example.com',
      phoneHash,
      firstTrialAt: new Date(),
      bindingExpiresAt: null,
    });

    // Delete the account entirely (the abuse scenario: delete + re-register).
    await User.deleteOne({ _id: userId });
    await GroomerProfile.deleteOne({ userId });

    // The ledger is account-INDEPENDENT: the binding must still be there.
    expect(await User.findById(userId).lean()).toBeNull();
    expect(await GroomerProfile.findOne({ userId }).lean()).toBeNull();

    const surviving = await IdentityBinding.findOne({ phoneHash }).lean();
    expect(surviving).not.toBeNull();
    expect(surviving?.phoneHash).toBe(phoneHash);
  });

  // --- A consumed identity blocks a second trial (R11.2 / R11.3) ---------
  it('reads a never-expiring binding as consumed, before and after re-register — R11.2/11.3', async () => {
    if (!isDbAvailable()) {
      console.warn('Skipping DB-backed consumed-identity check: no MongoDB available.');
      return;
    }

    const { Types } = await import('mongoose');
    const { User } = await import('@/lib/db/models/user');
    const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
    const { IdentityBinding } = await import('@/lib/db/models/identity-binding');
    await IdentityBinding.syncIndexes();

    const phoneHash = 'hash-consumed-identity';
    const now = new Date();

    // First trial recorded for this phone identity, never expires.
    await IdentityBinding.create({
      normalizedEmail: 'repeat@example.com',
      phoneHash,
      firstTrialAt: now,
      bindingExpiresAt: null,
    });

    // The pipeline loads the row (lean) and runs the pure decision — consumed.
    const loaded = await IdentityBinding.findOne({ phoneHash }).lean();
    expect(loaded).not.toBeNull();
    expect(identityConsumedTrial(loaded, new Date())).toBe(true);

    // Simulate "delete the account and re-register with the same phone": the
    // binding is account-independent so it is still present — consumed stays
    // true, i.e. the second trial is still blocked (R11.3).
    const userId = new Types.ObjectId();
    await User.create({ _id: userId, email: 'repeat2@example.com', name: 'Repeat' });
    await GroomerProfile.create({ userId });
    await User.deleteOne({ _id: userId });
    await GroomerProfile.deleteOne({ userId });

    const stillThere = await IdentityBinding.findOne({ phoneHash }).lean();
    expect(stillThere).not.toBeNull();
    expect(identityConsumedTrial(stillThere, new Date())).toBe(true);
  });

  // --- Unique phoneHash prevents a duplicate binding (R1.4) --------------
  it('rejects a second binding with the same phoneHash (duplicate key 11000) — R1.4', async () => {
    if (!isDbAvailable()) {
      console.warn('Skipping DB-backed unique-phoneHash check: no MongoDB available.');
      return;
    }

    const { IdentityBinding } = await import('@/lib/db/models/identity-binding');
    // Ensure the unique `phoneHash` index exists on the in-memory instance.
    await IdentityBinding.syncIndexes();

    const phoneHash = 'hash-duplicate-guard';

    await IdentityBinding.create({
      normalizedEmail: 'first@example.com',
      phoneHash,
      firstTrialAt: new Date(),
      bindingExpiresAt: null,
    });

    // The race / double-submit guard the pipeline relies on: a second insert
    // with the SAME phoneHash must be rejected by the unique index (code 11000).
    let duplicateCode: number | undefined;
    try {
      await IdentityBinding.create({
        normalizedEmail: 'second@example.com',
        phoneHash,
        firstTrialAt: new Date(),
        bindingExpiresAt: null,
      });
    } catch (err: unknown) {
      duplicateCode = (err as { code?: number } | null)?.code;
    }
    expect(duplicateCode).toBe(11000);

    // Exactly one binding exists for that phoneHash.
    expect(await IdentityBinding.countDocuments({ phoneHash })).toBe(1);
  });

  // --- A fresh / absent identity is not consumed -------------------------
  it('finds no binding for an unknown phoneHash and reads it as not consumed', async () => {
    if (!isDbAvailable()) {
      console.warn('Skipping DB-backed absent-identity check: no MongoDB available.');
      return;
    }

    const { IdentityBinding } = await import('@/lib/db/models/identity-binding');
    await IdentityBinding.syncIndexes();

    // No row was ever inserted for this hash.
    const missing = await IdentityBinding.findOne({ phoneHash: 'hash-never-seen' }).lean();
    expect(missing).toBeNull();
    expect(identityConsumedTrial(missing, new Date())).toBe(false);
  });
});
