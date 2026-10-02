/**
 * Routing configuration accessors (Master Spec §10.2, §11.2).
 *
 * Parsed, placeholder-aware readers for the Mapbox-related environment
 * variables. Kept separate from `geo.ts` / the provider files (which own the
 * configured/not-configured gates) so those modules stay dependency-light and
 * the pure travel math stays a pure function of its arguments while the
 * *token* is sourced here at the call site.
 *
 * Every accessor follows the shared `isSet` convention (empty / `…replace_me`
 * / `your-…` / `price_replace…` placeholders ⇒ "not configured" ⇒ degrade),
 * mirroring {@link module:lib/billing/config} (R19.4).
 */

/**
 * Whether a value is a present, non-placeholder env value.
 *
 * Mirrors the `isSet` classifier in `src/lib/billing/config.ts` so placeholder
 * handling is consistent across the configuration surface (R19.4).
 */
function isSet(value: string | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  // Treat shipped placeholders (…replace_me / your-…) as "not configured".
  if (t.includes('replace_me') || t.startsWith('your-') || t.startsWith('price_replace')) {
    return false;
  }
  return true;
}

/**
 * Whether a real Mapbox token is configured for server-side routing.
 *
 * Reads `MAPBOX_TOKEN`, treating any placeholder/empty value as "not
 * configured" via the shared `isSet` convention. When this returns `false`,
 * routing degrades to the built-in haversine travel model and the free
 * OpenStreetMap Nominatim geocoder (Master Spec §10.2).
 *
 * @returns `true` iff `MAPBOX_TOKEN` passes the placeholder-aware `isSet` check.
 */
export function isMapboxConfigured(): boolean {
  return isSet(process.env.MAPBOX_TOKEN);
}

/**
 * The server-side Mapbox token used for Directions (road ETAs) + Geocoding, or
 * `null` when unset/placeholder.
 *
 * @returns The trimmed token when configured; otherwise `null`.
 */
export function getMapboxToken(): string | null {
  const raw = process.env.MAPBOX_TOKEN;
  if (!isSet(raw)) return null;
  return raw.trim();
}
