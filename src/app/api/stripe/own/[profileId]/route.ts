/**
 * Per-groomer Stripe webhook (POST /api/stripe/own/{profileId}).
 *
 * Registered on the groomer's OWN Stripe account when they connect it. Each
 * groomer has their own signing secret (stored sealed), so the profile id in
 * the URL only selects which secret to verify with; nothing is trusted until
 * the signature checks out. On a paid Checkout Session we create the booking
 * (idempotent with the return-page confirmation).
 */
import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import type Stripe from 'stripe';
import { loadOwnStripe } from '@/lib/stripe/own-account';
import { confirmOwnStripeCheckout } from '@/lib/stripe/own-checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: { profileId: string } }
): Promise<Response> {
  if (!isValidObjectId(params.profileId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const own = await loadOwnStripe({ profileId: params.profileId });
  if (!own?.webhookSecret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 400 });
  }

  const raw = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = own.stripe.webhooks.constructEvent(raw, signature, own.webhookSecret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.pawxis === '1' && session.payment_status === 'paid') {
      try {
        const res = await confirmOwnStripeCheckout(own, session.id);
        if (!res.ok) console.warn('[own-webhook] not fulfilled:', res.error);
      } catch (err) {
        console.error('[own-webhook] fulfil failed:', err);
        // Let Stripe retry on unexpected errors.
        return NextResponse.json({ error: 'retry' }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ received: true });
}
