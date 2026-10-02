import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeEmail,
  isDisposableDomain,
  emailDomain,
} from '@/lib/identity/email';

// Generators ---------------------------------------------------------------

/** A plausible Gmail local part BEFORE any dot/tag mutation: lowercase
 * alphanumerics, 1..20 chars, so inserting dots/tags produces valid variants
 * and two base-equal variants are guaranteed to collapse together. */
const gmailBaseLocalArb = fc
  .stringMatching(/^[a-z0-9]{1,20}$/);

/** Insert dots at arbitrary positions within a base local part (never leading,
 * trailing, or doubled is NOT required by Gmail — Gmail ignores all dots — but
 * we keep them interior so the result stays a sane-looking address). */
function withDots(base: string, cuts: readonly number[]): string {
  if (base.length <= 1) return base;
  // Normalize cut positions to the interior range [1, len-1], unique + sorted.
  const positions = Array.from(
    new Set(cuts.map((c) => 1 + (((c % (base.length - 1)) + (base.length - 1)) % (base.length - 1))))
  ).sort((a, b) => a - b);
  let out = '';
  let prev = 0;
  for (const p of positions) {
    out += base.slice(prev, p) + '.';
    prev = p;
  }
  out += base.slice(prev);
  return out;
}

const dotsArb = fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 6 });
const tagArb = fc.option(fc.stringMatching(/^[a-z0-9]{1,10}$/), { nil: null });
const gmailHostArb = fc.constantFrom('gmail.com', 'googlemail.com');

/** A messy email-ish string: a grab-bag of valid emails, random junk, and
 * hand-crafted Gmail variants, to exercise idempotency broadly. */
const emailishArb = fc.oneof(
  fc.emailAddress(),
  fc.string(),
  // Gmail variants with random dots/tags/casing/whitespace.
  fc
    .tuple(gmailBaseLocalArb, dotsArb, tagArb, gmailHostArb, fc.boolean())
    .map(([base, cuts, tag, host, pad]) => {
      const local = withDots(base, cuts) + (tag ? `+${tag}` : '');
      const addr = `${local}@${host}`;
      const cased = pad ? addr.toUpperCase() : addr;
      return pad ? `  ${cased}  ` : cased;
    })
);

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 6: normalizeEmail idempotency
//
// For any email-ish string x, normalizing twice equals normalizing once:
//   normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)
//
// Validates: Requirements 9.1, 9.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 6: normalizeEmail is idempotent', () => {
  it('normalizeEmail(normalizeEmail(x)) === normalizeEmail(x) for arbitrary strings', () => {
    fc.assert(
      fc.property(emailishArb, (x) => {
        const once = normalizeEmail(x);
        expect(normalizeEmail(once)).toBe(once);
      }),
      { numRuns: 300 }
    );
  });

  it('is idempotent on hand-crafted Gmail variants', () => {
    for (const x of [
      'j.o.h.n+promo@gmail.com',
      'John.Doe@GoogleMail.com',
      '  a.b.c+tag@gmail.com  ',
      'plainaddress',
      '@nolocal.com',
      'nodomain@',
    ]) {
      const once = normalizeEmail(x);
      expect(normalizeEmail(once)).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 7: Gmail aliases collapse
//
// For a random gmail local part, inserting dots and/or appending a +tag does
// NOT change the normalized result; two different dot/tag variants of the same
// base map to the SAME canonical email; googlemail.com collapses to the same
// identity as gmail.com. Non-Gmail domains are only lowercased/trimmed (NOT
// dot/tag-stripped).
//
// Validates: Requirements 9.1, 9.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 7: Gmail dot/tag aliases collapse to one identity', () => {
  it('dots and +tag never change the normalized gmail address', () => {
    fc.assert(
      fc.property(
        gmailBaseLocalArb,
        dotsArb,
        tagArb,
        gmailHostArb,
        (base, cuts, tag, host) => {
          const canonical = `${base}@gmail.com`;
          const local = withDots(base, cuts) + (tag ? `+${tag}` : '');
          expect(normalizeEmail(`${local}@${host}`)).toBe(canonical);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('two independent dot/tag variants of the same base collapse together', () => {
    fc.assert(
      fc.property(
        gmailBaseLocalArb,
        dotsArb,
        tagArb,
        gmailHostArb,
        dotsArb,
        tagArb,
        gmailHostArb,
        (base, cutsA, tagA, hostA, cutsB, tagB, hostB) => {
          const a = `${withDots(base, cutsA)}${tagA ? `+${tagA}` : ''}@${hostA}`;
          const b = `${withDots(base, cutsB)}${tagB ? `+${tagB}` : ''}@${hostB}`;
          expect(normalizeEmail(a)).toBe(normalizeEmail(b));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('explicit example: j.o.h.n+promo@gmail.com === john@gmail.com', () => {
    expect(normalizeEmail('j.o.h.n+promo@gmail.com')).toBe('john@gmail.com');
    expect(normalizeEmail('john@gmail.com')).toBe('john@gmail.com');
    // googlemail.com collapses to the same identity as gmail.com.
    expect(normalizeEmail('john@googlemail.com')).toBe('john@gmail.com');
    expect(normalizeEmail('jo.hn+x@googlemail.com')).toBe('john@gmail.com');
  });

  it('non-Gmail domains are only lowercased/trimmed, not dot/tag-stripped', () => {
    expect(normalizeEmail('a.b+x@fastmail.com')).toBe('a.b+x@fastmail.com');
    expect(normalizeEmail('  A.B+X@FastMail.com  ')).toBe('a.b+x@fastmail.com');
  });
});

// ---------------------------------------------------------------------------
// Feature: billing-trial-and-payments, Property 8: disposable-domain check
//
// isDisposableDomain(d, set) is true iff d.trim().toLowerCase() is in set, over
// a random blocklist and random domains (members and non-members). The check
// composes with emailDomain (R8.3): a disposable-domain email is flagged via
// isDisposableDomain(emailDomain(email), set).
//
// Validates: Requirements 8.1, 8.3
// ---------------------------------------------------------------------------
describe('Feature: billing-trial-and-payments, Property 8: disposable-domain membership', () => {
  /** A random domain-ish token (lowercase label.tld). */
  const domainArb = fc
    .tuple(
      fc.stringMatching(/^[a-z0-9-]{1,15}$/),
      fc.constantFrom('com', 'net', 'io', 'co', 'xyz')
    )
    .map(([label, tld]) => `${label}.${tld}`);

  const blocklistArb = fc
    .array(domainArb, { maxLength: 20 })
    .map((arr) => new Set(arr.map((d) => d.toLowerCase())));

  it('true iff trimmed+lowercased domain is a member of the set', () => {
    fc.assert(
      fc.property(
        blocklistArb,
        domainArb,
        // Random case + surrounding whitespace to prove robustness.
        fc.boolean(),
        fc.boolean(),
        (blocklist, domain, upper, pad) => {
          const member = blocklist.has(domain.toLowerCase());
          let input = upper ? domain.toUpperCase() : domain;
          if (pad) input = `  ${input}  `;
          expect(isDisposableDomain(input, blocklist)).toBe(member);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('composes with emailDomain to flag disposable-domain emails (R8.3)', () => {
    fc.assert(
      fc.property(
        blocklistArb,
        gmailBaseLocalArb,
        domainArb,
        (blocklist, local, domain) => {
          const email = `${local}@${domain}`;
          const expected = blocklist.has(emailDomain(email));
          expect(isDisposableDomain(emailDomain(email), blocklist)).toBe(
            expected
          );
        }
      ),
      { numRuns: 300 }
    );
  });

  it('explicit examples: member vs non-member', () => {
    const set = new Set(['mailinator.com', 'tempmail.io']);
    expect(isDisposableDomain('mailinator.com', set)).toBe(true);
    expect(isDisposableDomain('  MailInator.com ', set)).toBe(true);
    expect(isDisposableDomain('gmail.com', set)).toBe(false);
    // Via emailDomain on a Gmail alias: the canonical domain is gmail.com.
    expect(isDisposableDomain(emailDomain('a.b+x@mailinator.com'), set)).toBe(
      true
    );
    expect(isDisposableDomain(emailDomain('j.o+t@googlemail.com'), set)).toBe(
      false
    );
  });
});
