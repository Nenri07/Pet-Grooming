/**
 * Live ETA resolution for the public tracker page (Master Spec §11.2).
 *
 * Resolves a `track:{token}` position + the appointment's client destination
 * into a display payload: groomer branding, pet name, current van position, and
 * an ETA in minutes computed with the routing {@link TravelProvider} (haversine
 * by default — no Mapbox needed). Returns `null` when the token can't be matched
 * to an appointment (expired trip / unknown token).
 *
 * MAP SEAM (§11.2): the spec shows a Mapbox map with a van marker. To avoid a
 * Mapbox dependency, the tracker page renders a styled coordinate/ETA panel
 * placeholder instead. When a Mapbox token is configured, a real map component
 * can consume the `van` coordinates returned here without changing this
 * resolver.
 *
 * _Master Spec: §11.2_
 */
import type { LatLng } from '@/lib/routing/geo';

/** The tracker payload the public page renders + polls. */
export interface TrackerData {
  business: string;
  logoUrl: string | null;
  petName: string | null;
  /** Groomer phone for the Call/Text buttons. */
  groomerPhone: string | null;
  /** Current van position, or null while we wait for the first ping. */
  van: LatLng | null;
  /** Client destination, when geocoded (drives the ETA + a map later). */
  destination: LatLng | null;
  /** Estimated arrival in minutes, or null when it can't be computed. */
  etaMinutes: number | null;
  /** Whether the trip has ended (arrived / expired). */
  ended: boolean;
}

/**
 * Resolve a tracker token to its display + ETA payload. Best-effort — returns
 * `null` when the token doesn't map to an appointment.
 */
export async function resolveTracker(token: string): Promise<TrackerData | null> {
  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');
  const { Client } = await import('@/lib/db/models/client');
  const { Pet } = await import('@/lib/db/models/pet');
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');

  const appt = await Appointment.findOne({ 'tracking.token': token })
    .select('groomerId clientId petId location tracking')
    .lean();
  if (!appt) return null;
  const a = appt as unknown as {
    groomerId: unknown;
    clientId: unknown;
    petId: unknown;
    location?: LatLng;
    tracking?: { arrivedAt?: Date };
  };

  const groomerId = String(a.groomerId);

  const [profile, client, pet] = await Promise.all([
    GroomerProfile.findOne({ userId: groomerId })
      .select('businessName logoUrl phone roadFactor avgSpeedKmh parkingMin')
      .lean(),
    Client.findById(a.clientId).select('location').lean(),
    Pet.findById(a.petId).select('name').lean(),
  ]);

  // Destination: the appointment's geocoded location, else the client's.
  const destination: LatLng | null =
    a.location ?? (client as { location?: LatLng } | null)?.location ?? null;

  // Current van position from Redis (may be null before the first ping).
  let van: LatLng | null = null;
  try {
    const { isRedisConfigured, getTrack } = await import('@/lib/redis');
    if (isRedisConfigured()) {
      const rec = await getTrack(token);
      if (rec) van = { lat: rec.lat, lng: rec.lng };
    }
  } catch {
    van = null;
  }

  // ETA via the routing travel provider (haversine default).
  let etaMinutes: number | null = null;
  if (van && destination) {
    try {
      const { getTravelProvider } = await import('@/lib/routing/geo');
      const { ROUTING } = await import('@/lib/routing');
      const p = profile as {
        roadFactor?: number;
        avgSpeedKmh?: number;
        parkingMin?: number;
      } | null;
      const tp = getTravelProvider({
        roadFactor: p?.roadFactor ?? ROUTING.travel.roadFactor,
        avgSpeedKmh: p?.avgSpeedKmh ?? ROUTING.travel.avgSpeedKmh,
        // Parking time doesn't belong in a "minutes until arrival" figure.
        parkingMin: 0,
      });
      etaMinutes = Math.max(0, Math.round(await tp.minutes(van, destination)));
    } catch {
      etaMinutes = null;
    }
  }

  return {
    business:
      (typeof profile?.businessName === 'string' && profile.businessName.trim()) || 'PawPort',
    logoUrl: (profile as { logoUrl?: string } | null)?.logoUrl ?? null,
    petName: (pet as { name?: string } | null)?.name ?? null,
    groomerPhone: (profile as { phone?: string } | null)?.phone ?? null,
    van,
    destination,
    etaMinutes,
    ended: Boolean(a.tracking?.arrivedAt),
  };
}
