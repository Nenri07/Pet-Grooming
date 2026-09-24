import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { buildClientSearchFilter } from '@/actions/clients';

// Feature: pawport, Property 7: Client search returns only scoped results
//
// For any search query and any groomer, the built query filter ALWAYS
// constrains results to that groomer (groomerId), so no other groomer's
// clients could match.
//
// buildClientSearchFilter is a PURE, DB-free helper. Because its module is
// marked 'use server' (which only permits async exports) the helper is async,
// so every property awaits it via fast-check's async-property support.
//
// Validates: Requirements 10.1, 10.2

/** Arbitrary groomer id: any non-empty string. */
const groomerIdArb = fc.string({ minLength: 1 });

/**
 * Arbitrary query strings covering the interesting shapes: ordinary strings,
 * empty/whitespace-only strings, and strings peppered with regex metacharacters
 * (which the helper must escape rather than choke on).
 */
const REGEX_METACHARS = '.*+?^${}()|[]\\';
const queryArb = fc.oneof(
  fc.string(),
  // Whitespace-only / empty queries.
  fc.constantFrom('', ' ', '   ', '\t', '\n', ' \t\n '),
  // Queries containing regex metacharacters mixed with plain text.
  fc
    .array(
      fc.oneof(
        fc.constantFrom(...REGEX_METACHARS.split('')),
        fc.constantFrom('a', 'b', '1', '2', '@', '.', ' ')
      ),
      { minLength: 1, maxLength: 20 }
    )
    .map((chars) => chars.join(''))
);

describe('Feature: pawport, Property 7: Client search returns only scoped results', () => {
  it('always scopes the filter to the given groomerId', async () => {
    await fc.assert(
      fc.asyncProperty(groomerIdArb, queryArb, async (groomerId, query) => {
        const filter = await buildClientSearchFilter(groomerId, query);
        // The scoping guarantee: results can never leak across groomers.
        expect(filter.groomerId).toBe(groomerId);
      }),
      { numRuns: 200 }
    );
  });

  it('adds NO $or when the trimmed query is empty (lists all for the groomer)', async () => {
    // Generator biased toward empty/whitespace-only queries.
    const blankQueryArb = fc.constantFrom('', ' ', '   ', '\t', '\n', '\r', ' \t \n ');

    await fc.assert(
      fc.asyncProperty(groomerIdArb, blankQueryArb, async (groomerId, query) => {
        fc.pre(query.trim().length === 0);
        const filter = await buildClientSearchFilter(groomerId, query);
        expect(filter.groomerId).toBe(groomerId);
        expect('$or' in filter).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('adds an $or of exactly 3 case-insensitive regex conditions for a non-empty query', async () => {
    await fc.assert(
      fc.asyncProperty(groomerIdArb, queryArb, async (groomerId, query) => {
        fc.pre(query.trim().length >= 1);
        const filter = await buildClientSearchFilter(groomerId, query);

        // groomerId scoping still holds alongside the $or.
        expect(filter.groomerId).toBe(groomerId);

        const or = filter.$or;
        expect(Array.isArray(or)).toBe(true);
        expect((or as unknown[]).length).toBe(3);

        const conditions = or as Array<Record<string, { $regex: unknown; $options: unknown }>>;
        const fields = conditions.map((c) => Object.keys(c)[0]);
        // One condition each for name, email, phone.
        expect(fields).toEqual(['name', 'email', 'phone']);

        for (const condition of conditions) {
          const field = Object.keys(condition)[0];
          const matcher = condition[field];
          expect(typeof matcher.$regex).toBe('string');
          // Case-insensitive match.
          expect(matcher.$options).toBe('i');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('handles regex-metacharacter queries without throwing and stays groomer-scoped', async () => {
    // Queries built to be dense with regex metacharacters.
    const metacharQueryArb = fc
      .array(fc.constantFrom(...REGEX_METACHARS.split('')), { minLength: 1, maxLength: 20 })
      .map((chars) => chars.join(''));

    await fc.assert(
      fc.asyncProperty(groomerIdArb, metacharQueryArb, async (groomerId, query) => {
        // Must not throw while escaping the metacharacters.
        const filter = await buildClientSearchFilter(groomerId, query);
        expect(filter.groomerId).toBe(groomerId);
      }),
      { numRuns: 200 }
    );
  });
});
