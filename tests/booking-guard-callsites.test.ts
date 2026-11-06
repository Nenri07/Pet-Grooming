/**
 * Booking guard call sites (plan-claims-audit, task 2.3).
 *
 * The real `booking-guard` module is used so the real `BookingsPausedError` is
 * thrown; only the entitlement lookup and the I/O around each call site are
 * mocked. Each entry point must refuse a lapsed groomer before it holds,
 * books or claims anything, and must proceed normally for an active one.
 *
 * _Requirements: 2.2_
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEntitlements: vi.fn(),
  createHold: vi.fn(),
  fulfilFreeBooking: vi.fn(),
  isRedisConfigured: vi.fn(),
  getClaim: vi.fn(),
  tryWinClaim: vi.fn(),
}));

vi.mock('@/lib/billing/entitlements', () => ({
  getEntitlements: mocks.getEntitlements,
}));

vi.mock('@/lib/db/connect', () => ({
  connectDB: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db/models/groomer-profile', () => ({
  GroomerProfile: {
    findOne: vi.fn(() => ({
      select: () => ({ lean: async () => ({ userId: 'g1' }) }),
    })),
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  holdRateLimit: vi.fn(() => null),
  checkRateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/redis', () => ({
  isRedisConfigured: mocks.isRedisConfigured,
  getClaim: mocks.getClaim,
  tryWinClaim: mocks.tryWinClaim,
}));

vi.mock('@/lib/calendar/holds', async () => {
  class SlotHeldError extends Error {}
  return { createHold: mocks.createHold, SlotHeldError };
});

vi.mock('@/lib/booking/fulfil', () => ({
  fulfilFreeBooking: mocks.fulfilFreeBooking,
}));

import { POST } from '@/app/api/booking/hold/route';
import { finalizeFreeBooking } from '@/actions/booking-free';
import { confirmClaim } from '@/lib/fill/claim';
import { BOOKINGS_PAUSED_MESSAGE } from '@/lib/billing/booking-guard';

const HOUR_MS = 60 * 60 * 1000;

function holdRequest(): Request {
  const startMs = Date.now() + 24 * HOUR_MS;
  return new Request('http://localhost/api/booking/hold', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({
      groomerSlug: 'happy-paws',
      startMs,
      endMs: startMs + HOUR_MS,
      clientEmail: 'Client@Example.com',
    }),
  });
}

function freeBookingInput() {
  const slotStartMs = Date.now() + 24 * HOUR_MS;
  return {
    groomerSlug: 'happy-paws',
    pet: { name: 'Rex', species: 'dog' },
    owner: {
      name: 'Jane Client',
      email: 'jane@example.com',
      phone: '+15555550100',
      address: { street: '1 Main St', city: 'Town', state: 'CA', zip: '90000' },
    },
    slotStartMs,
    slotEndMs: slotStartMs + HOUR_MS,
  } as unknown as Parameters<typeof finalizeFreeBooking>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isRedisConfigured.mockReturnValue(false);
  mocks.fulfilFreeBooking.mockResolvedValue({
    ok: true,
    summary: { appointmentId: 'a1' },
  });
});

describe('booking guard call sites: lapsed groomer', () => {
  beforeEach(() => {
    mocks.getEntitlements.mockResolvedValue({ active: false });
  });

  it('POST /api/booking/hold returns 403 bookings_paused and places no hold', async () => {
    const res = await POST(holdRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'bookings_paused' });
    expect(mocks.getEntitlements).toHaveBeenCalledWith('g1');
    expect(mocks.createHold).not.toHaveBeenCalled();
  });

  it('finalizeFreeBooking returns the paused message and does not book', async () => {
    const result = await finalizeFreeBooking(freeBookingInput());
    expect(result).toEqual({ ok: false, error: BOOKINGS_PAUSED_MESSAGE });
    expect(mocks.getEntitlements).toHaveBeenCalledWith('g1');
    expect(mocks.fulfilFreeBooking).not.toHaveBeenCalled();
  });

  it('confirmClaim returns bookings_paused without winning the slot', async () => {
    mocks.isRedisConfigured.mockReturnValue(true);
    mocks.getClaim.mockResolvedValue({
      gid: 'g1',
      startMs: Date.now() + 24 * HOUR_MS,
      clientId: 'c1',
    });
    const result = await confirmClaim('token-1');
    expect(result).toEqual({ ok: false, reason: 'bookings_paused' });
    expect(mocks.getEntitlements).toHaveBeenCalledWith('g1');
    expect(mocks.tryWinClaim).not.toHaveBeenCalled();
  });
});

describe('booking guard call sites: active groomer', () => {
  beforeEach(() => {
    mocks.getEntitlements.mockResolvedValue({ active: true });
  });

  it('POST /api/booking/hold returns the synthetic OK when Redis is unconfigured', async () => {
    const res = await POST(holdRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, held: false, holdId: null });
  });

  it('finalizeFreeBooking proceeds to fulfilFreeBooking', async () => {
    const result = await finalizeFreeBooking(freeBookingInput());
    expect(mocks.fulfilFreeBooking).toHaveBeenCalledTimes(1);
    expect(mocks.fulfilFreeBooking).toHaveBeenCalledWith(
      expect.objectContaining({ groomerSlug: 'happy-paws', smsConsent: false })
    );
    expect(result).toEqual({ ok: true, summary: { appointmentId: 'a1' } });
  });

  it('confirmClaim gets past the guard and attempts the win', async () => {
    mocks.isRedisConfigured.mockReturnValue(true);
    mocks.getClaim.mockResolvedValue({
      gid: 'g1',
      startMs: Date.now() + 24 * HOUR_MS,
      clientId: 'c1',
    });
    mocks.tryWinClaim.mockResolvedValue(false);
    const result = await confirmClaim('token-1');
    expect(mocks.tryWinClaim).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: 'taken' });
  });
});
