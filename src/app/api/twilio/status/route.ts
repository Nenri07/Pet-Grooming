/**
 * Twilio delivery-status callback (POST /api/twilio/status).
 *
 * Twilio POSTs a form-encoded delivery update for each message it sends
 * (queued → sent → delivered / failed / undelivered). We validate the request
 * signature with the auth token (Master Spec §12.1) and update the matching
 * {@link SmsMessage} row by its Twilio SID.
 *
 * Degradation: when Twilio is unconfigured (no auth token), we 200 no-op — a
 * status callback can only arrive for a message we sent via Twilio, so this
 * path is inert in a credential-free environment.
 *
 * Node runtime: signature validation + Mongoose need Node APIs.
 *
 * _Master Spec: §12.1_
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Build the absolute URL Twilio signed (must match exactly for validation). */
function requestUrl(req: Request): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (base) return `${base}/api/twilio/status`;
  // Fall back to the incoming URL if the app URL isn't configured.
  return req.url;
}

export async function POST(req: Request): Promise<Response> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // No Twilio → nothing could have been sent through it → inert no-op.
  if (!authToken) {
    return NextResponse.json({ received: true, skipped: 'twilio_unconfigured' }, { status: 200 });
  }

  // Twilio sends application/x-www-form-urlencoded.
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const signature = req.headers.get('x-twilio-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
  }

  // Validate the signature (Master Spec §12.1).
  try {
    const twilio = (await import('twilio')) as unknown as {
      validateRequest: (
        token: string,
        signature: string,
        url: string,
        params: Record<string, string>
      ) => boolean;
    };
    const valid = twilio.validateRequest(authToken, signature, requestUrl(req), params);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }
  } catch (err) {
    console.error('[twilio:status] signature validation error:', err);
    return NextResponse.json({ error: 'Validation error' }, { status: 403 });
  }

  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  const errorCode = params.ErrorCode;

  if (!sid || !status) {
    // Acknowledge malformed callbacks so Twilio stops retrying.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();
    const { SmsMessage } = await import('@/lib/db/models/sms-message');

    const update: Record<string, unknown> = { status };
    if (errorCode) update.errorCode = String(errorCode);

    await SmsMessage.updateOne({ twilioSid: sid }, { $set: update });
  } catch (err) {
    // A DB hiccup shouldn't cause Twilio to hammer us with retries; log + 200.
    console.error('[twilio:status] failed to update SmsMessage:', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
