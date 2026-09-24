import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Service } from '@/lib/db/models/service';
import { BookingFlow, type BookingGroomer } from '@/components/booking/BookingFlow';

/**
 * Public booking page — /book/[groomerSlug].
 *
 * Server component that loads the groomer's active profile by slug along with
 * their active services, then renders the client-side BookingFlow. If no
 * groomer matches the slug, renders the 404 not-found page.
 *
 * `generateMetadata` produces SEO-friendly metadata (title, description, Open
 * Graph tags) and the page output embeds schema.org `LocalBusiness` JSON-LD
 * structured data for search engines.
 *
 * _Requirements: 3.1, 3.5, 18.7, 20.1, 20.2, 20.3, 20.4_
 */

interface BookingPageProps {
  params: { groomerSlug: string };
}

/**
 * SEO view of a groomer: the RAW business name (which may be absent) plus
 * active service names. Kept separate from {@link BookingGroomer} so that
 * metadata generation can distinguish "no business name configured" from the
 * booking-flow fallback of "Pet Grooming".
 */
interface GroomerSeoData {
  slug: string;
  /** Raw configured business name; undefined/empty when not set. */
  businessName?: string;
  /** Optional business contact details, included in structured data if present. */
  phone?: string;
  businessEmail?: string;
  /** Active service names, in insertion order. */
  serviceNames: string[];
}

/** The generic fallback title when nothing identifying is configured (Req 20.4). */
const FALLBACK_TITLE = 'Pet Grooming Services';
const FALLBACK_DESCRIPTION =
  'Book an appointment with a professional pet grooming provider.';
const MAX_TITLE_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 160;

/** Truncate to `max` chars without cutting mid-word where avoidable. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  // Prefer cutting at a word boundary when one exists in the back half.
  if (lastSpace > max * 0.6) return sliced.slice(0, lastSpace).trimEnd();
  return sliced.trimEnd();
}

/** Load the raw SEO-relevant fields for a groomer by slug. */
async function loadGroomerSeoData(slug: string): Promise<GroomerSeoData | null> {
  await connectDB();

  const profile = await GroomerProfile.findOne({ groomerSlug: slug })
    .select('userId businessName phone businessEmail')
    .lean();
  if (!profile) return null;

  const services = await Service.find({
    groomerId: profile.userId,
    isActive: true,
  })
    .select('name')
    .lean();

  const businessName =
    typeof profile.businessName === 'string' && profile.businessName.trim().length > 0
      ? profile.businessName.trim()
      : undefined;

  return {
    slug,
    businessName,
    phone: profile.phone,
    businessEmail: profile.businessEmail,
    serviceNames: services.map((s) => s.name).filter((n): n is string => Boolean(n)),
  };
}

/** Load the groomer profile (by slug) and their active services. */
async function loadGroomer(slug: string): Promise<BookingGroomer | null> {
  await connectDB();

  const profile = await GroomerProfile.findOne({ groomerSlug: slug }).lean();
  if (!profile) return null;

  const services = await Service.find({
    groomerId: profile.userId,
    isActive: true,
  })
    .select('name basePrice durationMinutes')
    .lean();

  return {
    slug,
    businessName: profile.businessName ?? 'Pet Grooming',
    services: services.map((s) => ({
      name: s.name,
      basePrice: s.basePrice,
      durationMinutes: s.durationMinutes,
    })),
  };
}

/**
 * Build the SEO title and description from the groomer's data, applying the
 * Requirement 20.4 fallback hierarchy:
 *  - Both business name AND services missing -> generic fallback.
 *  - Services present but name missing -> derive content from services.
 *  - Business name present -> name + primary service category.
 */
function buildSeoText(data: GroomerSeoData): { title: string; description: string } {
  const { businessName, serviceNames } = data;
  const primaryService = serviceNames[0];
  const topServices = serviceNames.slice(0, 3);

  // Case 1: nothing identifying configured -> generic fallback.
  if (!businessName && serviceNames.length === 0) {
    return { title: FALLBACK_TITLE, description: FALLBACK_DESCRIPTION };
  }

  // Case 2: services exist but no business name -> derive from services.
  if (!businessName) {
    const title = primaryService
      ? `${primaryService} & Pet Grooming Services`
      : FALLBACK_TITLE;
    const servicesList = topServices.join(', ');
    const description = `Book pet grooming online. Services offered: ${servicesList}.`;
    return {
      title: clamp(title, MAX_TITLE_LENGTH),
      description: clamp(description, MAX_DESCRIPTION_LENGTH),
    };
  }

  // Case 3: business name present. Title = name + primary service category.
  const title = primaryService
    ? `${businessName} · ${primaryService}`
    : `${businessName} · Pet Grooming`;

  // Description uses the business name as the searchable descriptor (the
  // profile has no explicit location field) plus up to 3 offered services.
  const description =
    topServices.length > 0
      ? `Book with ${businessName}. Services offered: ${topServices.join(', ')}.`
      : `Book your pet grooming appointment with ${businessName}.`;

  return {
    title: clamp(title, MAX_TITLE_LENGTH),
    description: clamp(description, MAX_DESCRIPTION_LENGTH),
  };
}

export async function generateMetadata({
  params,
}: BookingPageProps): Promise<Metadata> {
  const data = await loadGroomerSeoData(params.groomerSlug);

  if (!data) {
    return {
      title: FALLBACK_TITLE,
      description: 'This booking page could not be found.',
      robots: { index: false, follow: false },
    };
  }

  const { title, description } = buildSeoText(data);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const pageUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/book/${data.slug}` : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: pageUrl,
    },
  };
}

/**
 * Build a schema.org LocalBusiness JSON-LD object for the groomer, including
 * business name and offered services (plus contact details where available).
 * Returns null when there is nothing meaningful to describe.
 *
 * _Requirements: 20.2_
 */
function buildLocalBusinessJsonLd(
  data: GroomerSeoData
): Record<string, unknown> | null {
  const displayName = data.businessName ?? 'Pet Grooming Services';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const pageUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/book/${data.slug}` : undefined;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: displayName,
  };

  if (pageUrl) jsonLd.url = pageUrl;
  if (data.phone) jsonLd.telephone = data.phone;
  if (data.businessEmail) jsonLd.email = data.businessEmail;

  if (data.serviceNames.length > 0) {
    jsonLd.makesOffer = data.serviceNames.map((name) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name },
    }));
  }

  return jsonLd;
}

export default async function BookingPage({ params }: BookingPageProps) {
  const [groomer, seoData] = await Promise.all([
    loadGroomer(params.groomerSlug),
    loadGroomerSeoData(params.groomerSlug),
  ]);

  if (!groomer) {
    notFound();
  }

  const jsonLd = seoData ? buildLocalBusinessJsonLd(seoData) : null;

  return (
    <main className="min-h-screen bg-base-200 px-4 py-8 sm:py-12">
      {jsonLd && (
        <script
          type="application/ld+json"
          // Structured data is server-rendered from trusted DB fields.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="mx-auto mb-6 w-full max-w-xl text-center">
        <h1 className="text-2xl font-bold text-primary">{groomer.businessName}</h1>
        <p className="text-sm text-base-content/60">Book your appointment</p>
      </div>
      <BookingFlow groomer={groomer} />
    </main>
  );
}
