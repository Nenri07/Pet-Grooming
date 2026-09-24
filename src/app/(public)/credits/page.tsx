import type { Metadata } from 'next';
import { images } from '@/content/images.generated';

/**
 * /credits — photo attribution page (KIRO_IMAGES.md #6).
 *
 * Lists every photographer used across the marketing site, read straight from
 * the generated image map so it stays in sync with the assets. Each entry links
 * to the photographer's profile and to the original source photo on Pexels.
 *
 * Server component (no client JS needed): the data is static at build time.
 */
export const metadata: Metadata = {
  title: 'Photo credits · PawPort',
  description: 'Photography used across the PawPort site, with attribution to each photographer on Pexels.',
};

export default function CreditsPage() {
  // Deduplicate by source photo id so the same photo is listed once.
  const seen = new Set<number>();
  const entries = Object.values(images).filter((img) => {
    const id = img.credit.photoId;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl px-gutter py-section">
      <h1 className="font-display text-h2 font-bold text-base-content">
        Photo credits
      </h1>
      <p className="mt-4 text-lg text-base-content/70">
        The photography on this site is provided by talented photographers on{' '}
        <a
          href="https://www.pexels.com"
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary hover:underline"
        >
          Pexels
        </a>
        . Thank you.
      </p>

      <ul className="mt-10 space-y-4">
        {entries.map((img) => (
          <li
            key={img.credit.photoId}
            className="rounded-box border border-base-content/10 bg-base-200 p-5 shadow-card"
          >
            <p className="font-display text-lg font-semibold text-base-content">
              <a
                href={img.credit.photographerUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-primary"
              >
                {img.credit.photographer}
              </a>
            </p>
            <p className="mt-1 text-sm text-base-content/60">{img.alt}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a
                href={img.credit.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary hover:underline"
              >
                View source photo
              </a>
              <span className="text-base-content/50">{img.credit.provider}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
