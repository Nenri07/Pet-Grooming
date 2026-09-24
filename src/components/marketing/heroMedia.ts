/**
 * Hero media configuration.
 *
 * The hero renders gracefully with NONE of these present (it falls back to a
 * CSS gradient), so no real asset is required to build or run. To add real
 * media later, drop files into /public/media/ and point the paths below at
 * them, e.g.:
 *
 *   poster:    "/media/hero-poster.jpg"   // shown instantly, acts as the LCP image
 *   videoMp4:  "/media/hero.mp4"           // optional background video
 *   videoWebm: "/media/hero.webm"          // optional (smaller, modern browsers)
 *
 * Leave a slot as null to skip it. If poster is null AND no video is set, the
 * hero shows the branded gradient only.
 */
export interface HeroMedia {
  /** Poster shown before/instead of video, and as the LCP image. */
  poster: string | null;
  /** Optional video sources; leave null to skip video entirely. */
  videoWebm?: string | null;
  videoMp4?: string | null;
  /** Decorative layered images for depth (optional). */
  layers?: { src: string; alt: string; depth: number }[];
}

import { images } from '@/content/images.generated';

export const heroMedia: HeroMedia = {
  // Real hero poster wired from the generated image map (KIRO_IMAGES.md #1).
  // Rendered as the LCP image with next/image priority; the `bg-hero` gradient
  // stays behind it as the fallback so the hero is never empty.
  poster: images.hero.src,
  videoWebm: null,
  videoMp4: null,
  layers: [],
};
