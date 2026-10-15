/**
 * PolarBilling - the BillingProvider implementation for the platform's own
 * revenue (groomer subscriptions + SMS top-ups) via Polar (merchant-of-record).
 *
 * Scope: createCheckout / createSmsTopupCheckout / createPortal run on Polar.
 * createConnectAccountLink DELEGATES to StripeBilling (client deposits stay on
 * Stripe Connect - Polar cannot do marketplace split-payouts). startTrial is
 * local (writes a trialing Subscription, no provider call), identical to
 * StripeBilling.startTrial so the trial works before any webhook.
 *
 * Every method returns a typed BillingResult and NEVER throws.
 */
import { getPolar } from '@/lib/polar/client';
import { connectDB } from '@/lib/db/connect';
import { Subscription } from '@/lib/db/models/subscription';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { invalidateEntitlements, TRIAL_DAYS } from '@/lib/billing/entitlements';
import { PLANS, type BillingInterval } from '@/lib/plans';
import { StripeBilling } from '@/lib/billing/stripe';
import {
  productIdFor,
  smsTopupProductId,
  discountIdForInterval,
} from '@/lib/billing/polar-products';
import type {
  BillingProvider,
  BillingResult,
  CheckoutParams,
  CheckoutPlan,
} from '@/lib/billing/provider';

/** Safe failure envelope (reuses the existing generic provider-error reason). */
function polarError(message?: string): BillingResult {
  return {
    ok: false,
    reason: 'stripe_error',
    message:
      message ??
      'We could not reach billing right now. Please try again in a moment.',
  };
}

export class PolarBilling implements BillingProvider {
  /** Deposits stay on Stripe Connect - delegate that one method only. */
  private readonly stripe = new StripeBilling();

  async startTrial(params: CheckoutParams): Promise<BillingResult> {
    try {
      await connectDB();
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
      return { ok: true, url: params.successUrl };
    } catch (err) {
      console.error('[billing] polar startTrial failed:', err);
      return polarError();
    }
  }

  async createCheckout(
    params: CheckoutParams & { plan: CheckoutPlan; interval: BillingInterval }
  ): Promise<BillingResult> {
    const productId = productIdFor(params.plan, params.interval);
    if (!productId) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'This plan is not available for checkout yet.',
      };
    }
    try {
      const email = await this.groomerEmail(params.groomerId);
      const discountId = discountIdForInterval(params.interval);
      const body: Record<string, unknown> = {
        products: [productId],
        successUrl: params.successUrl,
        externalCustomerId: params.groomerId,
        metadata: {
          groomerId: params.groomerId,
          plan: params.plan,
          interval: params.interval,
        },
      };
      if (email) body.customerEmail = email;
      if (discountId) body.discountId = discountId;
      const checkout = await getPolar().checkouts.create(body);
      const url = (checkout as { url?: string | null }).url;
      if (!url) return polarError();
      return { ok: true, url };
    } catch (err) {
      console.error('[billing] polar createCheckout failed:', err);
      return polarError();
    }
  }

  async createSmsTopupCheckout(params: CheckoutParams): Promise<BillingResult> {
    const productId = smsTopupProductId();
    if (!productId) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'SMS top-ups are not available yet.',
      };
    }
    try {
      const email = await this.groomerEmail(params.groomerId);
      const body: Record<string, unknown> = {
        products: [productId],
        successUrl: params.successUrl,
        externalCustomerId: params.groomerId,
        metadata: { groomerId: params.groomerId, kind: 'sms_topup' },
      };
      if (email) body.customerEmail = email;
      const checkout = await getPolar().checkouts.create(body);
      const url = (checkout as { url?: string | null }).url;
      if (!url) return polarError();
      // Balance is credited in the webhook on order.paid, not here.
      return { ok: true, url };
    } catch (err) {
      console.error('[billing] polar createSmsTopupCheckout failed:', err);
      return polarError();
    }
  }

  async createPortal(params: {
    groomerId: string;
    returnUrl: string;
  }): Promise<BillingResult> {
    try {
      await connectDB();
      const row = await Subscription.findOne({ groomerId: params.groomerId })
        .select('polarCustomerId')
        .lean<{ polarCustomerId?: string | null } | null>();
      // Prefer a stored Polar customer id; else create the session from the
      // external id (the groomer's User id we set at checkout).
      const body: Record<string, unknown> = row?.polarCustomerId
        ? { customerId: row.polarCustomerId }
        : { customerExternalId: params.groomerId };
      const session = await getPolar().customerSessions.create(body);
      const url = (session as { customerPortalUrl?: string | null }).customerPortalUrl;
      if (!url) {
        return {
          ok: false,
          reason: 'unknown_groomer',
          message: 'We could not open your billing portal. Please try again.',
        };
      }
      return { ok: true, url };
    } catch (err) {
      console.error('[billing] polar createPortal failed:', err);
      return polarError();
    }
  }

  async createConnectAccountLink(params: {
    groomerId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<BillingResult> {
    // Client deposits stay on Stripe Connect - delegate unchanged.
    return this.stripe.createConnectAccountLink(params);
  }

  /** Best email for the Polar customer: business email, else the login email. */
  private async groomerEmail(groomerId: string): Promise<string | null> {
    await connectDB();
    const profile = await GroomerProfile.findOne({ userId: groomerId })
      .select('businessEmail')
      .lean<{ businessEmail?: string } | null>();
    if (profile?.businessEmail) return profile.businessEmail;
    const user = await User.findById(groomerId)
      .select('email')
      .lean<{ email?: string } | null>();
    return user?.email ?? null;
  }
}
