/**
 * Billing provider seam (Master Spec §4.5, §13.2).
 *
 * Every third party sits behind an interface so it can be swapped (§4.5). The
 * {@link BillingProvider} interface is intentionally provider-agnostic —
 * Stripe Billing is the default implementation, but Lemon Squeezy / Paddle
 * (merchant of record) could drop in without touching callers.
 *
 * CRITICAL degradation contract (§13.2, and this phase's brief): Stripe Billing
 * price ids are NOT configured yet. So:
 *   - {@link isBillingConfigured} tells the UI whether real billing is wired
 *     (secret key AND the plan price-id envs are present).
 *   - {@link getBillingProvider} returns {@link StripeBilling} when configured,
 *     else a {@link NoopBilling} whose every method resolves to a clear
 *     `{ ok: false, reason: 'not_configured' }`. The app builds and runs, and
 *     the billing UI shows a "billing not set up yet" state — no crashes.
 *
 * All methods RETURN a typed result envelope (never throw) so callers can
 * branch on `ok` and degrade gracefully.
 *
 * _Master Spec: §4.5, §13.2, §13.3_
 */
import type { BillingInterval } from '@/lib/plans';
import { StripeBilling } from '@/lib/billing/stripe';

/** A paid, checkout-able plan (trial is started separately, no checkout). */
export type CheckoutPlan = 'solo' | 'pro';

/** Why a billing operation could not be completed. */
export type BillingFailureReason =
  | 'not_configured'
  | 'connect_not_configured'
  | 'unknown_groomer'
  | 'stripe_error';

/** A successful redirect result (Checkout / Portal / Connect onboarding). */
export interface BillingUrlSuccess {
  ok: true;
  /** The URL to redirect the groomer to. */
  url: string;
}

/** A failed billing operation with a machine-readable reason + safe message. */
export interface BillingFailure {
  ok: false;
  reason: BillingFailureReason;
  /** A user-safe message describing the failure. */
  message: string;
}

/** Result of any redirect-producing billing operation. */
export type BillingResult = BillingUrlSuccess | BillingFailure;

/** Inputs common to the checkout flows. */
export interface CheckoutParams {
  /** The groomer (User id) the checkout is for. */
  groomerId: string;
  /** Absolute URL to return to on success. */
  successUrl: string;
  /** Absolute URL to return to on cancel. */
  cancelUrl: string;
}

/**
 * Provider-agnostic billing operations (Master Spec §13.2, §13.3).
 *
 * Implementations MUST NOT throw; they return a {@link BillingResult}. This
 * keeps the interface swappable and lets callers handle the unconfigured case
 * uniformly.
 */
export interface BillingProvider {
  /**
   * Start the 14-day Pro trial with NO card required (§13.2). Persists a
   * `trialing` Subscription and invalidates the entitlement cache. Returns a
   * URL only when the provider hosts a trial checkout; the Stripe impl records
   * the trial locally and returns the portal/billing URL to land on.
   */
  startTrial(params: CheckoutParams): Promise<BillingResult>;

  /**
   * Create a Checkout Session for a paid plan + interval (§13.2). Returns the
   * hosted Checkout URL to redirect to.
   */
  createCheckout(
    params: CheckoutParams & { plan: CheckoutPlan; interval: BillingInterval }
  ): Promise<BillingResult>;

  /**
   * Create a Customer Portal session so the groomer can manage their
   * subscription / payment method (§13.2). Returns the portal URL.
   */
  createPortal(params: {
    groomerId: string;
    returnUrl: string;
  }): Promise<BillingResult>;

  /**
   * Create a one-time Checkout for an SMS top-up (§13.4). Returns the Checkout
   * URL; fulfilment (incrementing `smsTopupBalance`) happens in the webhook.
   */
  createSmsTopupCheckout(params: CheckoutParams): Promise<BillingResult>;

  /**
   * Create a Stripe Connect Express account link for deposit onboarding
   * (§13.3). Separate from subscription billing configuration — returns
   * `connect_not_configured` when Connect is not set up.
   */
  createConnectAccountLink(params: {
    groomerId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<BillingResult>;
}

// ---------------------------------------------------------------------------
// Configuration checks
// ---------------------------------------------------------------------------

/** Whether a value is a present, non-placeholder env value. */
function isSet(value: string | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (t.length === 0) return false;
  // Treat shipped placeholders (…replace_me / your-…) as "not configured".
  if (t.includes('replace_me') || t.startsWith('your-') || t.startsWith('price_replace')) {
    return false;
  }
  return true;
}

/** The subscription price-id envs required for real Checkout (§4.3, §13.2). */
export function arePricesConfigured(): boolean {
  return (
    isSet(process.env.STRIPE_PRICE_SOLO_MONTH) &&
    isSet(process.env.STRIPE_PRICE_SOLO_YEAR) &&
    isSet(process.env.STRIPE_PRICE_PRO_MONTH) &&
    isSet(process.env.STRIPE_PRICE_PRO_YEAR)
  );
}

/**
 * Whether subscription BILLING is fully configured: the Stripe secret key AND
 * all four plan price ids. This is what the UI checks to decide between the
 * live billing view and the "billing isn't set up yet" state (§13.2).
 */
export function isBillingConfigured(): boolean {
  return isSet(process.env.STRIPE_SECRET_KEY) && arePricesConfigured();
}

/**
 * Whether Stripe Connect (client deposits onboarding, §13.3) is configured:
 * the Stripe secret key AND the Connect client id.
 */
export function isConnectConfigured(): boolean {
  return isSet(process.env.STRIPE_SECRET_KEY) && isSet(process.env.STRIPE_CONNECT_CLIENT_ID);
}

// ---------------------------------------------------------------------------
// NoopBilling — the graceful "not configured" implementation
// ---------------------------------------------------------------------------

const NOT_CONFIGURED_MESSAGE =
  "Billing isn't set up yet. Subscriptions and top-ups will be available soon.";
const CONNECT_NOT_CONFIGURED_MESSAGE =
  "Online deposit payouts aren't set up yet. This will be available soon.";

/**
 * A billing provider that does nothing but explain that billing is not
 * configured. Every method resolves to a clear failure so the UI can render a
 * "billing not set up" state and nothing crashes (§13.2 degradation contract).
 */
export class NoopBilling implements BillingProvider {
  private fail(reason: BillingFailureReason = 'not_configured'): BillingFailure {
    return {
      ok: false,
      reason,
      message:
        reason === 'connect_not_configured'
          ? CONNECT_NOT_CONFIGURED_MESSAGE
          : NOT_CONFIGURED_MESSAGE,
    };
  }

  async startTrial(): Promise<BillingResult> {
    return this.fail();
  }
  async createCheckout(): Promise<BillingResult> {
    return this.fail();
  }
  async createPortal(): Promise<BillingResult> {
    return this.fail();
  }
  async createSmsTopupCheckout(): Promise<BillingResult> {
    return this.fail();
  }
  async createConnectAccountLink(): Promise<BillingResult> {
    return this.fail('connect_not_configured');
  }
}

/**
 * Return the active billing provider (Master Spec §4.5, §13.2).
 *
 * - {@link StripeBilling} when subscription billing is configured (secret key +
 *   price ids).
 * - {@link NoopBilling} otherwise, so the app builds/runs and the UI degrades.
 *
 * StripeBilling is imported lazily so importing this module never pulls in the
 * Stripe SDK (or its env expectations) when billing is unconfigured.
 */
export function getBillingProvider(): BillingProvider {
  if (isBillingConfigured()) {
    return new StripeBilling();
  }
  return new NoopBilling();
}
