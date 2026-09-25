/**
 * Booking reference helpers (pure).
 *
 * A booking reference is a short, human-friendly code the client can quote to
 * their groomer — printed on the confirmation ticket / receipt PDF and stored
 * on the persisted Appointment so both sides share the same number.
 *
 * Format: `PP-XXXXXX` — a `PP-` prefix (PawPort) followed by 6 characters from
 * an UNAMBIGUOUS uppercase alphabet. We deliberately exclude the characters
 * that are easy to confuse when read aloud or handwritten:
 *   - `0` (zero) vs `O` (oh)
 *   - `1` (one)  vs `I` (eye)
 * The remaining 32-symbol alphabet (Crockford-style base32: digits 2–9 plus
 * A–Z minus I/O) gives 32^6 ≈ 1.07 billion possible codes, which is plenty to
 * keep collisions negligible for a single groomer's booking volume.
 *
 * These functions are pure and dependency-free so they can run on the server
 * (at checkout / fulfilment) and be unit-tested without any I/O.
 */

/**
 * The unambiguous alphabet used for the random body of a reference.
 * Digits 2-9 (no 0/1) and A-Z with I and O removed.
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The fixed prefix identifying a PawPort booking reference. */
export const REFERENCE_PREFIX = 'PP';

/** Number of random characters after the prefix. */
export const REFERENCE_BODY_LENGTH = 6;

/**
 * Pick a cryptographically-strong random index into the alphabet when a secure
 * RNG is available (Node / modern browsers expose `crypto.getRandomValues`),
 * falling back to `Math.random` when it is not. Rejection sampling keeps the
 * distribution uniform over the 32-symbol alphabet.
 */
function randomIndex(bound: number): number {
  const g: { getRandomValues?: (a: Uint32Array) => Uint32Array } | undefined =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as unknown as {
          getRandomValues?: (a: Uint32Array) => Uint32Array;
        })
      : undefined;

  if (g && typeof g.getRandomValues === 'function') {
    // Largest multiple of `bound` that fits in 2^32, to reject the biased tail.
    const limit = Math.floor(0x100000000 / bound) * bound;
    const buf = new Uint32Array(1);
    let value = 0;
    do {
      g.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % bound;
  }

  return Math.floor(Math.random() * bound);
}

/**
 * Generate a fresh human-friendly booking reference, e.g. `PP-7K3QW9`.
 *
 * The body draws 6 characters from {@link REFERENCE_ALPHABET}, which by
 * construction excludes the ambiguous `0/O/1/I` glyphs.
 */
export function generateBookingRef(): string {
  let body = '';
  for (let i = 0; i < REFERENCE_BODY_LENGTH; i += 1) {
    body += REFERENCE_ALPHABET[randomIndex(REFERENCE_ALPHABET.length)];
  }
  return `${REFERENCE_PREFIX}-${body}`;
}

/**
 * Normalise a raw / user-entered reference into canonical `PP-XXXXXX` form:
 * uppercase, strip surrounding whitespace, and map the ambiguous characters a
 * human might have written to their intended unambiguous glyph (`O`→`0`? no —
 * we map TOWARD the alphabet: `0`→`O`, `1`→`I`... but I/O are NOT in the
 * alphabet). We therefore fold the confusable pairs to the members that ARE in
 * the alphabet where sensible, then re-apply the `PP-` prefix.
 *
 * Returns the canonicalised string; it does not validate length so callers can
 * decide how strict to be.
 */
export function formatBookingRef(raw: string): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .trim()
    .toUpperCase()
    // Drop everything that isn't alphanumeric so `pp 7k3` or `pp_7k3` normalise.
    .replace(/[^0-9A-Z]/g, '');

  // Strip a leading PP prefix if present so we can re-attach it cleanly.
  const body = cleaned.startsWith(REFERENCE_PREFIX)
    ? cleaned.slice(REFERENCE_PREFIX.length)
    : cleaned;

  // Fold ambiguous glyphs to the ones in our alphabet: O→0 is wrong (0 not in
  // alphabet); instead map 0→O only if it helps? Neither 0 nor O/1/I are valid
  // body chars. We map the confusable inputs to their intended alphabet member:
  //   O -> 0 is invalid; keep the intended letter O? O is excluded. So map the
  //   digit forms the user likely meant to type: treat O as 0 is not allowed.
  // Practical choice: map I->J-adjacent is nonsense. We simply DROP invalid
  // chars from the body so a mistyped ambiguous char is removed rather than
  // silently changing the code. This keeps formatBookingRef lossless for any
  // reference that generateBookingRef produced.
  const validBody = body.replace(
    new RegExp(`[^${REFERENCE_ALPHABET}]`, 'g'),
    ''
  );

  return `${REFERENCE_PREFIX}-${validBody}`;
}

/**
 * Whether a value is a well-formed canonical booking reference
 * (`PP-` + exactly {@link REFERENCE_BODY_LENGTH} alphabet chars).
 */
export function isValidBookingRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const pattern = new RegExp(
    `^${REFERENCE_PREFIX}-[${REFERENCE_ALPHABET}]{${REFERENCE_BODY_LENGTH}}$`
  );
  return pattern.test(value);
}
