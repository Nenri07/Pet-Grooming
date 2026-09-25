/**
 * QStash reminder delivery (POST /api/qstash/reminder).
 *
 * QStash calls this endpoint at the scheduled delay for each reminder job
 * published by {@link scheduleReminders}. We verify the QStash signature with a
 * {@link Receiver} (QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY), then
 * load the appointment, resolve the client + pet + slot context, and call
 * {@link sendSms} for the reminder kind.
 *
 * Degradation: when the signing keys are unconfigured we 200 no-op — QStash
 * would never call an endpoint we couldn't schedule against anyway.
 *
 * Node runtime: signature verification + Mongoose need Node APIs.
 *
 * _Master Spec: §12.3, §16_
 */
import { NextResponse } from 'next/server';
import { sendSms } from '@/lib/sms/send-sms';
import type { SmsKind } from '@/lib/sms/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReminderPayload {
  appointmentId: string;
  groomerId: string;
  kind: SmsKind;
}

function keysConfigured(): boolean {
  return Boolean(
    process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!keysConfigured()) {
    return NextResponse.json({ received: true, skipped: 'qstash_unconfigured' }, { status: 200 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
  }

  // Verify the QStash signature.
  try {
    const { Receiver } = await import('@upstash/qstash');
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
    });
    const valid = await receiver.verify({ signature, body: rawBody });
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }
  } catch (err) {
    console.error('[qstash:reminder] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: ReminderPayload;
  try {
    payload = JSON.parse(rawBody) as ReminderPayload;
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }

  if (!payload.appointmentId || !payload.groomerId || !payload.kind) {
    return NextResponse.json({ error: 'Incomplete payload' }, { status: 400 });
  }

  try {
    const ctx = await loadReminderContext(payload.appointmentId, payload.groomerId);
    if (!ctx) {
      // Appointment gone / cancelled — nothing to remind about. Ack so QStash
      // doesn't retry.
      return NextResponse.json({ received: true, skipped: 'no_appointment' }, { status: 200 });
    }

    await sendSms({
      groomerId: payload.groomerId,
      clientId: ctx.clientId,
      appointmentId: payload.appointmentId,
      to: ctx.phone,
      kind: payload.kind,
      vars: { pet: ctx.petName, date: ctx.date, time: ctx.time },
    });
  } catch (err) {
    // sendSms never throws, but guard the context load too. Ack regardless.
    console.error('[qstash:reminder] delivery failed:', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

/**
 * Load everything the reminder needs: the client's phone, the pet name, and a
 * formatted date/time. Returns `null` if the appointment is missing or
 * cancelled (a cancelled appointment must not remind).
 */
async function loadReminderContext(
  appointmentId: string,
  groomerId: string
): Promise<{ clientId: string; phone: string; petName: string; date: string; time: string } | null> {
  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');
  const { Client } = await import('@/lib/db/models/client');
  const { Pet } = await import('@/lib/db/models/pet');
  const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');

  const appt = await Appointment.findOne({ _id: appointmentId, groomerId })
    .select('clientId petId scheduledDate status')
    .lean();
  if (!appt) return null;
  const a = appt as unknown as {
    clientId: unknown;
    petId: unknown;
    scheduledDate: Date;
    status: string;
  };
  if (a.status === 'cancelled') return null;

  const [client, pet, profile] = await Promise.all([
    Client.findById(a.clientId).select('phone name').lean(),
    Pet.findById(a.petId).select('name').lean(),
    GroomerProfile.findOne({ userId: groomerId }).select('timezone').lean(),
  ]);

  const phone = (client as { phone?: string } | null)?.phone;
  if (!phone) return null;

  const petName = (pet as { name?: string } | null)?.name ?? 'your pet';
  const timezone = (profile as { timezone?: string } | null)?.timezone ?? 'UTC';

  const when = new Date(a.scheduledDate);
  const date = when.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = when.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  return { clientId: String(a.clientId), phone, petName, date, time };
}
