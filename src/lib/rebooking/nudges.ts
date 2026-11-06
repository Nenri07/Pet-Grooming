/**
 * Rebooking autopilot — nudge job (Master Spec §11.4).
 *
 * The daily job finds pets due within 7 days whose owner has NO future
 * appointment and has an email address, then emails a Rebook_Nudge with a
 * `/rebook/{token}` link (pet + address prefilled), in the groomer-branded
 * layout with Reply-To set to the groomer.
 *
 * Throttle: at most ONE nudge per pet per due cycle. We track
 * `pet.lastNudgedAt` — a pet is nudged when it has never been nudged, or its
 * last nudge was sent before the current cycle's nudge window opened
 * (`nextDueAt - 7 days`). Completing an appointment moves `nextDueAt` forward
 * by the coat interval, which opens a new cycle. "Stop on booking" is handled
 * because a pet whose owner has a future appointment is skipped.
 *
 * PRO-GATED per groomer (§13.1): before sending we `assertFeature(gid,
 * 'rebookAutopilot')`; groomers without the feature are skipped (their pets
 * are simply not nudged), so the endpoint that scans across groomers never
 * hard-fails on a locked account.
 *
 * METERED: each nudge is an optional client message. We check
 * `canSendOptionalMessage` before sending and call `meterClientMessage` only
 * after a successful send.
 *
 * DEGRADES GRACEFULLY: no Redis → cannot mint a rebook token → that pet is
 * skipped (logged). A failed email is not metered and does not set
 * `lastNudgedAt`, so the next run retries. Never throws.
 *
 * _Master Spec: §11.4, §13.1, §16_
 */
import { nanoid } from 'nanoid';

/** Pets due within this many days are candidates for a nudge (§11.4). */
const DUE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Outcome of a {@link runRebookNudges} run. */
export interface RebookNudgeResult {
  /** Pets examined as due candidates. */
  examined: number;
  /** Nudges actually sent. */
  sent: number;
  /** Groomers skipped because they lack the Pro feature. */
  gatedGroomers: number;
}

/**
 * PURE: nudge once per due cycle. True when the pet has never been nudged, or
 * its last nudge was sent before this cycle's window opened
 * (`lastNudgedAt < nextDueAt - 7 days`), i.e. it belonged to an earlier cycle.
 *
 * `now` is accepted for signature symmetry with the sweep; the rule depends
 * only on the nudge time relative to the current due date.
 */
export function shouldNudge(
  lastNudgedAt: Date | null | undefined,
  nextDueAt: Date,
  now: Date = new Date()
): boolean {
  void now;
  if (!lastNudgedAt) return true;
  return lastNudgedAt.getTime() < nextDueAt.getTime() - DUE_WINDOW_DAYS * DAY_MS;
}

/**
 * Build the public rebook link for a token.
 */
export function rebookLink(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
  return `${base}/rebook/${token}`;
}

/** Format a due date for the email in the groomer's time zone. */
function formatDueDate(d: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

interface GroomerSendInfo {
  businessName: string;
  timezone: string;
  replyTo?: string;
  phone?: string;
}

/**
 * Run the rebooking-nudge sweep across all groomers. See the module docs.
 *
 * @param now Reference time (injectable for tests; defaults to real now).
 */
export async function runRebookNudges(now: Date = new Date()): Promise<RebookNudgeResult> {
  const result: RebookNudgeResult = { examined: 0, sent: 0, gatedGroomers: 0 };

  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();

    const { Pet } = await import('@/lib/db/models/pet');
    const { Client } = await import('@/lib/db/models/client');
    const { Appointment } = await import('@/lib/db/models/appointment');
    const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
    const { User } = await import('@/lib/db/models/user');
    const { assertFeature, FeatureLockedError } = await import('@/lib/billing/entitlements');
    const { isRedisConfigured, setRebook } = await import('@/lib/redis');
    const { sendRebookNudgeEmail } = await import('@/lib/email/send');
    const { canSendOptionalMessage, meterClientMessage } = await import('@/lib/messaging/usage');

    const dueBefore = new Date(now.getTime() + DUE_WINDOW_DAYS * DAY_MS);

    // Pets due within the window.
    const duePets = await Pet.find({
      nextDueAt: { $ne: null, $lte: dueBefore },
    })
      .select('name clientId groomerId nextDueAt lastNudgedAt coatCondition')
      .lean();

    // Cache the per-groomer Pro-gate decision so we check each groomer once.
    const gateCache = new Map<string, boolean>();
    // Cache the per-groomer email details (business name, tz, Reply-To, phone).
    const groomerCache = new Map<string, GroomerSendInfo>();

    const loadGroomer = async (groomerId: string): Promise<GroomerSendInfo> => {
      const cached = groomerCache.get(groomerId);
      if (cached) return cached;
      const profile = await GroomerProfile.findOne({ userId: groomerId })
        .select('businessName businessEmail phone timezone')
        .lean<{
          businessName?: string;
          businessEmail?: string;
          phone?: string;
          timezone?: string;
        } | null>();
      let replyTo = profile?.businessEmail?.trim() || undefined;
      if (!replyTo) {
        const user = await User.findById(groomerId)
          .select('email')
          .lean<{ email?: string } | null>();
        replyTo = user?.email?.trim() || undefined;
      }
      const info: GroomerSendInfo = {
        businessName:
          (typeof profile?.businessName === 'string' && profile.businessName.trim()) || 'Pawxis',
        timezone: profile?.timezone || 'UTC',
        replyTo,
        phone: profile?.phone?.trim() || undefined,
      };
      groomerCache.set(groomerId, info);
      return info;
    };

    for (const petRow of duePets as unknown as Array<{
      _id: unknown;
      name?: string;
      clientId: unknown;
      groomerId: unknown;
      nextDueAt: Date;
      lastNudgedAt?: Date;
    }>) {
      result.examined += 1;

      const groomerId = String(petRow.groomerId);
      const clientId = String(petRow.clientId);
      const petId = String(petRow._id);
      const nextDueAt = new Date(petRow.nextDueAt);

      // Throttle: once per due cycle.
      if (!shouldNudge(petRow.lastNudgedAt ?? null, nextDueAt, now)) continue;

      // Skip pets whose owner already has a future appointment (stop on booking).
      const future = await Appointment.exists({
        groomerId,
        clientId,
        status: { $ne: 'cancelled' },
        scheduledDate: { $gte: now },
      });
      if (future) continue;

      // Pro gate per groomer (§13.1) — cached.
      let allowed = gateCache.get(groomerId);
      if (allowed === undefined) {
        try {
          await assertFeature(groomerId, 'rebookAutopilot');
          allowed = true;
        } catch (err) {
          allowed = false;
          if (err instanceof FeatureLockedError) result.gatedGroomers += 1;
        }
        gateCache.set(groomerId, allowed);
      }
      if (!allowed) continue;

      // Delivery needs a client email address.
      const client = await Client.findOne({ _id: clientId, groomerId })
        .select('name email')
        .lean<{ name?: string; email?: string } | null>();
      const to = client?.email?.trim();
      if (!to) continue;

      // Optional message: skip when the allowance is used up.
      if (!(await canSendOptionalMessage(groomerId))) continue;

      // Mint a rebook token (needs Redis).
      if (!isRedisConfigured()) {
        console.info(`[rebook] Redis not configured — cannot mint token for pet ${petId} (skip).`);
        continue;
      }
      const token = nanoid();
      try {
        await setRebook(token, { gid: groomerId, clientId, petId });
      } catch (err) {
        console.error('[rebook] failed to store rebook token (skip):', err);
        continue;
      }

      const groomer = await loadGroomer(groomerId);

      const ok = await sendRebookNudgeEmail(to, {
        businessName: groomer.businessName,
        petName: petRow.name ?? 'your pet',
        dueDate: formatDueDate(nextDueAt, groomer.timezone),
        bookUrl: rebookLink(token),
        replyTo: groomer.replyTo,
        groomerPhone: groomer.phone,
      }).catch((err) => {
        console.error('[rebook] nudge email failed:', err);
        return false;
      });
      if (!ok) continue;

      await meterClientMessage(groomerId);
      // Record the nudge time so the once-per-cycle throttle holds.
      await Pet.updateOne({ _id: petId }, { $set: { lastNudgedAt: now } }).catch(() => {});
      result.sent += 1;
    }
  } catch (err) {
    console.error('[rebook] runRebookNudges failed:', err);
  }

  return result;
}
