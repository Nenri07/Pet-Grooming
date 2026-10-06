/**
 * Image-URL safety helpers.
 *
 * next/image throws DURING RENDER when given a src whose host/protocol is not
 * allowed by `next.config` (we only permit https remote hosts). A logo or pet
 * photo loaded from legacy/manual data may be an http URL, a relative path, a
 * data: URI, or malformed — any of which crashes the (often public) page that
 * renders it. Routing every DB-sourced <Image src> through this guard turns a
 * bad value into a graceful placeholder instead of a server-component crash.
 */

/**
 * Return `url` only when it is a usable absolute https URL for next/image;
 * otherwise null (callers fall back to a placeholder). Never throws.
 */
export function safeHttpsImageSrc(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
