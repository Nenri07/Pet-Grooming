/**
 * Race-safe booking commit (Master Spec §9.4).
 *
 * Commit happens only after payment success. The critical section is guarded
 * by a per-groomer Redis lock so two concurrent commits for the same slot can
 * never both write an appointment:
 *
 *   1. Acquire lock `lock:book:{gid}` (retry ≤ 3 × 150 ms).
 *   2. Re-check no overlapping non-cancelled Appointment in Mongo for
 *      `[start − buffer, end + buffer]` (using the pure {@link hasConflict}).
 *   3. Insert Appointment (+ Client/Pet upserts + Transaction) inside a Mongo
 *      transaction when the topology supports it; otherwise sequential writes.
 *   4. Release the hold, invalidate the slot cache.
 *   5. Release the lock (token compare).
 *
 * "Hold expired but slot still free → commit anyway"; "slot no longer free →
 * `{ committed: false, reason: 'slot_taken' }`" so the caller can refund.
 *
 * The pure decision bit — {@link isSlotStillFree} — is exported for tests.
 *
 * _Master Spec: §9.4_
 */
import { nanoid } from 'nanoid';
import { hasConflict, type TimeBlock } from '@/lib/calendar/availability';
import { acquireLock, releaseLock } from '@/lib/redis';

const MS_PER_MINUTE = 60 * 1000;
const LOCK_RETRIES = 3;
const LOCK_RETRY_DELAY_MS = 150;

/** Client details for the upsert (matches the Client model shape). */
export interface CommitClientData {
  name: string;
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
  };
}

/** Pet details for the upsert (matches the Pet model shape). */
export interface CommitPetData {
  name: string;
  breed: string;
  weight: number;
  weightUnit?: 'lbs' | 'kg';
  age: number;
  temperament: 'calm' | 'nervous' | 'aggressive' | 'friendly';
  coatCondition: 'smooth' | 'double' | 'wire' | 'curly' | 'long' | 'matted';
  photoUrl?: string;
  notes?: string;
}

/** Everything the commit needs. */
export interface CommitBookingInput {
  groomerId: string;
  holdId: string;
  /** `yyyy-mm-dd` of the slot's start, for hold-set + cache scoping. */
  dateStr: string;
  clientData: CommitClientData;
  petData: CommitPetData;
  /** Ordered service ids; the first is used for the legacy `serviceId` field. */
  serviceIds: string[];
  /** Slot start, epoch ms. */
  startAt: number;
  /** Slot end, epoch ms. */
  endAt: number;
  /** Buffer minutes for the overlap re-check (default 10). */
  bufferMin?: number;
  /** Stripe payment intent id, for the Transaction record. */
  stripePaymentId?: string;
  /** Deposit amount charged, for the Transaction record. */
  depositAmount?: number;
  /** Where the booking originated. */
  source?: 'public' | 'manual' | 'claim' | 'rebook';
  /** Optional service address string on the appointment. */
  serviceAddress?: string;
}

/** Result of a commit attempt. */
export type CommitResult =
  | { committed: true; appointmentId: string }
  | { committed: false; reason: 'slot_taken' | 'lock_failed' };

/**
 * PURE re-check: is `[startAt − buffer, endAt + buffer)` free of the given
 * existing (non-cancelled) appointment blocks?
 *
 * Reuses the pure {@link hasConflict} from the availability core, so the exact
 * same half-open overlap semantics apply everywhere. DB-free and deterministic
 * — this is the decision the concurrency test verifies.
 */
export function isSlotStillFree(
  startAt: number,
  endAt: number,
  existingBlocks: TimeBlock[],
  bufferMin = 10
): boolean {
  const padMs = bufferMin * MS_PER_MINUTE;
  const paddedStart = new Date(startAt - padMs);
  const paddedEnd = new Date(endAt + padMs);
  return !hasConflict(paddedStart, paddedEnd, existingBlocks);
}

/** Sleep helper for lock retry backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire the booking lock with bounded retries (≤ 3 × 150 ms). Returns the
 * lock token on success, or `null` if the lock could not be acquired.
 */
async function acquireBookingLock(groomerId: string): Promise<string | null> {
  const token = nanoid();
  for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
    if (await acquireLock(groomerId, token)) return token;
    if (attempt < LOCK_RETRIES) await delay(LOCK_RETRY_DELAY_MS);
  }
  return null;
}

/**
 * Commit a booking race-safely. See module docs for the full sequence.
 *
 * On success returns `{ committed: true, appointmentId }`. If the slot was
 * taken while the client was in checkout, returns
 * `{ committed: false, reason: 'slot_taken' }` (caller should refund). If the
 * lock could never be acquired, returns `{ committed: false, reason: 'lock_failed' }`.
 */
export async function commitBooking(input: CommitBookingInput): Promise<CommitResult> {
  const {
    groomerId,
    holdId,
    dateStr,
    clientData,
    petData,
    serviceIds,
    startAt,
    endAt,
    bufferMin = 10,
    stripePaymentId,
    depositAmount = 0,
    source = 'public',
    serviceAddress,
  } = input;

  const token = await acquireBookingLock(groomerId);
  if (!token) return { committed: false, reason: 'lock_failed' };

  try {
    const { connectDB } = await import('@/lib/db/connect');
    const mongooseMod = await import('mongoose');
    const mongoose = mongooseMod.default;
    const { Appointment } = await import('@/lib/db/models/appointment');
    const { Client } = await import('@/lib/db/models/client');
    const { Pet } = await import('@/lib/db/models/pet');
    const { Transaction } = await import('@/lib/db/models/transaction');

    await connectDB();

    // Step 2: re-check for overlaps against current non-cancelled appointments.
    const padMs = bufferMin * MS_PER_MINUTE;
    const windowStart = new Date(startAt - padMs);
    const windowEnd = new Date(endAt + padMs);

    const overlapping = await Appointment.find({
      groomerId,
      status: { $ne: 'cancelled' },
      scheduledDate: { $lt: windowEnd },
      scheduledEndDate: { $gt: windowStart },
    }).lean();

    const existingBlocks: TimeBlock[] = (
      overlapping as unknown as Array<{ scheduledDate: Date; scheduledEndDate: Date }>
    ).map((a) => ({
      start: new Date(a.scheduledDate),
      end: new Date(a.scheduledEndDate),
    }));

    if (!isSlotStillFree(startAt, endAt, existingBlocks, bufferMin)) {
      // Hold may have expired; regardless, the slot is now taken → caller refunds.
      return { committed: false, reason: 'slot_taken' };
    }

    // Step 3: write Client/Pet/Appointment/Transaction. Use a transaction when
    // the topology supports it (replica set / Atlas); fall back to sequential
    // writes on standalone Mongo (e.g. mongodb-memory-server without a replset).
    let appointmentId = '';

    const doWrites = async (session?: import('mongoose').ClientSession) => {
      const sessionOpt = session ? { session } : {};

      // Upsert client by (groomerId, email) — matches the unique index.
      const client = await Client.findOneAndUpdate(
        { groomerId, email: clientData.email.toLowerCase() },
        {
          $set: {
            name: clientData.name,
            phone: clientData.phone,
            address: clientData.address,
          },
          $setOnInsert: { groomerId, email: clientData.email.toLowerCase() },
        },
        { upsert: true, new: true, ...sessionOpt }
      );

      // Upsert pet by (clientId, name).
      const pet = await Pet.findOneAndUpdate(
        { clientId: client._id, name: petData.name },
        {
          $set: {
            groomerId,
            breed: petData.breed,
            weight: petData.weight,
            weightUnit: petData.weightUnit ?? 'lbs',
            age: petData.age,
            temperament: petData.temperament,
            coatCondition: petData.coatCondition,
            photoUrl: petData.photoUrl,
            notes: petData.notes,
          },
          $setOnInsert: { clientId: client._id, name: petData.name },
        },
        { upsert: true, new: true, ...sessionOpt }
      );

      const [created] = await Appointment.create(
        [
          {
            groomerId,
            clientId: client._id,
            petId: pet._id,
            serviceId: serviceIds[0], // required legacy field
            serviceIds, // additive multi-service field
            scheduledDate: new Date(startAt),
            scheduledEndDate: new Date(endAt),
            status: 'upcoming',
            serviceAddress,
            source,
          },
        ],
        session ? { session } : {}
      );

      appointmentId = String(created._id);

      if (stripePaymentId) {
        await Transaction.create(
          [
            {
              appointmentId: created._id,
              groomerId,
              stripePaymentId,
              amount: depositAmount,
              type: 'deposit',
              status: 'succeeded',
            },
          ],
          session ? { session } : {}
        );
      }
    };

    let session: import('mongoose').ClientSession | undefined;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await doWrites(session);
      });
    } catch (err) {
      // Standalone Mongo rejects transactions — fall back to sequential writes.
      const msg = err instanceof Error ? err.message : String(err);
      const noTxn =
        /Transaction numbers are only allowed|replica set|not support|Transaction/i.test(msg);
      if (noTxn) {
        await doWrites();
      } else {
        throw err;
      }
    } finally {
      if (session) await session.endSession();
    }

    // Step 4: release hold + invalidate slot cache (best-effort).
    const { releaseHold } = await import('@/lib/calendar/holds');
    const { invalidateSlotsCache } = await import('@/lib/calendar/slots');
    await releaseHold(groomerId, holdId, dateStr).catch(() => {});
    await invalidateSlotsCache(groomerId, dateStr).catch(() => {});

    return { committed: true, appointmentId };
  } finally {
    // Step 5: release the lock only if we still own it (token compare).
    await releaseLock(groomerId, token).catch(() => {});
  }
}
