'use client';

/**
 * useLiveEta — groomer-side Live ETA controller (Master Spec §11.2).
 *
 * Drives the "On my way" trip from the portal appointment view:
 *   - `start()` → POST /api/portal/track/{id} { action:'start', lat, lng },
 *     then begins posting `navigator.geolocation` every 20s while active.
 *   - `stop()`  → POST { action:'stop' } and clears the position interval.
 *
 * PWA/geolocation SEAM (§11.2): the spec wants the groomer's device to post its
 * position continuously (ideally as a PWA kept open). This is a MINIMAL wiring:
 * it posts from the open page with `navigator.geolocation` every 20s. It does
 * not run in the background when the tab is closed and there is no PWA/service
 * worker — that is a documented follow-up. The affordance + live sharing work
 * while the appointment page is open.
 *
 * Degrades: if geolocation is unavailable/denied the trip still starts (the
 * client sees "waiting for the van"); we just can't post positions.
 *
 * _Master Spec: §11.2_
 */
import * as React from 'react';

/** How often to post the van position while sharing (§11.2: ~20s). */
const POSITION_INTERVAL_MS = 20_000;

export type LiveEtaState = 'idle' | 'sharing' | 'starting' | 'error';

interface UseLiveEtaResult {
  state: LiveEtaState;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** Read the current position as a promise (resolves null on failure/denial). */
function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10_000 }
    );
  });
}

async function postTrack(
  appointmentId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(`/api/portal/track/${appointmentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Controller hook for one appointment's live trip.
 *
 * @param appointmentId The appointment being tracked.
 * @param initialSharing Whether a trip is already active (started, not arrived).
 */
export function useLiveEta(
  appointmentId: string,
  initialSharing = false
): UseLiveEtaResult {
  const [state, setState] = React.useState<LiveEtaState>(
    initialSharing ? 'sharing' : 'idle'
  );
  const [error, setError] = React.useState<string | null>(null);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const beginPositionLoop = React.useCallback(() => {
    clearTimer();
    intervalRef.current = setInterval(async () => {
      const pos = await getPosition();
      if (!pos) return;
      await postTrack(appointmentId, { action: 'position', lat: pos.lat, lng: pos.lng }).catch(
        () => {}
      );
    }, POSITION_INTERVAL_MS);
  }, [appointmentId, clearTimer]);

  // Resume the position loop if we mount already sharing.
  React.useEffect(() => {
    if (initialSharing) beginPositionLoop();
    return clearTimer;
  }, [initialSharing, beginPositionLoop, clearTimer]);

  const start = React.useCallback(async () => {
    setError(null);
    setState('starting');
    const pos = await getPosition();
    try {
      const res = await postTrack(appointmentId, {
        action: 'start',
        lat: pos?.lat,
        lng: pos?.lng,
      });
      if (res.status === 403) {
        setState('error');
        setError('Live ETA is a Pro feature. Upgrade to unlock it.');
        return;
      }
      if (!res.ok) {
        setState('error');
        setError('Could not start sharing your location.');
        return;
      }
      setState('sharing');
      beginPositionLoop();
    } catch {
      setState('error');
      setError('Could not start sharing your location.');
    }
  }, [appointmentId, beginPositionLoop]);

  const stop = React.useCallback(async () => {
    clearTimer();
    try {
      await postTrack(appointmentId, { action: 'stop' });
    } catch {
      // Best-effort — the Redis key expires within 2h regardless.
    }
    setState('idle');
  }, [appointmentId, clearTimer]);

  return { state, error, start, stop };
}

export default useLiveEta;
