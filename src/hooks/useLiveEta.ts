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

/** Minimum gap between position posts while sharing. */
const MIN_POST_GAP_MS = 5_000;
/** Re-post the last fix at least this often so the client never looks stale. */
const HEARTBEAT_MS = 15_000;

export type LiveEtaState = 'idle' | 'sharing' | 'starting' | 'error';

interface UseLiveEtaResult {
  state: LiveEtaState;
  error: string | null;
  /**
   * Non-blocking notice shown while a trip IS active but the groomer's device
   * can't share its position (geolocation denied/unavailable). The trip still
   * started and the client still got the link — but the van won't move until
   * location access is granted. Distinct from `error`, which blocks the start.
   */
  warning: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

type Fix = { lat: number; lng: number };

/** One position read with the given accuracy (resolves null on failure). */
function readPosition(highAccuracy: boolean, timeout: number): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 30_000 }
    );
  });
}

/**
 * Fastest usable fix: a quick network/Wi-Fi fix first (usually < 1s), and
 * GPS only if that fails. Waiting on GPS alone often timed out indoors and on
 * laptops, so the trip started with no position at all.
 */
async function getPosition(): Promise<Fix | null> {
  return (await readPosition(false, 4000)) ?? (await readPosition(true, 10_000));
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
  const [warning, setWarning] = React.useState<string | null>(null);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = React.useRef<number | null>(null);
  const lastFixRef = React.useRef<Fix | null>(null);
  const lastPostAtRef = React.useRef(0);

  const clearTimer = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (watchRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  const postFix = React.useCallback(
    async (fix: Fix, force = false) => {
      const now = Date.now();
      if (!force && now - lastPostAtRef.current < MIN_POST_GAP_MS) return;
      lastPostAtRef.current = now;
      await postTrack(appointmentId, { action: 'position', lat: fix.lat, lng: fix.lng }).catch(
        () => {}
      );
    },
    [appointmentId]
  );

  const beginPositionLoop = React.useCallback(() => {
    clearTimer();
    // Push every movement as the device reports it (throttled to one post per
    // 5s) instead of sampling every 20s.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          lastFixRef.current = fix;
          setWarning(null);
          void postFix(fix);
        },
        () => {
          // Keep sharing (the trip is live) but tell the groomer their location
          // isn't being read, so this never looks like a silent failure.
          setWarning(
            "Can't read your location — allow location access so the client can see your van move."
          );
        },
        { enableHighAccuracy: true, maximumAge: 5_000 }
      );
    }
    // Heartbeat: re-send the latest fix (or try a fresh read) so a parked van
    // or a device that stops emitting still refreshes the client's view.
    intervalRef.current = setInterval(async () => {
      const fix = lastFixRef.current ?? (await getPosition());
      if (fix) {
        lastFixRef.current = fix;
        void postFix(fix, true);
      }
    }, HEARTBEAT_MS);
  }, [clearTimer, postFix]);

  // Resume the position loop if we mount already sharing.
  React.useEffect(() => {
    if (initialSharing) beginPositionLoop();
    return clearTimer;
  }, [initialSharing, beginPositionLoop, clearTimer]);

  const start = React.useCallback(async () => {
    setError(null);
    setWarning(null);
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
      if (pos) {
        lastFixRef.current = pos;
        lastPostAtRef.current = Date.now();
      }
      if (!pos) {
        setWarning(
          "Started — but we couldn't read your location. Allow location access so the client can watch your van approach."
        );
      }
      beginPositionLoop();
    } catch {
      setState('error');
      setError('Could not start sharing your location.');
    }
  }, [appointmentId, beginPositionLoop]);

  const stop = React.useCallback(async () => {
    clearTimer();
    setWarning(null);
    try {
      await postTrack(appointmentId, { action: 'stop' });
    } catch {
      // Best-effort — the Redis key expires within 2h regardless.
    }
    setState('idle');
  }, [appointmentId, clearTimer]);

  return { state, error, warning, start, stop };
}

export default useLiveEta;
