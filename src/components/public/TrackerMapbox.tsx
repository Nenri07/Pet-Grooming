'use client';

/**
 * TrackerMapbox — the Mapbox GL JS variant of the public tracker map (Master
 * Spec §11.2).
 *
 * A client-only Mapbox GL map rendering the `streets-v12` style when a public
 * browser token (`NEXT_PUBLIC_MAPBOX_TOKEN`) is configured. It mirrors
 * {@link TrackerMap} (the Leaflet + OpenStreetMap fallback) exactly: same
 * props, same `MAP_HEIGHT`, same wrapper/border/shadow, same ETA badge, and
 * the *same* inline-SVG markers (reusing the `pp-marker` CSS classes from
 * `globals.css`) so the two are visually interchangeable. The live groomer
 * "van" marker moves toward the client's destination pin along a dashed route
 * line, and the viewport re-fits as positions arrive.
 *
 * SSR SAFETY: Mapbox GL touches `window`, so this module must only ever be
 * imported by a `next/dynamic(..., { ssr: false })` call — never by a server
 * component. It also guards internally with a `mounted` flag and renders a
 * calm skeleton until the browser paints.
 *
 * DEGRADE, DON'T CRASH: `mapboxgl.supported?.()` is deprecated in v3, so we
 * instead wrap `new mapboxgl.Map(...)` in try/catch; if construction throws
 * (e.g. no WebGL), we flip an `errored` flag and render the same calm skeleton
 * as the Leaflet map rather than hard-failing.
 *
 * THEME COLOUR CAVEAT: Mapbox GL paints into a WebGL canvas and does NOT read
 * CSS custom properties, so `hsl(var(--p))` won't resolve for the route line.
 * We read the resolved DaisyUI `--p` triple from the document element at
 * runtime and wrap it as `hsl(<triple>)`, falling back to a primary-ish hex
 * when it's empty.
 *
 * _Master Spec: §11.2_
 */
import * as React from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type Point = { lat: number; lng: number };

export interface TrackerMapboxProps {
  van: Point | null;
  destination: Point | null;
  etaLabel: string | null;
  business: string;
  /** Public Mapbox browser token; the parent only mounts us when it's set. */
  token: string;
}

/** The height the map and its skeleton share, so swaps don't jump the layout. */
const MAP_HEIGHT = 'h-72 sm:h-80';

/** The GeoJSON source + layer id for the dashed van→destination route line. */
const ROUTE_SOURCE = 'pp-route';
const ROUTE_LAYER = 'pp-route-line';

/**
 * Resolve the route-line colour. Mapbox GL doesn't read CSS vars, so we grab
 * the computed DaisyUI `--p` triple (an `h s l` string) and wrap it as an
 * `hsl(...)` value, falling back to a primary-ish hex when it's unavailable.
 */
function routeColor(): string {
  if (typeof window === 'undefined') return '#4f46e5';
  const triple = getComputedStyle(document.documentElement)
    .getPropertyValue('--p')
    .trim();
  return triple ? `hsl(${triple})` : '#4f46e5';
}

/**
 * Van marker element — the same inline-SVG van + pulse markup and `pp-marker`
 * classes as the Leaflet `divIcon`, so the look is identical with no new CSS.
 */
function vanElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pp-marker pp-marker--van';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Groomer van');
  el.innerHTML = `
    <span class="pp-marker__pulse"></span>
    <span class="pp-marker__badge">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <path d="M1 3h13v10H1z" />
        <path d="M14 7h4l3 3v3h-7z" />
        <circle cx="5.5" cy="16" r="2" />
        <circle cx="17.5" cy="16" r="2" />
      </svg>
    </span>`;
  return el;
}

/**
 * Destination/home pin element — the same home-pin SVG + `pp-marker` classes
 * as the Leaflet `divIcon`.
 */
function homeElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pp-marker pp-marker--home';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Destination');
  el.innerHTML = `
    <span class="pp-marker__pin">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    </span>`;
  return el;
}

/** Build the route line as a GeoJSON LineString between the two points. */
function routeData(
  van: Point | null,
  destination: Point | null,
): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: [number, number][] =
    van && destination
      ? [
          [van.lng, van.lat],
          [destination.lng, destination.lat],
        ]
      : [];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };
}

export function TrackerMapbox({
  van,
  destination,
  etaLabel,
  business,
  token,
}: TrackerMapboxProps) {
  const [mounted, setMounted] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [errored, setErrored] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(null);
  const vanMarkerRef = React.useRef<mapboxgl.Marker | null>(null);
  const homeMarkerRef = React.useRef<mapboxgl.Marker | null>(null);

  React.useEffect(() => setMounted(true), []);

  // Create the map once the container is painted. Wrapped in try/catch so a
  // missing-WebGL / unsupported environment degrades to the skeleton instead
  // of crashing the tracker (v3 dropped `mapboxgl.supported`).
  React.useEffect(() => {
    if (!mounted || errored || !containerRef.current) return;

    // Prefer the van, then the destination, else a neutral world view; the
    // position effect re-fits as soon as real points arrive.
    const center: [number, number] = van
      ? [van.lng, van.lat]
      : destination
        ? [destination.lng, destination.lat]
        : [0, 20];
    const initialZoom = van || destination ? 14 : 2;

    let map: mapboxgl.Map;
    try {
      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center,
        zoom: initialZoom,
        attributionControl: true,
      });
    } catch {
      setErrored(true);
      return;
    }

    map.scrollZoom.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    const onLoad = () => {
      // Route source + dashed line layer, added once the style is ready.
      if (!map.getSource(ROUTE_SOURCE)) {
        map.addSource(ROUTE_SOURCE, {
          type: 'geojson',
          data: routeData(van, destination),
        });
        map.addLayer({
          id: ROUTE_LAYER,
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': routeColor(),
            'line-width': 3,
            'line-opacity': 0.7,
            'line-dasharray': [2, 2],
          },
        });
      }
      setReady(true);
    };
    map.on('load', onLoad);

    mapRef.current = map;

    return () => {
      map.off('load', onLoad);
      map.remove();
      mapRef.current = null;
      vanMarkerRef.current = null;
      homeMarkerRef.current = null;
      setReady(false);
    };
    // Create the map exactly once per mount; position changes are handled by
    // the dedicated effect below so we never tear down the whole map on a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, errored, token]);

  // React to van/destination changes: move (or create) markers, refresh the
  // route source, and re-fit the viewport. Only runs once the style is ready.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // Van marker — centre anchored, created lazily then reused. Carries the
    // same business (+ ETA) popup as the Leaflet map so clicking matches.
    if (van) {
      if (!vanMarkerRef.current) {
        const popupHtml = `<span style="font-weight:500">${business}</span>${
          etaLabel ? ` — ${etaLabel}` : ''
        }`;
        vanMarkerRef.current = new mapboxgl.Marker({
          element: vanElement(),
          anchor: 'center',
        })
          .setLngLat([van.lng, van.lat])
          .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(popupHtml))
          .addTo(map);
      } else {
        vanMarkerRef.current.setLngLat([van.lng, van.lat]);
        // Keep the popup text in sync as business/ETA refresh over polls.
        const popup = vanMarkerRef.current.getPopup();
        popup?.setHTML(
          `<span style="font-weight:500">${business}</span>${
            etaLabel ? ` — ${etaLabel}` : ''
          }`,
        );
      }
    } else if (vanMarkerRef.current) {
      vanMarkerRef.current.remove();
      vanMarkerRef.current = null;
    }

    // Destination marker — bottom anchored (the pin tip sits on the point).
    if (destination) {
      if (!homeMarkerRef.current) {
        homeMarkerRef.current = new mapboxgl.Marker({
          element: homeElement(),
          anchor: 'bottom',
        })
          .setLngLat([destination.lng, destination.lat])
          .setPopup(new mapboxgl.Popup({ offset: 40 }).setText('Destination'))
          .addTo(map);
      } else {
        homeMarkerRef.current.setLngLat([destination.lng, destination.lat]);
      }
    } else if (homeMarkerRef.current) {
      homeMarkerRef.current.remove();
      homeMarkerRef.current = null;
    }

    // Refresh the dashed route line.
    const source = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(routeData(van, destination));

    // Keep the viewport sensible: fit both when we have them, else ease to
    // whichever single point we have.
    if (van && destination) {
      const bounds: mapboxgl.LngLatBoundsLike = [
        [van.lng, van.lat],
        [destination.lng, destination.lat],
      ];
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 600 });
    } else if (van) {
      map.easeTo({ center: [van.lng, van.lat], zoom: 14 });
    } else if (destination) {
      map.easeTo({ center: [destination.lng, destination.lat], zoom: 14 });
    }
    // Depend on the primitive coordinates so this reruns only when a point
    // actually moves (plus the popup text) — not on every new object identity
    // from a poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, van?.lat, van?.lng, destination?.lat, destination?.lng, business, etaLabel]);

  // Skeleton: before paint, or when the map failed to construct — identical to
  // the Leaflet map's skeleton so the fallback is seamless.
  if (!mounted || errored) {
    return (
      <div
        className={`${MAP_HEIGHT} w-full animate-pulse rounded-box border border-base-content/10 bg-base-200`}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={`${MAP_HEIGHT} relative w-full overflow-hidden rounded-box border border-base-content/10 shadow-card`}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ background: 'hsl(var(--b2))' }}
      />

      {/* ETA badge overlay — sits above the map, theme-tokened, AA contrast. */}
      {etaLabel && (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-content shadow-card">
          {etaLabel}
        </div>
      )}
    </div>
  );
}

export default TrackerMapbox;
