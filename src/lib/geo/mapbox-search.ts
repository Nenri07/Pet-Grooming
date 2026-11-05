/**
 * Browser-side Mapbox Geocoding v6 helpers for the address map picker.
 *
 * Uses the PUBLIC token (NEXT_PUBLIC_MAPBOX_TOKEN). `parseMapboxFeature` is
 * pure so it can be unit tested; the two fetchers never throw (they resolve to
 * an empty list / null on any network or API error).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A picked address split into the fields our forms use, plus exact coords. */
export interface PickedAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  /** One-line address as Mapbox formats it. */
  fullAddress: string;
  lat: number;
  lng: number;
}

/** Same "is this a real token" rule used elsewhere (empty / placeholder = no). */
export function isPublicMapboxToken(value: string | undefined | null): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  if (t.includes('replace_me') || t.startsWith('your-')) return false;
  return true;
}

type Named = { name?: string } | undefined;

/** Minimal shape of a Geocoding v6 feature (only what we read). */
export interface MapboxFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    feature_type?: string;
    name?: string;
    place_formatted?: string;
    full_address?: string;
    coordinates?: { longitude?: number; latitude?: number };
    context?: {
      address?: { name?: string };
      street?: Named;
      neighborhood?: Named;
      locality?: Named;
      place?: Named;
      district?: Named;
      region?: Named;
      postcode?: Named;
    };
  };
}

function clean(v: string | undefined): string {
  return (v ?? '').trim();
}

/** Turn a v6 feature into form fields. Returns null without usable coords. */
export function parseMapboxFeature(feature: MapboxFeature): PickedAddress | null {
  const p = feature.properties ?? {};
  const ctx = p.context ?? {};
  const lng = p.coordinates?.longitude ?? feature.geometry?.coordinates?.[0];
  const lat = p.coordinates?.latitude ?? feature.geometry?.coordinates?.[1];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = p.feature_type ?? '';
  const name = clean(p.name);

  // Street line: the house/street when we have one, else the most specific
  // local name (neighbourhood / landmark). A bare city leaves it blank so the
  // client types their street.
  let street = clean(ctx.address?.name);
  if (!street && (type === 'address' || type === 'street' || type === 'poi')) street = name;
  if (!street) street = clean(ctx.street?.name);
  if (!street && (type === 'neighborhood' || type === 'locality')) street = name;
  if (!street) street = clean(ctx.neighborhood?.name);

  const city =
    clean(ctx.place?.name) ||
    (type === 'place' ? name : '') ||
    clean(ctx.locality?.name) ||
    clean(ctx.district?.name);
  const state = clean(ctx.region?.name) || (type === 'region' ? name : '');
  const postalCode = clean(ctx.postcode?.name) || (type === 'postcode' ? name : '');

  const fullAddress =
    clean(p.full_address) || [name, clean(p.place_formatted)].filter(Boolean).join(', ');

  return { street, city, state, postalCode, fullAddress, lat, lng };
}

const BASE = 'https://api.mapbox.com/search/geocode/v6';

/** Type-ahead suggestions, biased toward `near` (or the visitor's IP). */
export async function searchAddresses(
  query: string,
  token: string,
  near?: LatLng | null,
  signal?: AbortSignal
): Promise<PickedAddress[]> {
  const q = query.trim().slice(0, 200);
  if (q.length < 3) return [];
  const params = new URLSearchParams({
    q,
    autocomplete: 'true',
    limit: '6',
    proximity: near ? `${near.lng},${near.lat}` : 'ip',
    access_token: token,
  });
  try {
    const res = await fetch(`${BASE}/forward?${params.toString()}`, { signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: MapboxFeature[] };
    return (json.features ?? [])
      .map(parseMapboxFeature)
      .filter((a): a is PickedAddress => a !== null);
  } catch {
    return [];
  }
}

/** The address at a point (most specific match), or null. */
export async function reverseGeocode(
  point: LatLng,
  token: string,
  signal?: AbortSignal
): Promise<PickedAddress | null> {
  const params = new URLSearchParams({
    longitude: String(point.lng),
    latitude: String(point.lat),
    access_token: token,
  });
  try {
    const res = await fetch(`${BASE}/reverse?${params.toString()}`, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { features?: MapboxFeature[] };
    const first = json.features?.[0];
    if (!first) return null;
    const parsed = parseMapboxFeature(first);
    // Keep the exact pin, not the centre of the matched feature.
    return parsed ? { ...parsed, lat: point.lat, lng: point.lng } : null;
  } catch {
    return null;
  }
}

/** Validate an untrusted {lat,lng}; returns a clean copy or undefined. */
export function sanitizeLatLng(value: unknown): LatLng | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}
