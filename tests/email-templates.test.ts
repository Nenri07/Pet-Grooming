import { describe, expect, it } from 'vitest';
import {
  captureEmails,
  fromHeader,
  sendClientConfirmationEmail,
  sendGroomerNotificationEmail,
} from '@/lib/email/send';

process.env.BUSINESS_EMAIL = 'support@pawxis.app';

const base = {
  date: 'Thursday, July 17, 2025',
  time: '2:30 PM',
  services: ['Full groom'],
  serviceAddress: '12 Oak Street',
  groomerName: 'Happy Paws',
  petName: 'Bella',
  depositAmount: 25,
  servicePrice: 85,
  groomerEmail: 'hello@happypaws.example',
};

describe('booking emails', () => {
  it('sends as the groomer, replies go to the groomer, and include plain text', async () => {
    const [m] = await captureEmails(() => sendClientConfirmationEmail('c@example.com', base));
    expect(m.from).toBe('"Happy Paws via Pawxis" <support@pawxis.app>');
    expect(m.replyTo).toBe('hello@happypaws.example');
    expect(m.html).toContain('Balance due on the day');
    expect(m.html).toContain('$60.00');
    expect(m.text).toContain('Deposit paid');
    expect(m.text).not.toMatch(/<[a-z]/i);
  });

  it('escapes business and client input', async () => {
    const [m] = await captureEmails(() =>
      sendClientConfirmationEmail('c@example.com', { ...base, groomerName: '<script>x</script>', petName: 'A"B' })
    );
    expect(m.html).not.toContain('<script>');
    expect(m.from).not.toMatch(/[<>].*[<>].*</);
  });

  it('drops a malformed reply-to and strips header-breaking characters', async () => {
    const [m] = await captureEmails(() => sendClientConfirmationEmail('c@example.com', { ...base, groomerEmail: 'not an email' }));
    expect(m.replyTo).toBeUndefined();
    expect(fromHeader('Evil"\r\nBcc: x@y.z')).toBe('"EvilBcc: x@y.z via Pawxis" <support@pawxis.app>');
  });

  it('sends the new-booking notice to the groomer, not the platform inbox', async () => {
    const [m] = await captureEmails(() =>
      sendGroomerNotificationEmail({
        to: 'hello@happypaws.example',
        clientEmail: 'jordan@example.com',
        date: 'Thu',
        time: '2:30 PM',
        services: ['Full groom'],
        serviceAddress: '12 Oak',
        clientName: 'Jordan',
        clientPhone: '+1',
        petName: 'Bella',
        petBreed: 'Poodle',
        petSize: '40 lbs',
      })
    );
    expect(m.to).toBe('hello@happypaws.example');
    expect(m.replyTo).toBe('jordan@example.com');
  });
});
