/**
 * Live "van is on the way" tracking (Master Spec §11.2).
 *
 * When a groomer taps "On my way", we mint a tracking token on the appointment,
 * store the van position in Redis (`track:{token}` EX 7200), and text the client
 * a `/t/{token}` link. The groomer's device posts its position every ~20s while
 * active; the public tracker polls it every ~10s. Sharing stops on "Arrived" or
 * after 2h (the Redis key simply expires).
 *
 * These functions are the server-side operations behind `POST
 * /api/portal/track/{id}` (start/stop/position). The route enforces auth + the
 * `liveEta` Pro gate; this module assumes the caller already owns the
 * appointment (it re-scopes queries to the groomer defensively regardless).
 *
 * DEGRADES: no Redis → position writes/reads are skipped (logged); the token is
 * still stored on the appointment so the tracker page renders "waiting for the
 * van". No Twilio → the "on my way" SMS is the log-only no-op.
 *
 * _Master Spec: §11.2, §15_
 */
import { nanoid } from 'nanoid';

/** Result of a tracking operation. */
export interface TrackOpResult {
  ok: boolean;
  token?: string;
  reason?: string;
}

/** Build the public tracker link for a token. */
export function trackLink(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
  return `${base}/t/${token}`;
}

/**
 * Start a trip: ensure the appointment has a tracking token, stamp `startedAt`,
 * seed the Redis position (if a starting position is supplied), and text the
 * client the tracker link. Scoped to the groomer. Idempotent — re-starting an
 * active trip reuses the existing token.
 */
export async function startTracking(args: {
  groomerId: string;
  appointmentId: string;
  /** Optional starting van position. */
  lat?: number;
  lng?: number;
}): Promise<TrackOpResult> {
  const { groomerId, appointmentId, lat, lng } = args;

  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');

  const appt = await Appointment.findOne({ _id: appointmentId, groomerId });
  if (!appt) return { ok: false, reason: 'not_found' };
  if (appt.status === 'cancelled') return { ok: false, reason: 'cancelled' };

  // Reuse an existing token if a trip is already active; else mint one.
  const existing = (appt as { tracking?: { token?: string } }).tracking?.token;
  const token = existing ?? nanoid();

  appt.set('tracking', {
    token,
    startedAt: new Date(),
    arrivedAt: undefined,
  });
  await appt.save();

  // Seed the position if we have one.
  if (typeof lat === 'number' && typeof lng === 'number') {
    await writePosition(token, lat, lng).catch(() => {});
  }

  // Text the client the tracker link (best-effort, never throws).
  await sendOnMyWaySms({ groomerId, appointmentId, token }).catch((err) =>
    console.error('[track] on_my_way SMS failed (non-fatal):', err)
  );

  return { ok: true, token };
}

/**
 * Update the van's position for an active trip. Verifies the token belongs to
 * the appointment (scoped to the groomer) before writing to Redis.
 */
export async function updatePosition(args: {
  groomerId: string;
  appointmentId: string;
  lat: number;
  lng: number;
}): Promise<TrackOpResult> {
  const { groomerId, appointmentId, lat, lng } = args;

  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');

  const appt = await Appointment.findOne({ _id: appointmentId, groomerId })
    .select('tracking status')
    .lean();
  const token = (appt as { tracking?: { token?: string }; status?: string } | null)?.tracking
    ?.token;
  if (!token) return { ok: false, reason: 'not_started' };
  if ((appt as { status?: string }).status === 'cancelled') {
    return { ok: false, reason: 'cancelled' };
  }

  await writePosition(token, lat, lng);
  return { ok: true, token };
}

/**
 * Stop a trip: stamp `arrivedAt` and clear the Redis position so the van stops
 * being shared (privacy, §11.2). Scoped to the groomer.
 */
export async function stopTracking(args: {
  groomerId: string;
  appointmentId: string;
}): Promise<TrackOpResult> {
  const { groomerId, appointmentId } = args;

  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');

  const appt = await Appointment.findOne({ _id: appointmentId, groomerId });
  if (!appt) return { ok: false, reason: 'not_found' };

  const token = (appt as { tracking?: { token?: string } }).tracking?.token;
  if (token) {
    const { isRedisConfigured, clearTrack } = await import('@/lib/redis');
    if (isRedisConfigured()) await clearTrack(token).catch(() => {});
  }

  const startedAt = (appt as { tracking?: { startedAt?: Date } }).tracking?.startedAt;
  appt.set('tracking', {
    token,
    startedAt,
    arrivedAt: new Date(),
  });
  await appt.save();

  return { ok: true, token };
}

/** Write a van position to Redis (no-op + log when Redis is unconfigured). */
async function writePosition(token: string, lat: number, lng: number): Promise<void> {
  const { isRedisConfigured, setTrack } = await import('@/lib/redis');
  if (!isRedisConfigured()) {
    console.info(`[track] Redis not configured — position for ${token} not stored (no-op).`);
    return;
  }
  await setTrack(token, { lat, lng, ts: Date.now() });
}

/** Send the client the "on my way" SMS with the tracker link. */
async function sendOnMyWaySms(args: {
  groomerId: string;
  appointmentId: string;
  token: string;
}): Promise<void> {
  const { groomerId, appointmentId, token } = args;

  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');
  const { Client } = await import('@/lib/db/models/client');
  const { Pet } = await import('@/lib/db/models/pet');

  const appt = await Appointment.findOne({ _id: appointmentId, groomerId })
    .select('clientId petId')
    .lean();
  if (!appt) return;
  const a = appt as unknown as { clientId: unknown; petId: unknown };

  const [client, pet] = await Promise.all([
    Client.findById(a.clientId).select('phone').lean(),
    Pet.findById(a.petId).select('name').lean(),
  ]);
  const phone = (client as { phone?: string } | null)?.phone;
  if (!phone) return;

  const { sendSms } = await import('@/lib/sms/send-sms');
  await sendSms({
    groomerId,
    clientId: String(a.clientId),
    appointmentId,
    to: phone,
    kind: 'on_my_way',
    vars: { pet: (pet as { name?: string } | null)?.name ?? 'your pet', link: trackLink(token) },
  });
}
