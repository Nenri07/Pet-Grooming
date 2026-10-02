'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CreditCard, CheckCircle2, Info, Loader2, Wallet } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import {
  createConnectAccountLink,
  refreshConnectStatus,
} from '@/actions/billing';
import type { ConnectStatus } from '@/lib/billing/connect';

/**
 * ConnectStatusCard — the "Online payments" card on the Settings page
 * (Billing, Trial, and Payments — Requirements 15.1, 15.2, 15.3, 15.6, 18.2).
 *
 * Surfaces the groomer's Stripe Connect onboarding state as exactly one of the
 * five {@link ConnectStatus} values (R15.1) and offers the matching recovery
 * action:
 *   - `not_started` → "Connect payouts" (opens hosted onboarding).
 *   - `needs_info`  → "Finish setup"   (resumes hosted onboarding).
 *   - `disabled`    → "Fix payouts"    (resumes hosted onboarding).
 *   - `pending`     → informational "Verification in progress" + "Refresh
 *     status" (optimistically re-reads the live account via the webhook's
 *     authoritative mapping).
 *   - `complete`    → success note + an optional "Manage" link that re-opens
 *     onboarding.
 *
 * When Connect is not configured at all (`connectConfigured === false`) the
 * card renders a labelled "Online payouts aren't set up yet" state and disables
 * the actions — mirroring BillingView's not-configured banner (R18.2).
 *
 * On return from Stripe-hosted onboarding (`/settings?connect=done`), it calls
 * `refreshConnectStatus()` once to optimistically update, then cleans the query
 * param so a reload doesn't re-trigger it.
 *
 * DaisyUI theme tokens only, WCAG 2.1 AA contrast, 44px+ touch targets.
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.6, 18.2_
 */

/** Serializable props projected by the Settings page (server component). */
export interface ConnectStatusCardProps {
  /** Whether Stripe Connect is configured on the platform at all (R18.2). */
  connectConfigured: boolean;
  /** The groomer's current Connect onboarding state (R15.1). */
  status: ConnectStatus;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Human-readable chip label per status (R15.1). */
const STATUS_LABEL: Record<ConnectStatus, string> = {
  not_started: 'Not connected',
  pending: 'Verification in progress',
  needs_info: 'More info needed',
  complete: 'Connected',
  disabled: 'Payouts disabled',
};

/**
 * DaisyUI badge tone per status (R15.2):
 *   complete → success, needs_info → warning, disabled → error,
 *   pending → info, not_started → ghost.
 */
const STATUS_BADGE: Record<ConnectStatus, string> = {
  not_started: 'badge-ghost',
  pending: 'badge-info',
  needs_info: 'badge-warning',
  complete: 'badge-success',
  disabled: 'badge-error',
};

/** Primary-action label per status (null when there's no onboarding CTA). */
const PRIMARY_LABEL: Partial<Record<ConnectStatus, string>> = {
  not_started: 'Connect payouts',
  needs_info: 'Finish setup',
  disabled: 'Fix payouts',
};

export function ConnectStatusCard({
  connectConfigured,
  status,
}: ConnectStatusCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Local status mirrors the prop but can be optimistically advanced by a
  // successful refresh (pending → complete, etc.) without a full reload.
  const [currentStatus, setCurrentStatus] = React.useState<ConnectStatus>(status);
  const [pending, setPending] = React.useState<null | 'onboard' | 'refresh'>(null);

  // Keep local state in sync if the server re-renders with a fresher status.
  React.useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  /** Open Stripe-hosted onboarding (start, resume, or re-open). */
  const openOnboarding = React.useCallback(async () => {
    setPending('onboard');
    try {
      const res = await createConnectAccountLink();
      if (res.ok) {
        window.location.href = res.url;
        return;
      }
      toast.error(
        res.message || 'Online payouts aren’t available right now.',
        { duration: Infinity }
      );
    } catch {
      toast.error('Something went wrong. Please try again.', {
        duration: Infinity,
      });
    } finally {
      setPending(null);
    }
  }, []);

  /** Optimistically re-read the live Connect status (R15.4). */
  const refresh = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      setPending('refresh');
      try {
        const res = await refreshConnectStatus();
        if (res.ok && res.status) {
          setCurrentStatus(res.status as ConnectStatus);
          if (!opts?.silent) {
            toast.success('Payout status updated.');
          }
          // Pull fresh server data too so other surfaces stay in sync.
          router.refresh();
          return;
        }
        if (!opts?.silent) {
          toast.info('No status change yet. Please check back shortly.');
        }
      } catch {
        if (!opts?.silent) {
          toast.error('Could not refresh status. Please try again.', {
            duration: Infinity,
          });
        }
      } finally {
        setPending(null);
      }
    },
    [router]
  );

  // On return from Stripe onboarding (?connect=done), optimistically refresh
  // once, then strip the query param so a reload doesn't re-fire it.
  const didHandleReturn = React.useRef(false);
  React.useEffect(() => {
    if (didHandleReturn.current) return;
    if (!connectConfigured) return;
    if (searchParams.get('connect') !== 'done') return;

    didHandleReturn.current = true;
    void refresh({ silent: true });

    // Clean the URL (remove the connect param) without a navigation entry.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('connect');
    const query = params.toString();
    router.replace(query ? `/settings?${query}` : '/settings');
  }, [connectConfigured, searchParams, refresh, router]);

  const badgeClass = STATUS_BADGE[currentStatus];
  const chipLabel = STATUS_LABEL[currentStatus];
  const primaryLabel = PRIMARY_LABEL[currentStatus];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle>Online payments</CardTitle>
          </div>
          {connectConfigured && (
            <span
              className={cx('badge', badgeClass)}
              // Announce the status to assistive tech alongside the visual chip.
              aria-label={`Payout status: ${chipLabel}`}
            >
              {chipLabel}
            </span>
          )}
        </div>
        <CardDescription>
          Client deposits pay out directly to your own Stripe account — PawPort
          never holds your money. Connect once and deposits land straight in
          your balance.
        </CardDescription>
      </CardHeader>

      {/* Not-configured state (R18.2) — mirrors BillingView's banner. */}
      {!connectConfigured ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-box border border-base-content/10 bg-base-200 p-4"
        >
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium text-base-content">
              Online payouts aren’t set up yet
            </p>
            <p className="mt-1 text-sm text-base-content/60">
              Accepting deposits will be available once payments are connected on
              the platform. You can still take no-deposit bookings in the
              meantime.
            </p>
          </div>
        </div>
      ) : currentStatus === 'complete' ? (
        /* Complete — success note + optional re-open "Manage" (R15.1). */
        <div className="flex flex-col gap-3">
          <div
            role="status"
            className="flex items-start gap-3 rounded-box border border-success/30 bg-success/10 p-4"
          >
            <CheckCircle2
              className="mt-0.5 h-5 w-5 shrink-0 text-success"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-base-content">
                You’re set up to receive deposits
              </p>
              <p className="mt-1 text-sm text-base-content/70">
                Deposit-requiring bookings are enabled and pay out to your Stripe
                account automatically.
              </p>
            </div>
          </div>
          <div>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void openOnboarding()}
              className="btn btn-outline btn-sm min-h-[44px]"
            >
              {pending === 'onboard' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Opening…
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  Manage payouts
                </>
              )}
            </button>
          </div>
        </div>
      ) : currentStatus === 'pending' ? (
        /* Pending — informational + "Refresh status" (R15.3). */
        <div className="flex flex-col gap-3">
          <div
            role="status"
            className="flex items-start gap-3 rounded-box border border-info/30 bg-info/10 p-4"
          >
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
            <div>
              <p className="font-medium text-base-content">
                Verification in progress
              </p>
              <p className="mt-1 text-sm text-base-content/70">
                Stripe is reviewing your details. This usually takes just a few
                minutes. Check back or refresh to see the latest status.
              </p>
            </div>
          </div>
          <div>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void refresh()}
              className="btn btn-outline btn-sm min-h-[44px]"
            >
              {pending === 'refresh' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Refreshing…
                </>
              ) : (
                'Refresh status'
              )}
            </button>
          </div>
        </div>
      ) : (
        /* not_started / needs_info / disabled — primary onboarding CTA. */
        <div className="flex flex-col gap-3">
          {(currentStatus === 'needs_info' || currentStatus === 'disabled') && (
            <div
              role="status"
              className={cx(
                'flex items-start gap-3 rounded-box border p-4',
                currentStatus === 'disabled'
                  ? 'border-error/30 bg-error/10'
                  : 'border-warning/30 bg-warning/10'
              )}
            >
              <Info
                className={cx(
                  'mt-0.5 h-5 w-5 shrink-0',
                  currentStatus === 'disabled' ? 'text-error' : 'text-warning'
                )}
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-base-content">
                  {currentStatus === 'disabled'
                    ? 'Payouts are disabled'
                    : 'A few more details are needed'}
                </p>
                <p className="mt-1 text-sm text-base-content/70">
                  {currentStatus === 'disabled'
                    ? 'Stripe has paused payouts for this account. Re-open onboarding to resolve the issue and restore deposits.'
                    : 'Stripe needs a little more information before you can receive deposits. Finishing setup only takes a minute.'}
                </p>
              </div>
            </div>
          )}
          <div>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void openOnboarding()}
              className="btn btn-primary btn-sm min-h-[44px]"
            >
              {pending === 'onboard' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Opening…
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" aria-hidden="true" />
                  {primaryLabel ?? 'Connect payouts'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default ConnectStatusCard;
