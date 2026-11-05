import { describe, expect, it } from 'vitest';
import { parseMapboxFeature, sanitizeLatLng } from '@/lib/geo/mapbox-search';

describe('parseMapboxFeature', () => {
  it('splits a full street address into form fields', () => {
    const a = parseMapboxFeature({
      geometry: { coordinates: [74.35, 31.52] },
      properties: {
        feature_type: 'address',
        name: '12 Main Boulevard',
        full_address: '12 Main Boulevard, Gulberg III, Lahore, Punjab 54660, Pakistan',
        coordinates: { longitude: 74.35, latitude: 31.52 },
        context: {
          address: { name: '12 Main Boulevard' },
          neighborhood: { name: 'Gulberg III' },
          place: { name: 'Lahore' },
          region: { name: 'Punjab' },
          postcode: { name: '54660' },
        },
      },
    });
    expect(a).toEqual({
      street: '12 Main Boulevard',
      city: 'Lahore',
      state: 'Punjab',
      postalCode: '54660',
      fullAddress: '12 Main Boulevard, Gulberg III, Lahore, Punjab 54660, Pakistan',
      lat: 31.52,
      lng: 74.35,
    });
  });

  it('uses the neighbourhood as the street line when there is no street', () => {
    const a = parseMapboxFeature({
      geometry: { coordinates: [73.05, 33.7] },
      properties: { feature_type: 'neighborhood', name: 'F-7', context: { place: { name: 'Islamabad' } } },
    });
    expect(a?.street).toBe('F-7');
    expect(a?.city).toBe('Islamabad');
  });

  it('returns null without coordinates', () => {
    expect(parseMapboxFeature({ properties: { name: 'x' } })).toBeNull();
  });
});

describe('sanitizeLatLng', () => {
  it('accepts valid coordinates and rejects bad ones', () => {
    expect(sanitizeLatLng({ lat: 31.5, lng: 74.3 })).toEqual({ lat: 31.5, lng: 74.3 });
    expect(sanitizeLatLng({ lat: 91, lng: 0 })).toBeUndefined();
    expect(sanitizeLatLng({ lat: '31', lng: 74 })).toBeUndefined();
    expect(sanitizeLatLng({ lat: NaN, lng: 0 })).toBeUndefined();
    expect(sanitizeLatLng(null)).toBeUndefined();
  });
});
