/**
 * Fill My Day orchestrator (Master Spec §11.1).
 *
 * Given a groomer and a freed gap, this:
 *   1. gathers candidates — active {@link Waitlist} entries + clients whose
 *      pet's `nextDueAt` is within 14 days AND who have no future booking;
 *   2. excludes SMS opt-outs and de-dupes by client;
 *   3. ranks them via the PURE {@link findGapCandidates} (route-fit) and takes
 *      the top 3;
 *   4. creates a {@link FillEvent} recording who was offered the gap;
 *   5. for each offered client, stores a `claim:{token}` in Redis (EX 1800)
 *      and sends a `fill_my_day_offer` SMS with a `/claim/{token}` link.
 *
 * DEGRADES GRACEFULLY: with no Redis a claim token cannot be stored, so that
 * candidate is skipped (logged) — the flow still runs for any candidate whose
 * token stored, and returns a summary. With no Twilio, `sendSms` is the
 * log-only no-op. Nothing here throws to the caller on infra gaps.
 *
 * STAGGER SEAM (§11.1 "staggered 2 min"): the spec wants offers sent 2 minutes
 * apart so the closest candidate gets first refusal. We cannot run reliable
 * background timers in a serverless request, so we send all offers immediately
 * and mark this as a seam. A future QStash-scheduled fan-out (one delayed
 * publish per candidate) can replace {@link offerToCandidate} without changing
 * the candidate selection or claim mechanics.
 *
 * _Master Spec: §11.1, §15_
 */
import { nanoid } from 'nanoid';
import type { LatLng } from '@/lib/routing/geo';
import { getTravelProvider } from '@/lib/routing/geo';
import { ROUTING } from '@/lib/routing';
import type { Stop } from '@/lib/routing/insertion';
import { findGapCandidates, type FillCandidate } from '@/lib/fill/candidates';

/** How far ahead a pet's `nextDueAt` can be to count as a Fill candidate (§11.1). */
const DUE_WINDOW_DAYS = 14;
/** Max offers sent per gap (§11.1: "top 3"). */
const MAX_OFFERS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Outcome of a {@link fillMyDay} run. */
export interface FillMyDayResult {
  ok: boolean;
  /** The FillEvent id, when one was created. */
  fillEventId?: string;
  /** Number of candidates the gap was offered to (SMS attempted). */
  offered: number;
  /** Number of feasible candidates found before the top-N cut. */
  candidatesFound: number;
  /** A human reason when nothing was offered. */
  reason?: string;
}

/**
 * Trigger Fill My Day for a groomer's freed gap. See the module docs.
 *
 * @param groomerId The groomer (User id).
 * @param gapStartMs Gap start, epoch ms.
 * @param gapEndMs Gap end, epoch ms.
 */
export async function fillMyDay(
  groomerId: string,
  gapStartMs: number,
  gapEndMs: number
): Promise<FillMyDayResult> {
  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();

    const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
    const profile = await GroomerProfile.findOne({ userId: groomerId }).lean();
    if (!profile?.baseLocation) {
      return { ok: false, offered: 0, candidatesFound: 0, reason: 'no_base_location' };
    }

    // Gather the raw candidate pool + the day's existing stops.
    const [candidates, existingStops] = await Promise.all([
      gatherCandidates(groomerId, gapStartMs),
      loadDayStops(groomerId, gapStartMs, profile.baseLocation),
    ]);

    if (candidates.length === 0) {
      return { ok: true, offered: 0, candidatesFound: 0, reason: 'no_candidates' };
    }

    // Rank by route-fit (PURE).
    const tp = getTravelProvider({
      roadFactor: profile.roadFactor ?? ROUTING.travel.roadFactor,
      avgSpeedKmh: profile.avgSpeedKmh ?? ROUTING.travel.avgSpeedKmh,
      parkingMin: profile.parkingMin ?? ROUTING.travel.parkingMin,
    });

    const dayStart = startOfUtcDay(gapStartMs);
    const dayEnd = endOfUtcDay(gapStartMs);

    const ranked = await findGapCandidates({
      gap: { startMs: gapStartMs, endMs: gapEndMs },
      candidates,
      existingStops,
      base: profile.baseLocation,
      cfg: { bufferMin: profile.bufferMin ?? ROUTING.bufferMin },
      tp,
      dayWindow: { startMs: dayStart, endMs: dayEnd },
    });

    if (ranked.length === 0) {
      return { ok: true, offered: 0, candidatesFound: 0, reason: 'none_feasible' };
    }

    const top = ranked.slice(0, MAX_OFFERS);

    // Create the FillEvent recording who we offered the gap to (§11.1 step 6).
    const { FillEvent } = await import('@/lib/db/models/fill-event');
    const fillEvent = await FillEvent.create({
      groomerId,
      gapStart: new Date(gapStartMs),
      gapEnd: new Date(gapEndMs),
      offeredTo: top.map((c) => c.clientId),
    });

    // Offer each candidate the slot (claim token + SMS).
    const business =
      (typeof profile.businessName === 'string' && profile.businessName.trim()) || 'PawPort';
    const timezone = profile.timezone ?? 'UTC';

    let offered = 0;
    for (const c of top) {
      const sent = await offerToCandidate({
        groomerId,
        candidate: c,
        gapStartMs,
        gapEndMs,
        business,
        timezone,
      });
      if (sent) offered += 1;
    }

    return {
      ok: true,
      fillEventId: String(fillEvent._id),
      offered,
      candidatesFound: ranked.length,
    };
  } catch (err) {
    console.error('[fill] fillMyDay failed:', err);
    return { ok: false, offered: 0, candidatesFound: 0, reason: 'error' };
  }
}

/**
 * Gather the raw candidate pool for a gap: active waitlist entries + clients
 * whose pet is due within {@link DUE_WINDOW_DAYS} and who have no future
 * appointment. De-duped by client, opt-outs kept in (dropped later by the pure
 * ranker so the reason is centralised there).
 */
async function gatherCandidates(
  groomerId: string,
  gapStartMs: number
): Promise<FillCandidate[]> {
  const { Waitlist } = await import('@/lib/db/models/waitlist');
  const { Pet } = await import('@/lib/db/models/pet');
  const { Client } = await import('@/lib/db/models/client');
  const { Appointment } = await import('@/lib/db/models/appointment');

  const byClient = new Map<string, FillCandidate>();

  // (a) Active waitlist entries.
  const waitlist = await Waitlist.find({ groomerId, status: 'active' })
    .populate('clientId', 'name phone location smsOptOut')
    .lean();

  for (const w of waitlist as unknown as Array<{
    clientId: {
      _id: unknown;
      name?: string;
      phone?: string;
      location?: LatLng;
      smsOptOut?: boolean;
    } | null;
    petId?: unknown;
  }>) {
    const client = w.clientId;
    if (!client?._id) continue;
    const id = String(client._id);
    if (byClient.has(id)) continue;
    byClient.set(id, {
      clientId: id,
      name: client.name,
      phone: client.phone,
      location: client.location ?? null,
      smsOptOut: client.smsOptOut ?? false,
      petId: w.petId ? String(w.petId) : undefined,
      origin: 'waitlist',
    });
  }

  // (b) Pets due within the window with NO future appointment.
  const now = new Date();
  const dueBefore = new Date(now.getTime() + DUE_WINDOW_DAYS * DAY_MS);
  const duePets = await Pet.find({
    groomerId,
    nextDueAt: { $ne: null, $lte: dueBefore },
  })
    .select('name clientId nextDueAt')
    .lean();

  for (const p of duePets as unknown as Array<{
    _id: unknown;
    clientId: unknown;
    name?: string;
  }>) {
    const clientId = String(p.clientId);
    if (byClient.has(clientId)) continue;

    // Skip if the client already has a future appointment (§11.1 step 2).
    const future = await Appointment.exists({
      groomerId,
      clientId,
      status: { $ne: 'cancelled' },
      scheduledDate: { $gte: now },
    });
    if (future) continue;

    const client = await Client.findOne({ _id: clientId, groomerId })
      .select('name phone location smsOptOut')
      .lean();
    if (!client) continue;
    const c = client as unknown as {
      name?: string;
      phone?: string;
      location?: LatLng;
      smsOptOut?: boolean;
    };
    byClient.set(clientId, {
      clientId,
      name: c.name,
      phone: c.phone,
      location: c.location ?? null,
      smsOptOut: c.smsOptOut ?? false,
      petId: String(p._id),
      origin: 'due',
    });
  }

  return [...byClient.values()];
}

/**
 * Load the day's non-cancelled appointments as {@link Stop}s for insertion
 * evaluation. Stops with no geocoded location fall back to the base location.
 */
async function loadDayStops(
  groomerId: string,
  gapStartMs: number,
  base: LatLng
): Promise<Stop[]> {
  const { Appointment } = await import('@/lib/db/models/appointment');
  const dayStart = new Date(startOfUtcDay(gapStartMs));
  const dayEnd = new Date(endOfUtcDay(gapStartMs));

  const appts = await Appointment.find({
    groomerId,
    status: { $ne: 'cancelled' },
    scheduledDate: { $gte: dayStart, $lte: dayEnd },
  })
    .select('location scheduledDate scheduledEndDate')
    .lean();

  return (
    appts as unknown as Array<{
      _id: unknown;
      location?: LatLng;
      scheduledDate: Date;
      scheduledEndDate: Date;
    }>
  ).map((a) => ({
    id: String(a._id),
    loc: a.location ?? base,
    startMs: new Date(a.scheduledDate).getTime(),
    endMs: new Date(a.scheduledEndDate).getTime(),
  }));
}

/**
 * Offer the gap to one candidate: store a `claim:{token}` in Redis and send the
 * `fill_my_day_offer` SMS with the `/claim/{token}` link. Returns whether the
 * offer went out (token stored). Best-effort — never throws.
 *
 * STAGGER SEAM: sent immediately; see the module docs.
 */
async function offerToCandidate(args: {
  groomerId: string;
  candidate: { clientId: string; name?: string; phone?: string };
  gapStartMs: number;
  gapEndMs: number;
  business: string;
  timezone: string;
}): Promise<boolean> {
  const { groomerId, candidate, gapStartMs, gapEndMs, timezone } = args;

  if (!candidate.phone) return false;

  const { isRedisConfigured, setClaim } = await import('@/lib/redis');
  if (!isRedisConfigured()) {
    console.info(
      `[fill] Redis not configured — cannot store claim token for client ${candidate.clientId} (skipping offer).`
    );
    return false;
  }

  const token = nanoid();
  try {
    await setClaim(token, {
      gid: groomerId,
      startMs: gapStartMs,
      endMs: gapEndMs,
      clientId: candidate.clientId,
    });
  } catch (err) {
    console.error('[fill] failed to store claim token (skipping offer):', err);
    return false;
  }

  const link = claimLink(token);
  const when = new Date(gapStartMs);
  const date = when.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = when.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  const { sendSms } = await import('@/lib/sms/send-sms');
  await sendSms({
    groomerId,
    clientId: candidate.clientId,
    to: candidate.phone,
    kind: 'fill_my_day_offer',
    vars: { date, time, link },
  });

  return true;
}

/** Build the public claim link for a token. */
export function claimLink(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
  return `${base}/claim/${token}`;
}

/** Start of the UTC day containing `ms`. */
function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** End of the UTC day containing `ms`. */
function endOfUtcDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}
