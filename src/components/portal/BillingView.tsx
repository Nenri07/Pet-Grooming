'use client';

import * as React from 'react';
import {
  BadgeCheck,
  CalendarClock,
  CreditCard,
  MessageSquare,
  Sparkles,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import {
  startTrial,
  createCheckoutSession,
  openBillingPortal,
  buySmsTopup,
} from '@/actions/billing';
import type { BillingInterval } from '@/lib/plans';
import type { CheckoutPlan, BillingResult } from '@/lib/billing/provider';

/**
 * BillingView — the subscription & usage screen (Master Spec §13.2, §13.4).
 *
 * Shows the current plan, status, trial countdown, next invoice, SMS usage vs.
 * included + top-up, "Manage subscription" (Customer Portal), and upgrade CTAs
 * (Solo/Pro × monthly/annual) with a founding-member banner.
 *
 * Degradation (§13.2): when billing is NOT configured, the plan/status/usage
 * info still renders, but a clear "Billing isn't set up yet" banner replaces
 * the actionable CTAs (the server actions also return a not_configured
 * envelope, so nothing breaks either way).
 *
 * Calm motion, theme tokens only, 44px+ targets.
 *
 * _Master Spec: §13.2, §13.4_
 */

/** Serializable props projected by the billing page (server component). */
export interface BillingViewProps {
  billingConfigured: boolean;
  plan: string;
  tier: 'solo' | 'pro';
  status: string;
  active: boolean;
  inGracePeriod: boolean;
  foundingMember: boolean;
  /** ISO or null. */
  trialEndsAt: string | null;
  /** ISO or null. */
  currentPeriodEnd: string | null;
  smsIncluded: number;
  smsUsed: number;
  smsTopupBalance: number;
  /** Plan catalog for the pricing CTAs. */
  prices: {
    soloMonth: number;
    soloYear: number;
    proMonth: number;
    proYear: number;
  };
  founding: { spots: number; soloMonth: number; proMonth: number };
  smsTopup: { messages: number; price: number };
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment due',
  canceled: 'Canceled',
  expired: 'Expired',
};

const STATUS_BADGE: Record<string, string> = {
  trialing: 'badge-info',
  active: 'badge-success',
  past_due: 'badge-warning',
  canceled: 'badge-error',
  expired: 'badge-error',
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Run a billing action and redirect on success; surface message on failure. */
function useBillingAction() {
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (key: string, action: () => Promise<BillingResult>) => {
      setError(null);
      setPending(key);
      try {
        const res = await action();
        if (res.ok) {
          window.location.href = res.url;
          return;
        }
        setError(res.message || 'That action is unavailable right now.');
      } catch {
        setError('Something went wrong. Please try again.');
      } finally {
        setPending(null);
      }
    },
    []
  );

  return { pending, error, run };
}

export function BillingView(props: BillingViewProps) {
  const {
    billingConfigured,
    plan,
    tier,
    status,
    active,
    inGracePeriod,
    foundingMember,
    trialEndsAt,
    currentPeriodEnd,
    smsIncluded,
    smsUsed,
    smsTopupBalance,
    prices,
    founding,
    smsTopup,
  } = props;

  const [interval, setInterval] = React.useState<BillingInterval>('month');
  const { pending, error, run } = useBillingAction();

  const trialDays = daysUntil(trialEndsAt);
  const nextInvoice = formatDate(currentPeriodEnd);
  const smsPct = smsIncluded > 0 ? Math.min(100, Math.round((smsUsed / smsIncluded) * 100)) : 0;

  const priceFor = (p: CheckoutPlan): number =>
    p === 'solo'
      ? interval === 'year'
        ? prices.soloYear
        : prices.soloMonth
      : interval === 'year'
        ? prices.proYear
        : prices.proMonth;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-base-content sm:text-3xl">
          Billing &amp; plan
        </h1>
        <p className="mt-1 text-base-content/60">
          Manage your subscription, invoices and SMS credits.
        </p>
      </header>

      {/* Not-configured banner (§13.2 degradation) */}
      {!billingConfigured && (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-box border border-base-content/10 bg-base-200 p-4"
        >
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium text-base-content">Billing isn&apos;t set up yet</p>
            <p className="mt-1 text-sm text-base-content/60">
              Subscriptions and SMS top-ups will be available once payments are
              connected. Your plan details below still apply.
            </p>
          </div>
        </div>
      )}

      {/* Grace-period banner (§13.2 past_due) */}
      {inGracePeriod && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-box border border-warning/30 bg-warning/10 p-4"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-medium text-base-content">Payment needed</p>
            <p className="mt-1 text-sm text-base-content/70">
              Everything still works during a short grace period. Update your
              payment method to avoid interruption.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-box bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Current plan */}
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-display text-lg font-semibold text-base-content">
                Current plan
              </h2>
            </div>
            <span className={cx('badge', STATUS_BADGE[status] ?? 'badge-ghost')}>
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>

          <p className="text-2xl font-bold capitalize text-base-content">
            {tier} {plan === 'trial' && <span className="text-base font-medium text-base-content/60">(trial)</span>}
          </p>

          {status === 'trialing' && trialDays != null && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-base-content/70">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
              {trialDays} {trialDays === 1 ? 'day' : 'days'} left in your trial
            </p>
          )}

          {nextInvoice && (
            <p className="mt-2 text-sm text-base-content/60">
              {status === 'canceled' || status === 'expired'
                ? `Access ended ${nextInvoice}`
                : `Next invoice: ${nextInvoice}`}
            </p>
          )}

          {!active && (
            <p className="mt-2 text-sm text-error">
              Your account is read-only. Choose a plan below to reactivate.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!billingConfigured || pending !== null}
              onClick={() => void run('portal', openBillingPortal)}
              className="btn btn-outline btn-sm min-h-[44px]"
            >
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              {pending === 'portal' ? 'Opening…' : 'Manage subscription'}
            </button>
            {status !== 'trialing' && !active && (
              <button
                type="button"
                disabled={!billingConfigured || pending !== null}
                onClick={() => void run('trial', startTrial)}
                className="btn btn-ghost btn-sm min-h-[44px]"
              >
                {pending === 'trial' ? 'Starting…' : 'Start free trial'}
              </button>
            )}
          </div>
        </Card>

        {/* SMS usage + top-up (§13.4) */}
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-base-content">
              SMS credits
            </h2>
          </div>
          <p className="text-2xl font-bold text-base-content">
            {smsUsed}
            <span className="text-base font-medium text-base-content/50">
              /{smsIncluded} used
            </span>
          </p>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-base-200"
            role="progressbar"
            aria-valuenow={smsPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="SMS usage this cycle"
          >
            <div
              className={cx('h-full rounded-full', smsPct >= 100 ? 'bg-error' : 'bg-primary')}
              style={{ width: `${smsPct}%` }}
            />
          </div>
          {smsTopupBalance > 0 && (
            <p className="mt-2 text-sm text-base-content/60">
              + {smsTopupBalance} top-up credits available
            </p>
          )}
          <button
            type="button"
            disabled={!billingConfigured || pending !== null}
            onClick={() => void run('topup', buySmsTopup)}
            className="btn btn-outline btn-sm mt-4 min-h-[44px]"
          >
            {pending === 'topup'
              ? 'Opening…'
              : `Top up ${smsTopup.messages} messages · $${smsTopup.price}`}
          </button>
        </Card>
      </div>

      {/* Founding banner (§13.2) */}
      <div className="mt-4 flex items-start gap-3 rounded-box border border-primary/20 bg-primary/5 p-4">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium text-base-content">
            {foundingMember ? 'You\u2019re a founding member \u2764' : 'Founding groomer program'}
          </p>
          <p className="mt-1 text-sm text-base-content/70">
            {foundingMember
              ? 'Your discounted pricing is locked in for life.'
              : `First ${founding.spots} groomers lock in $${founding.soloMonth}/mo Solo or $${founding.proMonth}/mo Pro — for life.`}
          </p>
        </div>
      </div>

      {/* Upgrade CTAs */}
      <div className="mt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-base-content">
            Choose a plan
          </h2>
          {/* Monthly / annual toggle (annual = 2 months free) */}
          <div className="join" role="group" aria-label="Billing interval">
            <button
              type="button"
              onClick={() => setInterval('month')}
              aria-pressed={interval === 'month'}
              className={cx(
                'btn join-item btn-sm min-h-[44px]',
                interval === 'month' ? 'btn-primary' : 'btn-outline'
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval('year')}
              aria-pressed={interval === 'year'}
              className={cx(
                'btn join-item btn-sm min-h-[44px]',
                interval === 'year' ? 'btn-primary' : 'btn-outline'
              )}
            >
              Annual · 2 months free
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(['solo', 'pro'] as CheckoutPlan[]).map((p) => (
            <Card key={p} interactive>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold capitalize text-base-content">
                  {p}
                </h3>
                {p === 'pro' && (
                  <span className="badge badge-primary badge-sm">Most popular</span>
                )}
              </div>
              <p className="mt-2 text-3xl font-bold text-base-content">
                ${priceFor(p)}
                <span className="text-base font-medium text-base-content/50">
                  /{interval === 'year' ? 'yr' : 'mo'}
                </span>
              </p>
              <p className="mt-1 text-sm text-base-content/60">
                {p === 'pro'
                  ? 'Order Radar, Fill My Day, live ETA, rebooking autopilot & more.'
                  : 'Booking, deposits, native calendar, pet cards, reminders.'}
              </p>
              <button
                type="button"
                disabled={!billingConfigured || pending !== null}
                onClick={() =>
                  void run(`checkout-${p}`, () => createCheckoutSession(p, interval))
                }
                className={cx(
                  'btn mt-4 w-full min-h-[44px]',
                  p === 'pro' ? 'btn-primary' : 'btn-outline'
                )}
              >
                {pending === `checkout-${p}`
                  ? 'Opening…'
                  : tier === p && active
                    ? 'Current plan'
                    : `Choose ${p}`}
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BillingView;
