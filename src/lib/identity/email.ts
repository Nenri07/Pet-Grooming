/**
 * Email identity — the pure core for Gmail-alias collapsing and disposable-domain
 * membership checks (Phase 2 abuse prevention).
 *
 * Three pure functions, no I/O: they take plain strings (and, for the blocklist
 * check, an explicitly-injected `ReadonlySet<string>`), so they are directly
 * unit- and property-testable. Nothing here imports Mongoose, Stripe, Redis, or
 * reads any file — the blocklist LOADING (from a maintainable file/remote source)
 * is a separate I/O concern owned by the caller (R8.2), which also implements the
 * fail-open policy when that load fails (R8.4). These functions only decide
 * membership over the Set it hands them.
 *
 * The canonical normalized email these functions produce is what the rest of the
 * pipeline uses as the uniqueness key for "has this identity already consumed a
 * trial?" (R9.2) and as the input whose domain the disposable check runs against
 * (R8.3). The groomer's originally-submitted email is preserved elsewhere for
 * display/delivery (R9.4) — normalization never mutates the stored original.
 *
 * _Requirements: 8.1 (reject disposable domains — the membership predicate),
 * 8.3 (disposable check runs on the NORMALIZED email's domain), 9.1 (Gmail:
 * strip local-part dots + drop `+tag`), 9.2 (canonical form is the uniqueness
 * key), 9.3 (two aliases of one mailbox collapse to the same canonical email),
 * 9.4 (normalization is non-destructive — callers keep the original separately)._
 * _Design: Pure Functions → `src/lib/identity/email.ts`._
 */

/**
 * Gmail-equivalent domains whose mailboxes ignore dots in the local part and
 * treat everything from the first `+` as a disposable tag. `googlemail.com` is
 * the legacy/German alias of `gmail.com` and routes to the exact same mailbox,
 * so we additionally rewrite that domain to `gmail.com` (see
 * {@link normalizeEmail}) — otherwise `a@gmail.com` and `a@googlemail.com`,
 * which are the same inbox, would hash to two distinct identities and both
 * farm a trial (R9.3).
 *
 * This set is intentionally scoped to Google only. Several other providers also
 * honour `+tags`, but R9 is explicitly about Gmail-alias collapsing, so we do
 * NOT speculatively strip dots/tags for other domains — doing so would risk
 * merging genuinely-distinct mailboxes at providers where a dot is significant.
 */
const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/** The domain all Gmail-equivalent addresses canonicalize to (R9.3). */
const GMAIL_CANONICAL_DOMAIN = 'gmail.com';

/**
 * Produce the canonical form of an email address (R9).
 *
 * Steps:
 *   1. Trim surrounding whitespace and lowercase the WHOLE address. Email
 *      domains are case-insensitive, and treating the local part as
 *      case-insensitive too is the pragmatic choice for an identity key (the
 *      vast majority of real-world mailboxes are case-insensitive, and this
 *      keeps the function total and idempotent).
 *   2. Split into `localPart` + `domain` on the LAST `@` (an address may legally
 *      contain a quoted `@` in the local part; splitting on the last one keeps
 *      the real domain intact). If the input is malformed — no `@`, or an empty
 *      local part or empty domain — return the trimmed-lowercased input
 *      unchanged. This is defensive: validation is a separate concern, and a
 *      malformed string must still map to a stable, idempotent canonical value.
 *   3. For Gmail-equivalent domains ({@link GMAIL_DOMAINS}): remove ALL dots
 *      from the local part and drop any `+tag` suffix (everything from the first
 *      `+`), then rewrite the domain to {@link GMAIL_CANONICAL_DOMAIN} so
 *      `gmail.com` and `googlemail.com` collapse together (R9.1, R9.3).
 *   4. For every other domain: no dot/tag stripping — only the lowercase+trim
 *      from step 1 applies. Only Gmail collapses aliases (R9 is Gmail-scoped);
 *      stripping dots elsewhere could merge distinct mailboxes.
 *
 * IDEMPOTENT by construction: the output of step 3/4 contains no uppercase, no
 * surrounding whitespace, no local-part dots (for Gmail) and no `+tag`, so a
 * second pass finds nothing left to change —
 * `normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)` for all inputs,
 * including malformed ones (which hit the step-2 early return both times).
 *
 * Pure: `(email) -> string`. Never throws for any string input.
 *
 * @param email The raw, user-submitted email address.
 * @returns The canonical normalized email used as the identity uniqueness key.
 */
export function normalizeEmail(email: string): string {
  // Step 1: trim + lowercase the whole address.
  const lowered = email.trim().toLowerCase();

  // Step 2: split on the LAST '@' so a quoted '@' in the local part can't hide
  // the real domain.
  const atIndex = lowered.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === lowered.length - 1) {
    // No '@', empty local part, or empty domain → malformed. Return the
    // trimmed/lowercased value unchanged (defensive, still idempotent).
    return lowered;
  }

  const localPart = lowered.slice(0, atIndex);
  const domain = lowered.slice(atIndex + 1);

  // Step 4: non-Gmail domains get lowercase+trim only (already applied).
  if (!GMAIL_DOMAINS.has(domain)) {
    return `${localPart}@${domain}`;
  }

  // Step 3: Gmail-equivalent — drop the '+tag' suffix, then remove all dots.
  const plusIndex = localPart.indexOf('+');
  const untagged = plusIndex === -1 ? localPart : localPart.slice(0, plusIndex);
  const dotless = untagged.split('.').join('');

  // Rewrite googlemail.com → gmail.com so the two aliases share one identity.
  return `${dotless}@${GMAIL_CANONICAL_DOMAIN}`;
}

/**
 * Whether `domain` is on the injected disposable-email blocklist (R8).
 *
 * A pure membership predicate over a `ReadonlySet<string>` the caller supplies.
 * The caller owns loading that Set from a maintainable source (R8.2) and owns
 * the fail-open behaviour when the load fails (R8.4) — this function makes no
 * I/O and simply answers "is this domain blocked?".
 *
 * The `domain` is lowercased and trimmed before lookup so the predicate is
 * robust to casing/whitespace; callers should populate `blocklist` with
 * already-lowercased domain entries. Pass the domain of the NORMALIZED email
 * (see {@link emailDomain}) so the check runs against the canonical identity
 * (R8.3).
 *
 * Pure: `(domain, blocklist) -> boolean`.
 *
 * @param domain    The email domain to test (e.g. `mailinator.com`).
 * @param blocklist The set of disposable domains, injected by the caller.
 * @returns `true` iff the lowercased/trimmed `domain` is present in `blocklist`.
 */
export function isDisposableDomain(domain: string, blocklist: ReadonlySet<string>): boolean {
  return blocklist.has(domain.trim().toLowerCase());
}

/**
 * Extract the domain of an email in its canonical normalized form (R8.3).
 *
 * Normalizes `email` with {@link normalizeEmail} first, then returns everything
 * after the last `@`. For a malformed address with no `@`, returns the empty
 * string (a value that will never be a member of a well-formed blocklist, so a
 * downstream {@link isDisposableDomain} check safely reports `false`).
 *
 * This is the intended bridge between the two functions above: run the
 * disposable check against `emailDomain(submittedEmail)` so blocking decisions
 * are made on the same canonical identity used for uniqueness (R8.3, R9.2).
 *
 * Pure: `(email) -> string`.
 *
 * @param email The raw, user-submitted email address.
 * @returns The normalized domain, or `''` when the address has no `@`.
 */
export function emailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  return atIndex === -1 ? '' : normalized.slice(atIndex + 1);
}
