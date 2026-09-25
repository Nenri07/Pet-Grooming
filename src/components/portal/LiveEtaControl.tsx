'use client';

/**
 * LiveEtaControl — the groomer's "On my way" / Sharing-location control
 * (Master Spec §11.2).
 *
 * Rendered on the portal appointment detail. When idle it shows an "On my way"
 * button that starts the trip (texts the client the tracker link + begins
 * posting the van position). While a trip is active it shows a persistent
 * "Sharing location" banner with a Stop button (privacy, §11.2).
 *
 * The Pro gate is enforced server-side on POST /api/portal/track/{id}; a 403
 * surfaces here as an upgrade message.
 *
 * _Master Spec: §11.2_
 */
import * as React from 'react';
import { Radio, Truck, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useLiveEta } from '@/hooks/useLiveEta';

interface LiveEtaControlProps {
  appointmentId: string;
  /** Whether a trip is already active (started, not yet arrived). */
  initialSharing: boolean;
  /** Hidden for terminal appointments (completed / cancelled). */
  disabled?: boolean;
}

export function LiveEtaControl({
  appointmentId,
  initialSharing,
  disabled = false,
}: LiveEtaControlProps) {
  const { state, error, start, stop } = useLiveEta(appointmentId, initialSharing);

  if (disabled) return null;

  const sharing = state === 'sharing';

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-base-content">
        <Truck className="h-5 w-5 text-primary" aria-hidden="true" />
        Live ETA
      </h2>

      {sharing ? (
        <div className="flex flex-col gap-3">
          {/* Persistent "Sharing location" banner (§11.2 privacy). */}
          <div
            className="flex items-center gap-2 rounded-box border border-primary/20 bg-primary/5 px-4 py-3"
            role="status"
          >
            <Radio className="h-5 w-5 animate-pulse text-primary" aria-hidden="true" />
            <span className="text-sm font-medium text-base-content">
              Sharing your location with the client
            </span>
          </div>
          <button
            type="button"
            onClick={() => void stop()}
            className="btn btn-error btn-outline min-h-[44px]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
            Stop sharing
          </button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-base-content/60">
            Let the client watch your van approach in real time. Tapping this texts
            them a live tracking link.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === 'starting'}
            className="btn btn-primary min-h-[44px]"
          >
            {state === 'starting' ? 'Starting…' : 'On my way'}
          </button>
        </>
      )}

      {error && (
        <p className="mt-3 text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

export default LiveEtaControl;
