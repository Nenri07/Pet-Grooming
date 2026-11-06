/**
 * Unit tests for the pure `shapeSlotsForPlan` helper (plan-claims-audit 3.1).
 * _Requirements: 1.1, 1.2_
 */
import { describe, expect, it } from 'vitest';
import { shapeSlotsForPlan } from '@/lib/calendar/slot-shaping';
import type { TimeSlot } from '@/types';

const at = (iso: string) => new Date(iso);

const ranked: TimeSlot[] = [
  { start: at('2025-03-03T11:00:00Z'), end: at('2025-03-03T12:00:00Z'), available: true, label: 'Best fit', extraDriveMin: 4 },
  { start: at('2025-03-03T09:00:00Z'), end: at('2025-03-03T10:00:00Z'), available: true, label: 'Nearby stop', extraDriveMin: 9 },
  { start: at('2025-03-03T10:00:00Z'), end: at('2025-03-03T11:00:00Z'), available: true },
];

describe('shapeSlotsForPlan', () => {
  it('returns the slots unchanged when routing is allowed', () => {
    const out = shapeSlotsForPlan(ranked, { routingAllowed: true });
    expect(out).toBe(ranked);
    expect(out[0].label).toBe('Best fit');
  });

  it('sorts by start and strips route labels when routing is not allowed', () => {
    const out = shapeSlotsForPlan(ranked, { routingAllowed: false });
    expect(out.map((s) => s.start.toISOString())).toEqual([
      '2025-03-03T09:00:00.000Z',
      '2025-03-03T10:00:00.000Z',
      '2025-03-03T11:00:00.000Z',
    ]);
    for (const s of out) {
      expect(s.label).toBeUndefined();
      expect(s.extraDriveMin).toBeUndefined();
    }
    // Input is not mutated.
    expect(ranked[0].label).toBe('Best fit');
  });

  it('handles ISO-string starts (serialized slots) and empty lists', () => {
    const out = shapeSlotsForPlan(
      [
        { start: '2025-03-03T10:00:00.000Z', label: 'Best fit', extraDriveMin: 2 },
        { start: '2025-03-03T08:00:00.000Z' },
      ],
      { routingAllowed: false }
    );
    expect(out.map((s) => s.start)).toEqual(['2025-03-03T08:00:00.000Z', '2025-03-03T10:00:00.000Z']);
    expect(shapeSlotsForPlan([], { routingAllowed: false })).toEqual([]);
  });
});
