/**
 * Rebooking autopilot — nudge job (Master Spec §11.4).
 *
 * The daily job finds pets due within 7 days that have NO future appointment
 * and whose owner has SMS consent (and hasn't opted out), then texts a
 * `rebook_nudge` SMS with a `/rebook/{token}` link (pet + address prefilled).
 *
 * Throttle (§11.4): at most ONE nudge per pet per cycle plus ONE reminder after
 * 5 days. We track `pet.lastNudgedAt` — a pet is only nudged when it has never
 * been nudged, or its last nudge was ≥ 5 days ago (the "reminder"). "Stop on
 * booking" is naturally handled because a pet with a future appointment is
 * excluded from the query.
 *
 * PRO-GATED per groomer (§13.1): before sending we `assertFeature(gid,
 * 'rebookAutopilot')`; groomers without the feature are skipped (their pets
 * are simply not nudged), so the endpoint that scans across groomers never
 * hard-fails on a locked account.
 *
 * DEGRADES GRACEFULLY: no Redis → cannot mint a rebook token → that pet is
 * skipped (logged). No Twilio → `sendSms` is the log-only no-op. Never throws.
 *
 * _Master Spec: §11.4, §13.1, §16_
 */
import { nanoid } from 'nanoid';

/** Pets due within this many days are candidates for a nudge (§11.4). */
const DUE_WINDOW_DAYS = 7;
/** Minimum days between the first nudge and its single reminder (§11.4). */
const REMINDER_AFTER_DAYS = 5;
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
 * PURE: whether a pet is eligible for a nudge given its last-nudged time and
 * `now`. Never nudged → yes. Nudged within the reminder window → no (already
 * had its one nudge this cycle). Nudged ≥ 5 days ago → yes (the reminder).
 */
export function shouldNudge(
  lastNudgedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastNudgedAt) return true;
  return now.getTime() - lastNudgedAt.getTime() >= REMINDER_AFTER_DAYS * DAY_MS;
}

/**
 * Build the public rebook link for a token.
 */
export function rebookLink(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
  return `${base}/rebook/${token}`;
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
    const { assertFeature, FeatureLockedError } = await import('@/lib/billing/entitlements');
    const { isRedisConfigured, setRebook } = await import('@/lib/redis');
    const { sendSms } = await import('@/lib/sms/send-sms');

    const dueBefore = new Date(now.getTime() + DUE_WINDOW_DAYS * DAY_MS);

    // Pets due within the window.
    const duePets = await Pet.find({
      nextDueAt: { $ne: null, $lte: dueBefore },
    })
      .select('name clientId groomerId nextDueAt lastNudgedAt coatCondition')
      .lean();

    // Cache the per-groomer Pro-gate decision so we check each groomer once.
    const gateCache = new Map<string, boolean>();

    for (const petRow of duePets as unknown as Array<{
      _id: unknown;
      name?: string;
      clientId: unknown;
      groomerId: unknown;
      lastNudgedAt?: Date;
    }>) {
      result.examined += 1;

      const groomerId = String(petRow.groomerId);
      const clientId = String(petRow.clientId);
      const petId = String(petRow._id);

      // Throttle (§11.4).
      if (!shouldNudge(petRow.lastNudgedAt ?? null, now)) continue;

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

      // Consent gate: only nudge clients with SMS consent + not opted out.
      const client = await Client.findOne({ _id: clientId, groomerId })
        .select('name phone smsConsentAt smsOptOut')
        .lean();
      if (!client) continue;
      const c = client as unknown as {
        phone?: string;
        smsConsentAt?: Date;
        smsOptOut?: boolean;
      };
      if (!c.phone || c.smsOptOut || !c.smsConsentAt) continue;

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

      const profile = await GroomerProfile.findOne({ userId: groomerId })
        .select('businessName')
        .lean();
      const business =
        (typeof profile?.businessName === 'string' && profile.businessName.trim()) || 'PawPort';

      await sendSms({
        groomerId,
        clientId,
        to: c.phone,
        kind: 'rebook_nudge',
        vars: { pet: petRow.name ?? 'your pet', business, link: rebookLink(token) },
        now,
      });

      // Record the nudge time so the throttle holds (§11.4).
      await Pet.updateOne({ _id: petId }, { $set: { lastNudgedAt: now } }).catch(() => {});
      result.sent += 1;
    }
  } catch (err) {
    console.error('[rebook] runRebookNudges failed:', err);
  }

  return result;
}
