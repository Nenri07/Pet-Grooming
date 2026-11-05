'use server';

/**
 * Connect / disconnect a groomer's OWN Stripe account by pasting one key.
 * See {@link import('@/lib/stripe/own-account')} for the model.
 *
 * The key is checked against Stripe before it is stored, stored sealed, and
 * never returned to the browser. A webhook is registered on the groomer's
 * account so deposits are confirmed even if the client closes the tab.
 */
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import Stripe from 'stripe';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { isSecretBoxConfigured, sealSecret } from '@/lib/crypto/secret-box';
import {
  keyHint,
  loadOwnStripe,
  looksLikeStripeSecretKey,
  OWN_WEBHOOK_EVENTS,
  ownStripeClient,
  ownWebhookUrl,
} from '@/lib/stripe/own-account';

export type ConnectOwnStripeResult =
  | { ok: true; accountName: string; livemode: boolean; autoConfirm: boolean }
  | { ok: false; error: string };

function accountDisplayName(acct: Stripe.Account | null): string | null {
  if (!acct) return null;
  return (
    acct.settings?.dashboard?.display_name ||
    acct.business_profile?.name ||
    acct.email ||
    null
  );
}

export async function connectOwnStripe(rawKey: string): Promise<ConnectOwnStripeResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { ok: false, error: 'You must be signed in.' };
  if (!isSecretBoxConfigured()) {
    return { ok: false, error: 'Stripe connection isn\u2019t available yet. Please try again later.' };
  }

  const key = (typeof rawKey === 'string' ? rawKey : '').trim();
  if (key.startsWith('pk_')) {
    return { ok: false, error: 'That\u2019s the publishable key. Paste the restricted key (rk_…) or secret key (sk_…) instead.' };
  }
  if (!looksLikeStripeSecretKey(key)) {
    return { ok: false, error: 'That doesn\u2019t look like a Stripe key. It should start with rk_live_ or sk_live_.' };
  }

  const stripe = ownStripeClient(key);

  // 1. Prove the key works and can create checkouts.
  try {
    await stripe.checkout.sessions.list({ limit: 1 });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      return { ok: false, error: 'Stripe didn\u2019t accept that key. Copy it again and paste the whole key.' };
    }
    if (err instanceof Stripe.errors.StripePermissionError) {
      return {
        ok: false,
        error: 'This key isn\u2019t allowed to take payments. Turn on \u201cCheckout Sessions: Write\u201d for it in Stripe.',
      };
    }
    console.error('[own-stripe] key check failed:', (err as Error).message);
    return { ok: false, error: 'We couldn\u2019t reach Stripe. Please try again in a moment.' };
  }

  // 2. Account name for display (optional permission).
  let account: Stripe.Account | null = null;
  try {
    account = await stripe.accounts.retrieveCurrent();
  } catch {
    account = null;
  }

  await connectDB();
  const profile = await GroomerProfile.findOne({ userId: session.user.id })
    .select('_id ownStripeWebhookId')
    .lean<{ _id: unknown; ownStripeWebhookId?: string } | null>();
  if (!profile) return { ok: false, error: 'Business profile not found.' };
  const profileId = String(profile._id);

  // 3. Register (or replace) the per-groomer webhook. Optional: a restricted key
  //    without "Webhook Endpoints: Write" still works via the return-page check.
  if (profile.ownStripeWebhookId) {
    await stripe.webhookEndpoints.del(profile.ownStripeWebhookId).catch(() => undefined);
  }
  let webhook: { id: string; secret: string } | null = null;
  const url = ownWebhookUrl(profileId);
  if (url.startsWith('https://')) {
    try {
      const ep = await stripe.webhookEndpoints.create({
        url,
        enabled_events: OWN_WEBHOOK_EVENTS,
        description: 'Pawxis booking deposits',
      });
      if (ep.secret) webhook = { id: ep.id, secret: ep.secret };
    } catch (err) {
      console.warn('[own-stripe] webhook not created:', (err as Error).message);
    }
  }

  const livemode = key.includes('_live_');
  const accountName = accountDisplayName(account) ?? `Stripe account ${keyHint(key)}`;

  const set: Record<string, unknown> = {
    ownStripeKeyEnc: sealSecret(key),
    ownStripeKeyHint: keyHint(key),
    ownStripeAccountName: accountName.slice(0, 200),
    ownStripeLivemode: livemode,
    ownStripeConnectedAt: new Date(),
  };
  const unset: Record<string, unknown> = {};
  if (webhook) {
    set.ownStripeWebhookId = webhook.id;
    set.ownStripeWebhookSecretEnc = sealSecret(webhook.secret);
  } else {
    unset.ownStripeWebhookId = '';
    unset.ownStripeWebhookSecretEnc = '';
  }
  await GroomerProfile.updateOne(
    { _id: profile._id },
    Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set }
  );

  revalidatePath('/settings');
  return { ok: true, accountName, livemode, autoConfirm: webhook !== null };
}

export async function disconnectOwnStripe(): Promise<{ ok: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { ok: false, error: 'You must be signed in.' };
  await connectDB();
  const own = await loadOwnStripe({ userId: session.user.id });
  const profile = await GroomerProfile.findOne({ userId: session.user.id })
    .select('ownStripeWebhookId')
    .lean<{ ownStripeWebhookId?: string } | null>();
  if (own && profile?.ownStripeWebhookId) {
    await own.stripe.webhookEndpoints.del(profile.ownStripeWebhookId).catch(() => undefined);
  }
  await GroomerProfile.updateOne(
    { userId: session.user.id },
    {
      $unset: {
        ownStripeKeyEnc: '',
        ownStripeWebhookSecretEnc: '',
        ownStripeWebhookId: '',
        ownStripeKeyHint: '',
        ownStripeAccountName: '',
        ownStripeLivemode: '',
        ownStripeConnectedAt: '',
      },
    }
  );
  revalidatePath('/settings');
  return { ok: true };
}
