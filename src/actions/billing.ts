'use server';

/**
 * Billing server actions for the Groomer Portal (Master Spec §13.2, §13.3, §13.4).
 *
 * Each action authenticates the caller via NextAuth and scopes every operation
 * to `session.user.id`, then delegates to the active {@link BillingProvider}
 * (Stripe when configured, else a no-op that reports "not configured"). They
 * RETURN a typed envelope — either `{ ok: true, url }` to redirect to, or
 * `{ ok: false, reason, message }` — so the UI can start a redirect or show a
 * clear degraded state without anything throwing.
 *
 * These never touch the existing deposit PaymentIntent flow; subscription
 * billing and Connect onboarding are additive seams.
 *
 * _Master Spec: §13.2, §13.3, §13.4_
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import {
  getBillingProvider,
  isConnectConfigured,
  type BillingResult,
} from '@/lib/billing/provider';
import type { BillingInterval } from '@/lib/plans';
import type { CheckoutPlan } from '@/lib/billing/provider';
import { mapConnectStatus } from '@/lib/billing/connect';

/** Absolute app base URL for building return/success/cancel links. */
function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  return `${base}${path}`;
}

/** The unauthenticated envelope shared by every action. */
function notSignedIn(): BillingResult {
  return {
    ok: false,
    reason: 'unknown_groomer',
    message: 'You must be signed in to manage billing.',
  };
}

/**
 * Start the free 14-day Pro trial (no card required, §13.2). Records the local
 * trialing subscription via the provider and returns where to land.
 */
export async function startTrial(): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return notSignedIn();

  return getBillingProvider().startTrial({
    groomerId: session.user.id,
    successUrl: appUrl('/billing?trial=started'),
    cancelUrl: appUrl('/billing'),
  });
}

/**
 * Create a Stripe Checkout session for a paid plan + interval (§13.2). Returns
 * the hosted Checkout URL to redirect to, or a not_configured/error envelope.
 */
export async function createCheckoutSession(
  plan: CheckoutPlan,
  interval: BillingInterval
): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return notSignedIn();

  return getBillingProvider().createCheckout({
    groomerId: session.user.id,
    plan,
    interval,
    successUrl: appUrl('/billing?checkout=success'),
    cancelUrl: appUrl('/billing?checkout=cancelled'),
  });
}

/**
 * Open the Stripe Customer Portal for self-service subscription management
 * (§13.2). Returns the portal URL to redirect to.
 */
export async function openBillingPortal(): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return notSignedIn();

  return getBillingProvider().createPortal({
    groomerId: session.user.id,
    returnUrl: appUrl('/billing'),
  });
}

/**
 * Buy a one-time SMS top-up bundle (§13.4). Returns a Checkout URL; the webhook
 * credits `smsTopupBalance` on success.
 */
export async function buySmsTopup(): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return notSignedIn();

  return getBillingProvider().createSmsTopupCheckout({
    groomerId: session.user.id,
    successUrl: appUrl('/billing?topup=success'),
    cancelUrl: appUrl('/billing?topup=cancelled'),
  });
}

/**
 * Begin Stripe Connect Express onboarding for client deposit payouts (§13.3).
 * Returns the account-link URL, or a connect_not_configured envelope when
 * Connect is not set up yet.
 */
export async function createConnectAccountLink(): Promise<BillingResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return notSignedIn();

  return getBillingProvider().createConnectAccountLink({
    groomerId: session.user.id,
    refreshUrl: appUrl('/settings?connect=refresh'),
    returnUrl: appUrl('/settings?connect=done'),
  });
}

/**
 * The result of an optimistic Connect-status refresh. Deliberately a tiny,
 * never-throw envelope: `{ ok: true, status }` when we successfully read the
 * connected account and persisted the derived status, or `{ ok: false }` for
 * every degraded path (not signed in, Connect not configured, no account yet,
 * or any Stripe/DB error).
 */
export interface RefreshConnectStatusResult {
  ok: boolean;
  /** The freshly-derived {@link import('@/lib/billing/connect').ConnectStatus}. */
  status?: string;
}

/**
 * Optimistically refresh the groomer's Stripe Connect status after they return
 * from the Stripe-hosted onboarding flow to `/settings?connect=done` (§13.3,
 * Stripe Flows (d)).
 *
 * This complements — but does NOT replace — the authoritative `account.updated`
 * Connect webhook (task 13.3). It lets the Settings UI reflect the new status
 * promptly instead of waiting for the webhook to land. It reuses the SAME pure
 * {@link mapConnectStatus} mapping and persists the SAME fields the webhook
 * writes (`connectStatus` + `stripeConnectChargesEnabled`), so the optimistic
 * refresh and the webhook can never disagree.
 *
 * Degrades gracefully (never throws): not signed in, Connect not configured, no
 * stored `stripeConnectAccountId`, or any Stripe/DB error all resolve to
 * `{ ok: false }`.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 15.4_
 */
export async function refreshConnectStatus(): Promise<RefreshConnectStatusResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { ok: false };

    // Connect is configured independently of subscription billing; bail out
    // (degraded, not an error) when it isn't set up so we never touch Stripe.
    if (!isConnectConfigured()) return { ok: false };

    // Lazily import the DB + Stripe singletons so this module stays importable
    // in contexts where billing/Connect is unconfigured.
    const [{ connectDB }, { GroomerProfile }, { getStripe }] = await Promise.all([
      import('@/lib/db/connect'),
      import('@/lib/db/models/groomer-profile'),
      import('@/lib/stripe/client'),
    ]);

    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('stripeConnectAccountId')
      .lean<{ stripeConnectAccountId?: string } | null>();

    const accountId = profile?.stripeConnectAccountId;
    if (!accountId) return { ok: false };

    // Read the live account and derive the status with the same pure mapping
    // the webhook uses. `complete` iff `charges_enabled === true` (R15.4).
    const account = await getStripe().accounts.retrieve(accountId);
    const status = mapConnectStatus(account);

    await GroomerProfile.findOneAndUpdate(
      { userId: session.user.id },
      {
        $set: {
          connectStatus: status,
          stripeConnectChargesEnabled: account.charges_enabled === true,
        },
      }
    );

    return { ok: true, status };
  } catch (err) {
    console.error('[billing] refreshConnectStatus failed:', err);
    return { ok: false };
  }
}
