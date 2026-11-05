'use client';

/**
 * AddressPicker — "Find on map" for any address field.
 *
 * Opens a dialog with:
 *   - a search box with type-ahead suggestions biased toward the visitor's
 *     location (Mapbox Geocoding v6),
 *   - "Use my current location" (browser geolocation),
 *   - a map with a fixed centre pin the user drags into the exact spot; the
 *     address under the pin is looked up as they move.
 * "Use this address" returns the address split into street / city / state /
 * postal code plus the exact pin coordinates.
 *
 * Renders nothing when no public Mapbox token is configured, so forms keep
 * working with plain typing.
 */
import * as React from 'react';
import dynamic from 'next/dynamic';
import { Crosshair, Loader2, MapPinned, Search, X } from 'lucide-react';
import {
  isPublicMapboxToken,
  reverseGeocode,
  searchAddresses,
  type LatLng,
  type PickedAddress,
} from '@/lib/geo/mapbox-search';

const AddressPickerMap = dynamic(() => import('./AddressPickerMap'), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full animate-pulse rounded-box border border-base-content/10 bg-base-200 sm:h-80" />
  ),
});

export interface AddressPickerProps {
  /** Called when the user confirms a spot. */
  onPick: (address: PickedAddress) => void;
  /** Text already typed in the form; pre-fills the search box. */
  initialQuery?: string;
  /** A known nearby point (e.g. the groomer's base) to start the map on. */
  near?: LatLng | null;
  /** Button label. */
  label?: string;
  className?: string;
}

/** Fallback map centre when nothing better is known (zoomed out). */
const WORLD: LatLng = { lat: 20, lng: 0 };

function readCurrentPosition(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

export function AddressPicker({
  onPick,
  initialQuery = '',
  near = null,
  label = 'Find on map',
  className,
}: AddressPickerProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<PickedAddress[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [center, setCenter] = React.useState<LatLng>(near ?? WORLD);
  const [zoom, setZoom] = React.useState(near ? 15 : 2);
  const [picked, setPicked] = React.useState<PickedAddress | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [locError, setLocError] = React.useState<string | null>(null);
  const reverseAbort = React.useRef<AbortController | null>(null);

  const hasToken = isPublicMapboxToken(token);

  const openDialog = React.useCallback(() => {
    setQuery(initialQuery);
    setSuggestions([]);
    setPicked(null);
    setLocError(null);
    setOpen(true);
    dialogRef.current?.showModal();
  }, [initialQuery]);

  const closeDialog = React.useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, []);

  // Debounced type-ahead.
  React.useEffect(() => {
    if (!open || !hasToken) return;
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      const results = await searchAddresses(q, token as string, picked ?? near, ctrl.signal);
      if (!ctrl.signal.aborted) {
        setSuggestions(results);
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // `picked` is only a proximity hint; re-searching on every pin move is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, hasToken, token, near]);

  // On first open with no known area, try the device location (non-blocking).
  React.useEffect(() => {
    if (!open || near) return;
    let cancelled = false;
    void readCurrentPosition().then((pos) => {
      if (cancelled || !pos) return;
      setCenter((c) => (c === WORLD ? pos : c));
      setZoom((z) => (z < 10 ? 15 : z));
    });
    return () => {
      cancelled = true;
    };
  }, [open, near]);

  const lookUp = React.useCallback(
    async (point: LatLng) => {
      if (!hasToken) return;
      reverseAbort.current?.abort();
      const ctrl = new AbortController();
      reverseAbort.current = ctrl;
      setResolving(true);
      const found = await reverseGeocode(point, token as string, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setResolving(false);
      setPicked(
        found ?? {
          street: '',
          city: '',
          state: '',
          postalCode: '',
          fullAddress: '',
          lat: point.lat,
          lng: point.lng,
        }
      );
    },
    [hasToken, token]
  );

  const chooseSuggestion = (s: PickedAddress) => {
    setSuggestions([]);
    setQuery(s.fullAddress);
    setPicked(s);
    setCenter({ lat: s.lat, lng: s.lng });
    setZoom(17);
  };

  const useMyLocation = async () => {
    setLocError(null);
    setLocating(true);
    const pos = await readCurrentPosition();
    setLocating(false);
    if (!pos) {
      setLocError('We couldn\u2019t read your location. Allow location access, or search instead.');
      return;
    }
    setCenter(pos);
    setZoom(17);
    void lookUp(pos);
  };

  const onMoveEnd = (c: LatLng) => {
    // Ignore the initial world view; only real positions are useful.
    if (zoom < 10 && c.lat === WORLD.lat && c.lng === WORLD.lng) return;
    void lookUp(c);
  };

  const confirm = () => {
    if (!picked) return;
    onPick(picked);
    closeDialog();
  };

  if (!hasToken) return null;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={className ?? 'btn btn-outline btn-sm min-h-[44px] gap-2'}
      >
        <MapPinned className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>

      <dialog ref={dialogRef} className="modal modal-bottom sm:modal-middle" onClose={() => setOpen(false)}>
        <div className="modal-box max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">Find the address</h3>
            <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={closeDialog} aria-label="Close">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <label className="input input-bordered flex min-h-[44px] items-center gap-2">
              <Search className="h-4 w-4 opacity-60" aria-hidden="true" />
              <input
                type="text"
                className="grow"
                placeholder="Search street, area or place"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search for an address"
                autoComplete="off"
              />
              {searching && <Loader2 className="h-4 w-4 animate-spin opacity-60" aria-hidden="true" />}
            </label>
            {suggestions.length > 0 && (
              <ul className="menu absolute z-20 mt-1 w-full rounded-box border border-base-content/10 bg-base-100 p-1 shadow-card">
                {suggestions.map((s, i) => (
                  <li key={`${s.lat},${s.lng},${i}`}>
                    <button type="button" className="text-left" onClick={() => chooseSuggestion(s)}>
                      {s.fullAddress || s.street}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="btn btn-ghost btn-sm mt-2 min-h-[44px] gap-2 text-primary"
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Crosshair className="h-4 w-4" aria-hidden="true" />
            )}
            Use my current location
          </button>
          {locError && <p className="mt-1 text-sm text-error">{locError}</p>}

          <div className="mt-3">
            {open && (
              <AddressPickerMap token={token as string} center={center} zoom={zoom} onMoveEnd={onMoveEnd} />
            )}
            <p className="mt-2 text-xs text-base-content/60">
              Drag the map so the pin sits exactly on the door.
            </p>
          </div>

          <div className="mt-3 min-h-[3rem] rounded-box bg-base-200 px-4 py-3 text-sm">
            {resolving ? (
              <span className="inline-flex items-center gap-2 text-base-content/60">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Finding address…
              </span>
            ) : picked ? (
              <span className="text-base-content">
                {picked.fullAddress || 'Pin placed. Add the street name after confirming.'}
              </span>
            ) : (
              <span className="text-base-content/60">Search, use your location, or move the map.</span>
            )}
          </div>

          <div className="modal-action">
            <button type="button" className="btn btn-ghost min-h-[44px]" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              onClick={confirm}
              disabled={!picked || resolving}
            >
              Use this address
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close">close</button>
        </form>
      </dialog>
    </>
  );
}

export default AddressPicker;
