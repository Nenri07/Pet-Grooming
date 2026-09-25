/**
 * StripeBilling — the default {@link BillingProvider} backed by Stripe Billing
 * (subscriptions) + Stripe Connect (deposit onboarding). (Master Spec §13.2, §13.3.)
 *
 * Reuses the existing server Stripe singleton (`@/lib/stripe/client`) so this
 * phase does NOT add a second Stripe client or touch the existing deposit
 * PaymentIntent flow.
 *
 * Degradation contract: this class is only ever instantiated by
 * {@link getBillingProvider} when {@link isBillingConfigured} is true, but each
 * method still guards defensively and returns a `{ ok: false }` envelope on any
 * Stripe error rather than throwing (so a server action can surface a message).
 *
 * Key behaviors:
 *   - Trial: 14 days of Pro, NO card (`payment_method_collection: 'if_required'`,
 *     `trial_period_days: 14`, `trial_settings.end_behavior.missing_payment_method:
 *     'cancel'`). We record the trialing Subscription locally too so the app
 *     works before the first webhook lands.
 *   - Checkout: subscription-mode Checkout using the configured price ids.
 *   - Portal: Stripe Customer Portal for self-service management.
 *   - Founding coupon: applied from env when present (a seam), else skipped.
 *   - SMS top-up: one-time payment-mode Checkout; fulfilment in the webhook.
 *   - Connect: Express account + account link for deposit onboarding.
 *
 * _Master Spec: §13.2, §13.3_
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Subscription } from '@/lib/db/models/subscription';
import { User } from '@/lib/db/models/user';
import { invalidateEntitlements, TRIAL_DAYS } from '@/lib/billing/entitlements';
import { PLANS, SMS_TOPUP, type BillingInterval } from '@/lib/plans';
import type {
  BillingProvider,
  BillingResult,
  CheckoutParams,
  CheckoutPlan,
} from '@/lib/billing/provider';

/**
 * Local Connect-configured check (§13.3). Duplicated from provider.ts's
 * {@link isConnectConfigured} intentionally: importing it as a runtime value
 * would create a value-level circular import (provider.ts imports StripeBilling
 * from here), so we keep this a local, import-safe helper.
 */
function isConnectConfigured(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID?.trim();
  const usable = (v: string | undefined) =>
    !!v && v.length > 0 && !v.includes('replace_me') && !v.startsWith('your-');
  return usable(secret) && usable(clientId);
}

/** Map (plan, interval) → the configured Stripe price id env, or null. */
function priceIdFor(plan: CheckoutPlan, interval: BillingInterval): string | null {
  const key =
    plan === 'solo'
      ? interval === 'year'
        ? 'STRIPE_PRICE_SOLO_YEAR'
        : 'STRIPE_PRICE_SOLO_MONTH'
      : interval === 'year'
        ? 'STRIPE_PRICE_PRO_YEAR'
        : 'STRIPE_PRICE_PRO_MONTH';
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The founding-member coupon id from env, if configured (a seam, §13.2).
 * `STRIPE_FOUNDING_COUPON_SOLO` / `_PRO` (per-plan) with a generic
 * `STRIPE_FOUNDING_COUPON_ID` fallback. Returns null when none is set.
 */
function foundingCouponId(plan: CheckoutPlan): string | null {
  const perPlan =
    plan === 'solo'
      ? process.env.STRIPE_FOUNDING_COUPON_SOLO
      : process.env.STRIPE_FOUNDING_COUPON_PRO;
  const generic = process.env.STRIPE_FOUNDING_COUPON_ID;
  const value = (perPlan && perPlan.trim()) || (generic && generic.trim()) || '';
  return value.length > 0 ? value : null;
}

/** A safe failure envelope with a user-facing message. */
function stripeError(message?: string): BillingResult {
  return {
    ok: false,
    reason: 'stripe_error',
    message:
      message ??
      'We could not reach billing right now. Please try again in a moment.',
  };
}

export class StripeBilling implements BillingProvider {
  /**
   * Ensure a Stripe Customer exists for a groomer and return its id. Reuses the
   * `stripeCustomerId` on the Subscription row when present; otherwise creates a
   * customer (using the groomer's email/name) and persists it. Returns null if
   * the groomer is unknown.
   */
  private async ensureCustomer(groomerId: string): Promise<string | null> {
    await connectDB();

    const existing = await Subscription.findOne({ groomerId })
      .select('stripeCustomerId')
      .lean<{ stripeCustomerId?: string | null } | null>();
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;

    const user = await User.findById(groomerId).select('email name').lean<{
      email?: string;
      name?: string;
    } | null>();
    if (!user) return null;

    const profile = await GroomerProfile.findOne({ userId: groomerId })
      .select('businessName businessEmail')
      .lean<{ businessName?: string; businessEmail?: string } | null>();

    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email: profile?.businessEmail || user.email || undefined,
      name: profile?.businessName || user.name || undefined,
      metadata: { groomerId },
    });

    // Persist the customer id (upsert so a groomer with no row yet gets one).
    await Subscription.findOneAndUpdate(
      { groomerId },
      { $set: { stripeCustomerId: customer.id }, $setOnInsert: { groomerId } },
      { upsert: true }
    );
    await invalidateEntitlements(groomerId);

    return customer.id;
  }

  async startTrial(params: CheckoutParams): Promise<BillingResult> {
    try {
      await connectDB();

      // Record the local trialing Subscription so entitlements reflect the Pro
      // trial immediately (the webhook will reconcile once a real subscription
      // is created). No card is required for the trial (§13.2).
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      await Subscription.findOneAndUpdate(
        { groomerId: params.groomerId },
        {
          $set: {
            plan: 'trial',
            status: 'trialing',
            trialEndsAt,
            smsIncluded: PLANS.trial.sms,
          },
          $setOnInsert: { groomerId: params.groomerId },
        },
        { upsert: true }
      );
      await invalidateEntitlements(params.groomerId);

      // The trial itself needs no checkout; land the groomer back on billing.
      return { ok: true, url: params.successUrl };
    } catch (err) {
      console.error('[billing] startTrial failed:', err);
      return stripeError();
    }
  }

  async createCheckout(
    params: CheckoutParams & { plan: CheckoutPlan; interval: BillingInterval }
  ): Promise<BillingResult> {
    try {
      const priceId = priceIdFor(params.plan, params.interval);
      if (!priceId) {
        return {
          ok: false,
          reason: 'not_configured',
          message: 'This plan is not available for checkout yet.',
        };
      }

      const customerId = await this.ensureCustomer(params.groomerId);
      if (!customerId) {
        return {
          ok: false,
          reason: 'unknown_groomer',
          message: 'We could not find your account. Please sign in again.',
        };
      }

      const stripe = getStripe();

      // Trial-with-no-card: 14-day Pro trial, cancel if no payment method is
      // added by the end (§13.2). Applied on the subscription created by this
      // Checkout so the "start free" path and an upgrade share one code path.
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
        {
          trial_period_days: TRIAL_DAYS,
          trial_settings: {
            end_behavior: { missing_payment_method: 'cancel' },
          },
          metadata: { groomerId: params.groomerId, plan: params.plan },
        };

      // Founding-member coupon seam (§13.2): apply when configured, else skip.
      const coupon = foundingCouponId(params.plan);
      const discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined =
        coupon ? [{ coupon }] : undefined;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // No card required up-front for the trial (§13.2).
        payment_method_collection: 'if_required',
        subscription_data: subscriptionData,
        ...(discounts ? { discounts } : {}),
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        client_reference_id: params.groomerId,
        metadata: { groomerId: params.groomerId, plan: params.plan },
      });

      if (!session.url) return stripeError();
      return { ok: true, url: session.url };
    } catch (err) {
      console.error('[billing] createCheckout failed:', err);
      return stripeError();
    }
  }

  async createPortal(params: {
    groomerId: string;
    returnUrl: string;
  }): Promise<BillingResult> {
    try {
      const customerId = await this.ensureCustomer(params.groomerId);
      if (!customerId) {
        return {
          ok: false,
          reason: 'unknown_groomer',
          message: 'We could not find your account. Please sign in again.',
        };
      }
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: params.returnUrl,
      });
      return { ok: true, url: session.url };
    } catch (err) {
      console.error('[billing] createPortal failed:', err);
      return stripeError();
    }
  }

  async createSmsTopupCheckout(params: CheckoutParams): Promise<BillingResult> {
    try {
      const customerId = await this.ensureCustomer(params.groomerId);
      if (!customerId) {
        return {
          ok: false,
          reason: 'unknown_groomer',
          message: 'We could not find your account. Please sign in again.',
        };
      }
      const stripe = getStripe();
      // One-time payment for the SMS top-up bundle (§13.4). We use inline
      // price_data so no extra price id env is required for the top-up.
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: SMS_TOPUP.price * 100,
              product_data: {
                name: `PawPort SMS top-up — ${SMS_TOPUP.messages} messages`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        client_reference_id: params.groomerId,
        // Tag the session so the webhook knows to credit the top-up balance.
        metadata: {
          groomerId: params.groomerId,
          kind: 'sms_topup',
          messages: String(SMS_TOPUP.messages),
        },
      });
      if (!session.url) return stripeError();
      return { ok: true, url: session.url };
    } catch (err) {
      console.error('[billing] createSmsTopupCheckout failed:', err);
      return stripeError();
    }
  }

  async createConnectAccountLink(params: {
    groomerId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<BillingResult> {
    // Connect (deposit onboarding, §13.3) is configured independently of
    // subscription billing. Guard on its own env so this degrades separately.
    if (!isConnectConfigured()) {
      return {
        ok: false,
        reason: 'connect_not_configured',
        message:
          "Online deposit payouts aren't set up yet. This will be available soon.",
      };
    }
    try {
      await connectDB();
      const stripe = getStripe();

      // Reuse the groomer's Connect account when we've already created one.
      const profile = await GroomerProfile.findOne({ userId: params.groomerId })
        .select('stripeConnectAccountId businessEmail')
        .lean<{ stripeConnectAccountId?: string; businessEmail?: string } | null>();

      let accountId = profile?.stripeConnectAccountId;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          email: profile?.businessEmail || undefined,
          metadata: { groomerId: params.groomerId },
        });
        accountId = account.id;
        await GroomerProfile.findOneAndUpdate(
          { userId: params.groomerId },
          { $set: { stripeConnectAccountId: accountId } }
        );
      }

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
        type: 'account_onboarding',
      });
      return { ok: true, url: link.url };
    } catch (err) {
      console.error('[billing] createConnectAccountLink failed:', err);
      return stripeError();
    }
  }
}
