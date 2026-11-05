'use server';

import { startOwnStripeCheckout, type StartCheckoutResult } from '@/lib/stripe/own-checkout';
import type { DepositMetadata } from '@/lib/stripe/helpers';

/** Start a card deposit on the groomer's own Stripe account; returns the checkout URL. */
export async function startCardDeposit(
  groomerSlug: string,
  booking: DepositMetadata
): Promise<StartCheckoutResult> {
  try {
    return await startOwnStripeCheckout(groomerSlug, booking);
  } catch (err) {
    console.error('[own-checkout] start failed:', err);
    return { ok: false, error: 'Card payment is unavailable right now. Please try again shortly.' };
  }
}
