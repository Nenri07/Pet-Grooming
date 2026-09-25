/**
 * create-demo — admin helper to scaffold a personalized prospect demo entry
 * for `/demo/[slug]` (Master Spec §17).
 *
 * -------------------------------------------------------------------------
 * USAGE
 * -------------------------------------------------------------------------
 *   npx tsx scripts/create-demo.ts "Happy Paws" "Austin, TX"
 *   npx tsx scripts/create-demo.ts "Happy Paws" "Austin, TX" --color "#7c9aff"
 *   npx tsx scripts/create-demo.ts "Some Biz" "Nowhere, ZZ" --lat 12.34 --lng -56.78
 *   npx tsx scripts/create-demo.ts "Happy Paws" "Austin, TX" --append
 *
 * Arguments:
 *   1) businessName  (required)  e.g. "Happy Paws"
 *   2) city          (required)  e.g. "Austin, TX"
 *
 * Options:
 *   --lat <n> --lng <n>   Provide coordinates explicitly. REQUIRED when the
 *                         city is not in the built-in lookup table below.
 *   --color <css>         Optional accent colour (any CSS color string).
 *   --logo <url>          Optional logo URL.
 *   --append              Also append the entry to scripts/out/demos.local.json
 *                         (created if missing). The canonical source stays
 *                         `src/content/demos.ts` — paste the printed object in
 *                         there to publish the demo.
 *
 * -------------------------------------------------------------------------
 * WHY A LOOKUP TABLE (no live geocoder)
 * -------------------------------------------------------------------------
 * PawPort ships no live geocoding service for this script (Master Spec: every
 * third party sits behind a seam and we add no paid services here). To keep the
 * helper dependency-free (Node built-ins only) it geocodes a small set of
 * common US cities from the CITY_COORDS table. For any other city, pass
 * `--lat`/`--lng` explicitly. Coordinates are approximate public city centroids
 * and are used only to scatter FAKE demo stops — they are not real addresses.
 *
 * HOW TO RUN
 *   Preferred (if `tsx` is installed):
 *     npx tsx scripts/create-demo.ts "Happy Paws" "Austin, TX"
 *   Dependency-free (uses only the local `typescript` devDependency):
 *     npx tsc scripts/create-demo.ts --outDir scripts/out --module commonjs \
 *       --target es2020 --moduleResolution node --skipLibCheck
 *     node scripts/out/create-demo.js "Happy Paws" "Austin, TX"
 *
 * The script itself imports nothing beyond `node:fs` / `node:path`.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Approximate centroids for a handful of common US cities (lat, lng). */
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  'austin, tx': { lat: 30.2672, lng: -97.7431 },
  'denver, co': { lat: 39.7392, lng: -104.9903 },
  'portland, or': { lat: 45.5152, lng: -122.6784 },
  'seattle, wa': { lat: 47.6062, lng: -122.3321 },
  'san diego, ca': { lat: 32.7157, lng: -117.1611 },
  'los angeles, ca': { lat: 34.0522, lng: -118.2437 },
  'phoenix, az': { lat: 33.4484, lng: -112.074 },
  'dallas, tx': { lat: 32.7767, lng: -96.797 },
  'houston, tx': { lat: 29.7604, lng: -95.3698 },
  'chicago, il': { lat: 41.8781, lng: -87.6298 },
  'atlanta, ga': { lat: 33.749, lng: -84.388 },
  'miami, fl': { lat: 25.7617, lng: -80.1918 },
  'nashville, tn': { lat: 36.1627, lng: -86.7816 },
  'boston, ma': { lat: 42.3601, lng: -71.0589 },
  'new york, ny': { lat: 40.7128, lng: -74.006 },
  'philadelphia, pa': { lat: 39.9526, lng: -75.1652 },
  'minneapolis, mn': { lat: 44.9778, lng: -93.265 },
  'salt lake city, ut': { lat: 40.7608, lng: -111.891 },
  'las vegas, nv': { lat: 36.1699, lng: -115.1398 },
  'sacramento, ca': { lat: 38.5816, lng: -121.4944 },
};

/** Shape mirrors `Demo` in src/content/demos.ts. */
interface DemoEntry {
  slug: string;
  businessName: string;
  city: string;
  lat: number;
  lng: number;
  logoUrl?: string;
  color?: string;
}

/** Turn a business name into a URL-safe slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Minimal flag parser for `--key value` pairs; returns positional args too. */
function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      // Boolean flag (e.g. --append) if the next token is another flag or absent.
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  console.error('Usage: npx tsx scripts/create-demo.ts "Business Name" "City, ST" [--lat N --lng N] [--color CSS] [--logo URL] [--append]\n');
  process.exit(1);
}

function main(): void {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [businessName, city] = positionals;

  if (!businessName || !city) {
    fail('Both a business name and a city are required.');
  }

  // Resolve coordinates: explicit flags win, else the built-in table.
  let lat: number;
  let lng: number;
  if (flags.lat !== undefined || flags.lng !== undefined) {
    lat = Number(flags.lat);
    lng = Number(flags.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      fail('--lat and --lng must both be valid numbers.');
    }
  } else {
    const key = city.toLowerCase().trim().replace(/\s+/g, ' ');
    const hit = CITY_COORDS[key];
    if (!hit) {
      fail(
        `"${city}" is not in the built-in city table. Re-run with explicit coordinates, e.g.:\n` +
          `  npx tsx scripts/create-demo.ts "${businessName}" "${city}" --lat 30.2672 --lng -97.7431\n` +
          `Known cities: ${Object.keys(CITY_COORDS).join(', ')}`
      );
    }
    lat = hit.lat;
    lng = hit.lng;
  }

  const entry: DemoEntry = {
    slug: slugify(businessName),
    businessName,
    city,
    lat,
    lng,
  };
  if (flags.color && flags.color !== 'true') entry.color = flags.color;
  if (flags.logo && flags.logo !== 'true') entry.logoUrl = flags.logo;

  // Print the object to paste into src/content/demos.ts.
  const pretty = JSON.stringify(entry, null, 2)
    .replace(/"(\w+)":/g, '$1:') // unquote keys for TS-friendly paste
    .replace(/"/g, "'");
  console.log('\n✔ Demo generated. Paste this into `demos` in src/content/demos.ts:\n');
  console.log(`${pretty},\n`);
  console.log(`Preview URL: /demo/${entry.slug}`);
  console.log(`Claim URL:   /register?claim=${entry.slug}\n`);

  // Optionally append to a local JSON scratch file.
  if (flags.append === 'true') {
    const outPath = join(process.cwd(), 'scripts', 'out', 'demos.local.json');
    mkdirSync(dirname(outPath), { recursive: true });
    let list: DemoEntry[] = [];
    if (existsSync(outPath)) {
      try {
        list = JSON.parse(readFileSync(outPath, 'utf8')) as DemoEntry[];
      } catch {
        list = [];
      }
    }
    // De-dupe by slug (last write wins).
    list = list.filter((d) => d.slug !== entry.slug);
    list.push(entry);
    writeFileSync(outPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
    console.log(`Appended to ${outPath}\n`);
  }
}

main();
