'use client';

/**
 * ServiceAreaMap — the Groomer Portal control for drawing an exact service area
 * polygon on a Mapbox GL map (Master Spec §10.4 — drawn service area).
 *
 * A client-only Mapbox GL map wired to `@mapbox/mapbox-gl-draw`, exposing just
 * the polygon + trash tools so a groomer can trace exactly where they travel.
 * The drawn shape is reported back as a GeoJSON {@link GeoPolygon} (`[lng, lat]`
 * order — longitude first) via `onChange`, and seeded from `value` on load so
 * an already-saved area reopens for editing. The surrounding form (see
 * `BusinessSettings.tsx`) persists it through the existing settings action;
 * when no polygon is drawn the booking flow falls back to the service radius.
 *
 * ONE AREA ONLY: v1 service areas are a single polygon. The draw control would
 * happily let a groomer draw several, so {@link syncFromDraw} enforces the
 * constraint pragmatically — if more than one polygon exists it keeps the LAST
 * feature in the collection (the most-recently-drawn) and deletes the rest,
 * then reports that single shape.
 *
 * SSR SAFETY: Mapbox GL touches `window`, so this module must only ever be
 * imported through `next/dynamic(..., { ssr: false })` — never by a server
 * component. It also guards internally with a `mounted` flag and never paints
 * the map until the browser has.
 *
 * DEGRADE, DON'T CRASH: without a usable browser token
 * (`NEXT_PUBLIC_MAPBOX_TOKEN`, Master Spec §11.2 — Mapbox GL needs a *real*
 * token) we render a calm bordered notice instead of a map; and if map
 * construction throws (e.g. no WebGL) we flip an `errored` flag and render the
 * same notice rather than hard-failing the settings page.
 *
 * No custom GL layers are added here (Draw supplies its own styles), so unlike
 * {@link TrackerMapbox} this component never needs to read the DaisyUI `--p`
 * CSS variable into a paint property.
 *
 * _Master Spec: §10.4, §11.2_
 */
import * as React from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { isValidPolygon, type GeoPolygon } from '@/lib/routing/service-area';

export interface ServiceAreaMapProps {
  /** Public Mapbox browser token; a falsy/placeholder value degrades to the notice. */
  token: string | null;
  /** The groomer's base location, used to centre the map on first paint. */
  baseLocation: { lat: number; lng: number } | null;
  /** The currently-saved service area, seeded into the draw control on load. */
  value: GeoPolygon | null;
  /** Called with the drawn polygon, or `null` when the area is cleared. */
  onChange: (poly: GeoPolygon | null) => void;
}

/**
 * Is a non-empty, non-placeholder Mapbox token configured? Mirrors the inline
 * `isMapboxToken` helper in `TrackerView.tsx` (empty / `…replace_me` / `your-…`
 * ⇒ "not configured") so this client component never imports server-only config.
 */
function isMapboxToken(value: string | null | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  if (t.includes('replace_me') || t.startsWith('your-')) return false;
  return true;
}

/**
 * The calm bordered fallback shown when there's no usable token or the map
 * failed to construct — explains how to enable drawing without crashing.
 */
function Notice() {
  return (
    <div className="rounded-box border border-base-content/10 bg-base-200 p-4 text-sm text-base-content/70">
      Add a Mapbox token (<code className="font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</code>) to draw an
      exact service area on a map. Until then, bookings use the service radius above.
    </div>
  );
}

/** The height the map shares with its skeleton so swaps don't jump the layout. */
const MAP_HEIGHT = 'h-72 sm:h-96';

function ServiceAreaMap({ token, baseLocation, value, onChange }: ServiceAreaMapProps) {
  const [mounted, setMounted] = React.useState(false);
  const [errored, setErrored] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(null);
  const drawRef = React.useRef<MapboxDraw | null>(null);

  // Keep the latest callback/seed in refs so the create-once effect never
  // needs them in its dependency list (and so handlers read fresh values).
  const onChangeRef = React.useRef(onChange);
  const valueRef = React.useRef(value);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  React.useEffect(() => setMounted(true), []);

  // Create the map once mounted with a usable token. Wrapped in try/catch so a
  // missing-WebGL / unsupported environment degrades to the notice instead of
  // crashing the settings page.
  React.useEffect(() => {
    if (!mounted || !isMapboxToken(token) || !containerRef.current) return;

    const center: [number, number] = baseLocation
      ? [baseLocation.lng, baseLocation.lat]
      : [0, 20];
    const initialZoom = baseLocation ? 11 : 1.5;

    let map: mapboxgl.Map;
    let draw: MapboxDraw;
    try {
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center,
        zoom: initialZoom,
        attributionControl: true,
      });

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

      draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
      });
      // Draw's control typing can be looser than mapbox-gl's `IControl`; cast
      // defensively so tsc stays happy across the two packages' versions.
      map.addControl(draw as unknown as mapboxgl.IControl);
    } catch {
      setErrored(true);
      return;
    }

    /**
     * Read the current drawing, enforce the single-area constraint, and report
     * the result. Polygon features are collected from the FeatureCollection;
     * if more than one exists we keep only the LAST (most recently drawn) and
     * delete the rest — a pragmatic "one area" rule, since Draw's feature order
     * is otherwise not a reliable "most recent" signal to sort on.
     */
    const syncFromDraw = () => {
      const collection = draw.getAll() as unknown as GeoJSON.FeatureCollection;
      const polygons = collection.features.filter(
        (f) => f.geometry?.type === 'Polygon',
      ) as Array<GeoJSON.Feature<GeoJSON.Polygon>>;

      if (polygons.length === 0) {
        onChangeRef.current(null);
        return;
      }

      // More than one polygon: keep the last, drop the older ones, re-read.
      if (polygons.length > 1) {
        const olderIds = polygons
          .slice(0, -1)
          .map((f) => f.id)
          .filter((id): id is string => typeof id === 'string');
        if (olderIds.length > 0) draw.delete(olderIds);
      }

      const latest = polygons[polygons.length - 1];
      onChangeRef.current({
        type: 'Polygon',
        coordinates: latest.geometry.coordinates,
      });
    };

    const onLoad = () => {
      // Seed an already-saved area so it reopens for editing.
      const seed = valueRef.current;
      if (seed && isValidPolygon(seed)) {
        draw.add({ type: 'Feature', properties: {}, geometry: seed });
      }
    };

    map.on('load', onLoad);
    map.on('draw.create', syncFromDraw);
    map.on('draw.update', syncFromDraw);
    map.on('draw.delete', syncFromDraw);

    mapRef.current = map;
    drawRef.current = draw;

    return () => {
      map.off('load', onLoad);
      map.off('draw.create', syncFromDraw);
      map.off('draw.update', syncFromDraw);
      map.off('draw.delete', syncFromDraw);
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // Create the map exactly once per mount; `baseLocation`/`value`/`onChange`
    // are read through refs so a changed seed never tears down the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, token]);

  // No usable token, not yet painted, or construction failed: calm notice.
  if (!isMapboxToken(token) || !mounted || errored) {
    return <Notice />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className={`${MAP_HEIGHT} relative w-full overflow-hidden rounded-box border border-base-content/10 shadow-card`}
      />
      <p className="text-xs text-base-content/60">
        Draw your service area with the polygon tool; use the trash tool to clear it.
      </p>
    </div>
  );
}

export default ServiceAreaMap;
