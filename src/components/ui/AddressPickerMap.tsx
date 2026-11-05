'use client';

/**
 * AddressPickerMap — the Mapbox GL map inside the address picker dialog.
 *
 * A fixed pin sits in the centre; the user drags/zooms the map under it and
 * the centre is reported on every `moveend`. Client-only (Mapbox touches
 * `window`); loaded through next/dynamic with ssr:false by AddressPicker.
 */
import * as React from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin } from 'lucide-react';
import type { LatLng } from '@/lib/geo/mapbox-search';

export interface AddressPickerMapProps {
  token: string;
  /** Where the map should be centred. Changing it flies the map there. */
  center: LatLng;
  zoom?: number;
  /** Called with the pin position after the user stops moving the map. */
  onMoveEnd: (center: LatLng) => void;
}

export function AddressPickerMap({ token, center, zoom = 16, onMoveEnd }: AddressPickerMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(null);
  const onMoveEndRef = React.useRef(onMoveEnd);
  const [errored, setErrored] = React.useState(false);

  React.useEffect(() => {
    onMoveEndRef.current = onMoveEnd;
  });

  // Create once.
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: mapboxgl.Map;
    try {
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [center.lng, center.lat],
        zoom,
      });
    } catch {
      setErrored(true);
      return;
    }
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('moveend', () => {
      const c = map.getCenter();
      onMoveEndRef.current({ lat: c.lat, lng: c.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Follow external centre changes (search result / "use my location").
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    if (Math.abs(c.lat - center.lat) < 1e-7 && Math.abs(c.lng - center.lng) < 1e-7) return;
    map.flyTo({ center: [center.lng, center.lat], zoom: Math.max(map.getZoom(), zoom), speed: 1.6 });
  }, [center.lat, center.lng, zoom]);

  if (errored) {
    return (
      <div className="flex h-72 items-center justify-center rounded-box border border-base-content/10 bg-base-200 p-4 text-center text-sm text-base-content/70">
        The map couldn&apos;t load on this device. Search for your address above instead.
      </div>
    );
  }

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-box border border-base-content/10 sm:h-80">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Fixed centre pin: its tip marks the exact spot. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <MapPin className="h-10 w-10 fill-primary text-primary-content drop-shadow" aria-hidden="true" />
      </div>
    </div>
  );
}

export default AddressPickerMap;
