/**
 * Groomer-owned Stripe accounts ("paste one key").
 *
 * Pawxis can't run Stripe Connect yet (its own Stripe account needs a company
 * in a Stripe-supported country), so a groomer can connect THEIR Stripe account
 * by pasting one key. Deposits are then charged on the groomer's account with
 * Stripe Checkout and confirmed automatically: on return from Checkout, and by
 * a webhook Pawxis registers on the groomer's account.
 *
 * Keys are sealed with {@link sealSecret} and never sent to the browser.
 * Server-only.
 */
import Stripe from 'stripe';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { isSecretBoxConfigured, openSecret } from '@/lib/crypto/secret-box';

/** Secret ("sk_") or restricted ("rk_") key, live or test. Publishable keys are rejected. */
const KEY_PATTERN = /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/;

export function looksLikeStripeSecretKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** "rk_live_…7f3a" — enough to recognise the key, useless to an attacker. */
export function keyHint(key: string): string {
  const prefix = key.slice(0, key.indexOf('_', 3) + 1);
  return `${prefix}…${key.slice(-4)}`;
}

export function ownStripeClient(key: string): Stripe {
  return new Stripe(key, { typescript: true, appInfo: { name: 'Pawxis' } });
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

export function ownWebhookUrl(profileId: string): string {
  return `${appBaseUrl()}/api/stripe/own/${profileId}`;
}

/** Events the per-groomer webhook listens to. */
export const OWN_WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
];

export interface OwnStripeAccount {
  profileId: string;
  groomerId: string;
  groomerSlug: string;
  businessName: string;
  stripe: Stripe;
  webhookSecret: string | null;
}

/**
 * Load a groomer's connected Stripe account by slug (booking side) or by user
 * id (portal side). Null when not connected or the key can't be opened.
 */
export async function loadOwnStripe(
  where: { groomerSlug: string } | { userId: string } | { profileId: string }
): Promise<OwnStripeAccount | null> {
  if (!isSecretBoxConfigured()) return null;
  await connectDB();
  const filter =
    'profileId' in where ? { _id: where.profileId } : 'userId' in where ? { userId: where.userId } : { groomerSlug: where.groomerSlug };
  const profile = await GroomerProfile.findOne(filter)
    .select('+ownStripeKeyEnc +ownStripeWebhookSecretEnc userId groomerSlug businessName')
    .lean<{
      _id: unknown;
      userId: unknown;
      groomerSlug?: string;
      businessName?: string;
      ownStripeKeyEnc?: string;
      ownStripeWebhookSecretEnc?: string;
    } | null>();
  if (!profile?.ownStripeKeyEnc) return null;
  try {
    const key = openSecret(profile.ownStripeKeyEnc);
    return {
      profileId: String(profile._id),
      groomerId: String(profile.userId),
      groomerSlug: profile.groomerSlug ?? '',
      businessName: profile.businessName?.trim() || 'your groomer',
      stripe: ownStripeClient(key),
      webhookSecret: profile.ownStripeWebhookSecretEnc ? openSecret(profile.ownStripeWebhookSecretEnc) : null,
    };
  } catch (err) {
    console.error('[own-stripe] could not open stored key:', (err as Error).message);
    return null;
  }
}

/** Cheap check used by booking pages: is a key stored for this groomer? */
export function hasOwnStripe(profile: { ownStripeConnectedAt?: Date | null }): boolean {
  return isSecretBoxConfigured() && Boolean(profile.ownStripeConnectedAt);
}
