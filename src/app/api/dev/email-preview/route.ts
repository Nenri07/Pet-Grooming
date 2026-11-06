/**
 * Local email previews: /api/dev/email-preview?t=confirmation&format=html|text
 * Disabled in production. Renders with sample data; nothing is sent.
 */
import { NextResponse } from 'next/server';
import * as send from '@/lib/email/send';

export const dynamic = 'force-dynamic';

const SAMPLES: Record<string, () => Promise<unknown>> = {
  confirmation: () =>
    send.sendClientConfirmationEmail('client@example.com', {
      date: 'Thursday, July 17, 2025',
      time: '2:30 PM',
      services: ['Full groom'],
      serviceAddress: '12 Oak Street, Austin, TX 78701',
      groomerName: 'Happy Paws',
      petName: 'Bella',
      depositAmount: 25,
      servicePrice: 85,
      currency: 'USD',
      groomerEmail: 'hello@happypaws.example',
      groomerPhone: '+1 512 555 0142',
      petCardUrl: 'https://www.pawxis.app/pet-card/sample',
    }),
  groomer: () =>
    send.sendGroomerNotificationEmail({
      to: 'hello@happypaws.example',
      businessName: 'Happy Paws',
      date: 'Thursday, July 17, 2025',
      time: '2:30 PM',
      services: ['Full groom'],
      serviceAddress: '12 Oak Street, Austin, TX 78701',
      clientName: 'Jordan Lee',
      clientPhone: '+1 512 555 0199',
      clientEmail: 'jordan@example.com',
      petName: 'Bella',
      petBreed: 'Goldendoodle',
      petSize: '45 lbs',
      specialNotes: 'Nervous with clippers near the ears.',
      appointmentUrl: 'https://www.pawxis.app/appointments/sample',
    }),
  reminder: () =>
    send.sendAppointmentReminderEmail('client@example.com', {
      kind: '24h',
      businessName: 'Happy Paws',
      petName: 'Bella',
      date: 'Thu, Jul 17',
      time: '2:30 PM',
      serviceAddress: '12 Oak Street, Austin',
      groomerPhone: '+1 512 555 0142',
      replyTo: 'hello@happypaws.example',
    }),
  'on-the-way': () =>
    send.sendOnTheWayEmail('client@example.com', {
      businessName: 'Happy Paws',
      petName: 'Bella',
      trackUrl: 'https://www.pawxis.app/t/sample',
      etaMinutes: 12,
      replyTo: 'hello@happypaws.example',
      groomerPhone: '+1 512 555 0142',
    }),
  message: () =>
    send.sendClientMessageEmail('client@example.com', {
      businessName: 'Happy Paws',
      body: 'Hi Jordan! Running about 10 minutes late today. See you soon.',
      replyTo: 'hello@happypaws.example',
      groomerPhone: '+1 512 555 0142',
    }),
  'fill-offer': () =>
    send.sendFillOfferEmail('jordan@example.com', {
      businessName: 'Happy Paws',
      petName: 'Bella',
      date: 'Thu, Jun 12',
      time: '2:30 PM',
      claimUrl: 'https://www.pawxis.app/claim/sample',
      replyTo: 'hello@happypaws.example',
      groomerPhone: '+1 512 555 0142',
    }),
  'rebook-nudge': () =>
    send.sendRebookNudgeEmail('jordan@example.com', {
      businessName: 'Happy Paws',
      petName: 'Bella',
      dueDate: 'Mon, Jul 21',
      bookUrl: 'https://www.pawxis.app/rebook/sample',
      replyTo: 'hello@happypaws.example',
      groomerPhone: '+1 512 555 0142',
    }),
  verification: () => send.sendEmailVerification('groomer@example.com', 'https://www.pawxis.app/verify-email?token=sample'),
  trial: () => send.sendTrialEndingEmail('groomer@example.com', { trialEndsOn: 'Monday, July 21', billingUrl: 'https://www.pawxis.app/billing' }),
};

export async function GET(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const url = new URL(req.url);
  const t = url.searchParams.get('t') ?? '';
  const sample = SAMPLES[t];
  if (!sample) {
    const links = Object.keys(SAMPLES)
      .map((k) => `<li><a href="?t=${k}">${k}</a> (<a href="?t=${k}&format=text">text</a>)</li>`)
      .join('');
    return new Response(`<h1>Email previews</h1><ul>${links}</ul>`, { headers: { 'content-type': 'text/html' } });
  }
  const [mail] = await send.captureEmails(sample);
  if (!mail) return NextResponse.json({ error: 'nothing rendered' }, { status: 500 });
  if (url.searchParams.get('format') === 'text') {
    return new Response(`From: ${mail.from}\nReply-To: ${mail.replyTo ?? '-'}\nSubject: ${mail.subject}\n\n${mail.text}`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(mail.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
