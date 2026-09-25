/**
 * Personalized prospect demos — data source for `/demo/[slug]` (Master Spec §17).
 *
 * These are SAMPLE / prospect entries used purely to render a personalized
 * preview of the public booking experience for a groomer we are pitching. They
 * are NOT real customer records: no PII, no DB rows, nothing writeable. A demo
 * is a business name, the prospect's city, and an approximate city centroid
 * (lat/lng) used only to place FAKE sample stops on the Order Radar showcase.
 *
 * Add new prospects here (or generate one with `scripts/create-demo.ts` and
 * paste the printed object into `demos` below). Everything is typed and static
 * so the demo page can render as a client-visual showcase with no data access.
 *
 * _Master Spec: §17_
 */

/**
 * A single personalized prospect demo.
 *
 * `slug` is the URL segment (`/demo/{slug}`) and the value passed to the claim
 * flow (`/register?claim={slug}`). `lat`/`lng` are the approximate city centre
 * used to scatter demo stops; they are not a real address.
 */
export interface Demo {
  /** URL-safe identifier, e.g. "happy-paws". Unique across the list. */
  slug: string;
  /** Prospect's business name, shown in the branded header and banner. */
  businessName: string;
  /** Human-readable city label, e.g. "Austin, TX". */
  city: string;
  /** Approximate city-centre latitude (for placing fake demo stops). */
  lat: number;
  /** Approximate city-centre longitude. */
  lng: number;
  /** Optional logo URL for the branded header. */
  logoUrl?: string;
  /**
   * Optional accent colour for light branding touches. Any valid CSS color
   * string (used only for a thin accent bar / avatar tint, never theme tokens).
   */
  color?: string;
}

/**
 * Seed prospects. SAMPLE DATA ONLY — safe to publish, contains no real
 * customer information. City coordinates are public approximate centroids.
 */
export const demos: Demo[] = [
  {
    slug: 'happy-paws',
    businessName: 'Happy Paws',
    city: 'Austin, TX',
    lat: 30.2672,
    lng: -97.7431,
    color: '#7c9aff',
  },
  {
    slug: 'the-groom-room',
    businessName: 'The Groom Room',
    city: 'Denver, CO',
    lat: 39.7392,
    lng: -104.9903,
    color: '#8fd3c4',
  },
  {
    slug: 'wag-and-wash',
    businessName: 'Wag & Wash',
    city: 'Portland, OR',
    lat: 45.5152,
    lng: -122.6784,
    color: '#f2a2a2',
  },
];

/**
 * Look up a demo by slug. Case-insensitive on the slug so a pasted link with
 * odd casing still resolves. Returns `undefined` when nothing matches (the
 * page turns that into a 404).
 */
export function getDemo(slug: string): Demo | undefined {
  const needle = slug.trim().toLowerCase();
  return demos.find((d) => d.slug.toLowerCase() === needle);
}
