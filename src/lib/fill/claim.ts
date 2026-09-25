/**
 * Fill My Day claim resolution + confirmation (Master Spec §11.1).
 *
 * The public `/claim/{token}` page and its API routes use these helpers:
 *   - {@link resolveClaim} validates a token → the slot + groomer branding to
 *     render the claim page.
 *   - {@link confirmClaim} runs the FIRST-TO-WIN race (`SET claimwon NX`) then,
 *     for the winner, books the slot via the normal commit path.
 *
 * DEPOSIT-CHECKOUT SEAM (§11.1 step 5): the spec routes the winner through a
 * deposit checkout before commit. Live deposit checkout (Stripe Connect
 * PaymentIntent) is a Phase-5 seam that isn't wired to a public endpoint yet,
 * so the winner is committed directly with `source: 'claim'` and the deposit is
 * left at 0. When the deposit checkout endpoint lands, insert it between the
 * win and the commit here — the win/commit mechanics do not change.
 *
 * _Master Spec: §11.1, §9.4_
 */
import type { ClaimRecord } from '@/lib/redis';

/** A resolved, still-valid claim ready to render on the public page. */
export interface ResolvedClaim {
  token: string;
  gid: string;
  startMs: number;
  endMs: number;
  clientId: string;
  /** Groomer branding for the claim page. */
  business: string;
  logoUrl?: string;
  timezone: string;
  /** Client + pet display context. */
  clientName?: string;
  petName?: string;
  /** Whether the slot has already been claimed by someone. */
  alreadyTaken: boolean;
}

/**
 * Validate a claim token and load everything the public page needs. Returns
 * `null` when the token is missing/expired (Redis unconfigured also → null).
 */
export async function resolveClaim(token: string): Promise<ResolvedClaim | null> {
  const { isRedisConfigured, getClaim, keys, getRedis } = await import('@/lib/redis');
  if (!isRedisConfigured()) return null;

  let record: ClaimRecord | null = null;
  try {
    record = await getClaim(token);
  } catch (err) {
    console.error('[claim] token read failed:', err);
    return null;
  }
  if (!record) return null;

  // Has anyone already won this slot?
  let alreadyTaken = false;
  try {
    const winner = await getRedis().get<string>(keys.claimWon(record.gid, record.startMs));
    alreadyTaken = Boolean(winner);
  } catch {
    alreadyTaken = false;
  }

  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
  const { Client } = await import('@/lib/db/models/client');

  const [profile, client] = await Promise.all([
    GroomerProfile.findOne({ userId: record.gid })
      .select('businessName logoUrl timezone')
      .lean(),
    Client.findOne({ _id: record.clientId, groomerId: record.gid })
      .select('name')
      .lean(),
  ]);

  return {
    token,
    gid: record.gid,
    startMs: record.startMs,
    endMs: record.endMs,
    clientId: record.clientId,
    business:
      (typeof profile?.businessName === 'string' && profile.businessName.trim()) || 'PawPort',
    logoUrl: (profile as { logoUrl?: string } | null)?.logoUrl,
    timezone: (profile as { timezone?: string } | null)?.timezone ?? 'UTC',
    clientName: (client as { name?: string } | null)?.name,
    alreadyTaken,
  };
}

/** Outcome of a claim confirmation. */
export type ConfirmClaimResult =
  | { ok: true; appointmentId: string }
  | { ok: false; reason: 'expired' | 'taken' | 'commit_failed' | 'error' };

/**
 * Confirm a claim: win the slot first-to-win, then book it for the winner.
 * See the module docs for the deposit-checkout seam.
 */
export async function confirmClaim(token: string): Promise<ConfirmClaimResult> {
  try {
    const { isRedisConfigured, getClaim, tryWinClaim } = await import('@/lib/redis');
    if (!isRedisConfigured()) return { ok: false, reason: 'error' };

    const record = await getClaim(token);
    if (!record) return { ok: false, reason: 'expired' };

    // FIRST TO WIN (§11.1 step 5): SET claimwon NX. Losers get 'taken'.
    const won = await tryWinClaim(record.gid, record.startMs, record.clientId);
    if (!won) return { ok: false, reason: 'taken' };

    // Winner books the slot via the normal commit path (deposit-checkout seam).
    const appointmentId = await commitClaimedSlot(record);
    if (!appointmentId) return { ok: false, reason: 'commit_failed' };
    return { ok: true, appointmentId };
  } catch (err) {
    console.error('[claim] confirmClaim failed:', err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Book the claimed slot for the winning client via {@link commitBooking}. Loads
 * the client + a pet + a service so the commit's upserts have data. Returns the
 * appointment id, or `null` on failure / slot taken.
 */
async function commitClaimedSlot(record: ClaimRecord): Promise<string | null> {
  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();

  const { Client } = await import('@/lib/db/models/client');
  const { Pet } = await import('@/lib/db/models/pet');
  const { Service } = await import('@/lib/db/models/service');
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');

  const client = await Client.findOne({ _id: record.clientId, groomerId: record.gid }).lean();
  if (!client) return null;
  const c = client as unknown as {
    name: string;
    email: string;
    phone: string;
    address: { street: string; city: string; state: string; postalCode: string };
  };

  // A representative pet + service for the booking (first found).
  const [pet, service, profile] = await Promise.all([
    Pet.findOne({ clientId: record.clientId }).lean(),
    Service.findOne({ groomerId: record.gid, isActive: true }).lean(),
    GroomerProfile.findOne({ userId: record.gid }).select('bufferMin depositAmount').lean(),
  ]);
  if (!pet || !service) return null;

  const p = pet as unknown as {
    name: string;
    breed: string;
    weight: number;
    weightUnit?: 'lbs' | 'kg';
    age: number;
    temperament: 'calm' | 'nervous' | 'aggressive' | 'friendly';
    coatCondition: 'smooth' | 'double' | 'wire' | 'curly' | 'long' | 'matted';
    photoUrl?: string;
  };

  const { commitBooking } = await import('@/lib/calendar/commit');
  const dateStr = new Date(record.startMs).toISOString().slice(0, 10);

  const result = await commitBooking({
    groomerId: record.gid,
    holdId: `claim_${record.startMs}`, // synthetic — no prior public hold
    dateStr,
    clientData: {
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
    },
    petData: {
      name: p.name,
      breed: p.breed,
      weight: p.weight,
      weightUnit: p.weightUnit,
      age: p.age,
      temperament: p.temperament,
      coatCondition: p.coatCondition,
      photoUrl: p.photoUrl,
    },
    serviceIds: [String((service as { _id: unknown })._id)],
    startAt: record.startMs,
    endAt: record.endMs,
    bufferMin: (profile as { bufferMin?: number } | null)?.bufferMin ?? 10,
    source: 'claim',
  });

  if (!result.committed) return null;

  // Log the recovered revenue on the FillEvent for the dashboard metric (§11.1).
  await logFillFilled(record, service as { basePrice?: number }).catch(() => {});

  return result.appointmentId;
}

/**
 * Mark the matching FillEvent as filled and record the revenue recovered.
 * Best-effort — a logging miss never fails the booking.
 */
async function logFillFilled(
  record: ClaimRecord,
  service: { basePrice?: number }
): Promise<void> {
  const { FillEvent } = await import('@/lib/db/models/fill-event');
  await FillEvent.findOneAndUpdate(
    {
      groomerId: record.gid,
      gapStart: new Date(record.startMs),
      filledBy: { $exists: false },
    },
    {
      $set: {
        filledBy: record.clientId,
        revenueRecovered: service.basePrice ?? 0,
      },
    },
    { sort: { createdAt: -1 } }
  );
}
