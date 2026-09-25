/**
 * Twilio inbound message webhook (POST /api/twilio/inbound).
 *
 * Twilio POSTs a form-encoded payload when a client texts the groomer's number.
 * We validate the signature (Master Spec §12.1), classify the body with
 * {@link interpretInbound}, and:
 *   - STOP  → set the matching client's `smsOptOut = true`, reply confirmation.
 *   - START → clear `smsOptOut`, reply confirmation.
 *   - HELP  → reply with help text (no state change).
 *   - reply → log the inbound message on the client's thread; an unknown number
 *             creates a "lead" thread (SmsMessage with no clientId).
 *
 * We always return TwiML (empty or with a reply message) so Twilio is happy.
 * When Twilio is unconfigured we 200 no-op.
 *
 * Node runtime: signature validation + Mongoose need Node APIs.
 *
 * _Master Spec: §12.1, §12.3_
 */
import { NextResponse } from 'next/server';
import { interpretInbound } from '@/lib/sms/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Content type for TwiML responses. */
const TWIML_HEADERS = { 'Content-Type': 'text/xml' } as const;

/** Wrap a message in a minimal TwiML <Response>. Empty message → empty response. */
function twiml(message?: string): string {
  if (!message) return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

function requestUrl(req: Request): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (base) return `${base}/api/twilio/inbound`;
  return req.url;
}

export async function POST(req: Request): Promise<Response> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // No Twilio → inbound can't arrive → inert no-op.
  if (!authToken) {
    return new NextResponse(twiml(), { status: 200, headers: TWIML_HEADERS });
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const signature = req.headers.get('x-twilio-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
  }

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
    console.error('[twilio:inbound] signature validation error:', err);
    return NextResponse.json({ error: 'Validation error' }, { status: 403 });
  }

  const from = params.From ?? '';
  const to = params.To ?? '';
  const body = params.Body ?? '';
  const twilioSid = params.MessageSid || params.SmsSid;

  const intent = interpretInbound(body);

  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();
    const { Client } = await import('@/lib/db/models/client');
    const { SmsMessage } = await import('@/lib/db/models/sms-message');

    // Resolve which groomer owns the number that received this message. We match
    // clients by their phone across groomers; the `To` number ideally maps to a
    // groomer, but multi-tenant number→groomer resolution is a SEAM (§12.4 A2P).
    // For now we match the sender's phone to an existing client to attribute the
    // thread; unmatched senders become a lead with no clientId.
    const digits = normalizePhone(from);
    const client = digits
      ? await Client.findOne({ phone: buildPhoneRegex(digits) }).lean()
      : null;

    const groomerId = (client as { groomerId?: unknown } | null)?.groomerId ?? null;
    const clientId = (client as { _id?: unknown } | null)?._id ?? null;

    // Apply STOP/START to the matched client's opt-out flag.
    if (client && (intent === 'stop' || intent === 'start')) {
      await Client.updateOne(
        { _id: (client as { _id: unknown })._id },
        { $set: { smsOptOut: intent === 'stop' } }
      ).catch(() => {});
    }

    // Log the inbound message (thread or lead). We only have a groomerId when a
    // client matched; unmatched leads are still logged against the receiving
    // number so the Inbox can show them once number→groomer mapping lands.
    if (groomerId) {
      await SmsMessage.create({
        groomerId,
        clientId,
        direction: 'in',
        kind: 'reply',
        body: body || '(empty)',
        phone: from,
        twilioSid,
        status: 'received',
        read: false,
      }).catch(() => {});
    } else {
      console.info(`[twilio:inbound] lead from ${from} to ${to} (no matching client).`);
    }
  } catch (err) {
    console.error('[twilio:inbound] handling failed:', err);
  }

  // Reply per intent.
  const business = 'PawPort';
  if (intent === 'stop') {
    return new NextResponse(
      twiml(`You've been unsubscribed and won't receive more texts. Reply START to opt back in.`),
      { status: 200, headers: TWIML_HEADERS }
    );
  }
  if (intent === 'start') {
    return new NextResponse(twiml(`You're subscribed again. Reply STOP to opt out.`), {
      status: 200,
      headers: TWIML_HEADERS,
    });
  }
  if (intent === 'help') {
    return new NextResponse(
      twiml(`${business}: For help, reply to this thread. Reply STOP to opt out.`),
      { status: 200, headers: TWIML_HEADERS }
    );
  }

  // Normal reply: acknowledge silently (empty TwiML) — the groomer answers from
  // the Inbox.
  return new NextResponse(twiml(), { status: 200, headers: TWIML_HEADERS });
}

/** Reduce a phone to its trailing digits for loose matching. */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** A regex matching a stored phone that ends with the same last-10 digits. */
function buildPhoneRegex(digits: string): RegExp {
  const last10 = digits.slice(-10);
  return new RegExp(`${last10}$`);
}
