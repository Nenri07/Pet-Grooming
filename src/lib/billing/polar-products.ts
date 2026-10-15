/**
 * Polar product + discount mapping (PURE — no DB / SDK / IO).
 *
 * Single source of truth mapping (plan, interval) and the SMS top-up to the
 * Polar product ids from env, a reverse lookup (product id -> {plan,interval})
 * for the webhook, and the early-bird discount id by interval. Kept pure so it
 * is fully unit/property testable without a database or the Polar SDK.
 */
import type { CheckoutPlan } from '@/lib/billing/provider';
import type { BillingInterval } from '@/lib/plans';

export interface PlanInterval {
  plan: CheckoutPlan;
  interval: BillingInterval;
}

/** Treat present, non-placeholder strings as configured. */
function cfg(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t.includes('replace_me') || t.startsWith('your-')) return null;
  return t;
}

const ENV_KEY: Record<string, string> = {
  'solo:month': 'POLAR_PRODUCT_SOLO_MONTH',
  'solo:year': 'POLAR_PRODUCT_SOLO_YEAR',
  'pro:month': 'POLAR_PRODUCT_PRO_MONTH',
  'pro:year': 'POLAR_PRODUCT_PRO_YEAR',
};

/** (plan, interval) -> product id, or null when that product env is unset. */
export function productIdFor(
  plan: CheckoutPlan,
  interval: BillingInterval
): string | null {
  return cfg(process.env[ENV_KEY[`${plan}:${interval}`]]);
}

/** SMS top-up product id, or null when unset. */
export function smsTopupProductId(): string | null {
  return cfg(process.env.POLAR_PRODUCT_SMS_TOPUP);
}

/**
 * Reverse: product id -> {plan, interval}, or null. Excludes the SMS top-up
 * (that is not a subscription plan). When PRO_MONTH and PRO_YEAR are set to
 * the same id (a misconfig), the first matching key wins deterministically.
 */
export function planIntervalForProductId(productId: string): PlanInterval | null {
  for (const key of Object.keys(ENV_KEY)) {
    const id = cfg(process.env[ENV_KEY[key]]);
    if (id && id === productId) {
      const [plan, interval] = key.split(':') as [CheckoutPlan, BillingInterval];
      return { plan, interval };
    }
  }
  return null;
}

/** True when a product id matches the configured SMS top-up product. */
export function isSmsTopupProduct(productId: string): boolean {
  const id = smsTopupProductId();
  return !!id && id === productId;
}

/** Early-bird discount id auto-applied by interval, or null (optional). */
export function discountIdForInterval(interval: BillingInterval): string | null {
  return interval === 'year'
    ? cfg(process.env.POLAR_DISCOUNT_YEARLY)
    : cfg(process.env.POLAR_DISCOUNT_MONTHLY);
}

/** True when the access token + at least one subscription product id are set. */
export function isPolarConfigured(): boolean {
  const token = cfg(process.env.POLAR_ACCESS_TOKEN);
  const anyProduct =
    productIdFor('solo', 'month') ||
    productIdFor('solo', 'year') ||
    productIdFor('pro', 'month') ||
    productIdFor('pro', 'year');
  return !!token && !!anyProduct;
}
