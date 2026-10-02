/**
 * NominatimGeocodeProvider unit tests (Master Spec §10.1).
 *
 * Hermetic: global `fetch` is mocked and Redis is stubbed as UNCONFIGURED, so
 * no real network and no cache round-trips happen. We assert the three
 * behaviours that matter for safe routing degradation:
 *
 *   (a) a well-formed Nominatim response resolves to the right {lat,lng};
 *   (b) a network rejection resolves to null (NEVER throws);
 *   (c) an empty address resolves to null WITHOUT calling fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the Redis seam so the provider's cache branch is a no-op and we exercise
// the network path directly. `isRedisConfigured` returns false, so cacheGet /
// cacheSet are never consulted — but we provide them anyway for completeness.
vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => false,
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  keys: { geocode: (hash: string) => `geo:${hash}` },
  TTL: { GEOCODE: 30 * 24 * 60 * 60 },
}));

import { NominatimGeocodeProvider } from '@/lib/routing/providers/geocode';

describe('NominatimGeocodeProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) resolves a well-formed response to the right {lat,lng}', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ lat: '31.5204', lon: '74.3587' }],
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const provider = new NominatimGeocodeProvider();
    const result = await provider.geocode('Lahore, Pakistan');

    expect(result).toEqual({ lat: 31.5204, lng: 74.3587 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(b) resolves to null on a network rejection (no throw)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const provider = new NominatimGeocodeProvider();
    await expect(provider.geocode('123 Main St')).resolves.toBeNull();
  });

  it('(c) resolves to null for an empty address without calling fetch', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const provider = new NominatimGeocodeProvider();
    await expect(provider.geocode('   ')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the result is out of coordinate range', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ lat: '999', lon: '0' }],
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const provider = new NominatimGeocodeProvider();
    await expect(provider.geocode('Nowhere')).resolves.toBeNull();
  });
});
