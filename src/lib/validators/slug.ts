/**
 * Canonical groomer slug format.
 *
 * A valid slug contains only lowercase letters, digits, and hyphens, and is
 * between 3 and 40 characters long.
 *
 * Validates: Requirements 15.5
 */
export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

/**
 * Returns true if and only if `slug` matches the required groomer slug format
 * (`^[a-z0-9-]{3,40}$`).
 *
 * This is a pure function covering the *format* half of Property 10. The
 * *uniqueness* half is enforced separately by the GroomerProfile unique index
 * at the database layer.
 */
export function isValidSlugFormat(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
