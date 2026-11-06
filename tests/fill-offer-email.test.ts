/**
 * Fill My Day offers by email (Requirements 3.1, 3.2, 3.4).
 *
 * Exercises `offerToCandidate` with the real email renderer (via
 * `captureEmails`). Redis, the message allowance and the SMS provider are
 * stubbed at the module boundary so no infra is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  allowance: true,
  setClaim: vi.fn(async () => undefined),
  meter: vi.fn(async () => undefined),
  smsConfigured: false,
  sendSms: vi.fn(async () => ({})),
}));

vi.mock('@/lib/redis', () => ({
  isRedisConfigured: () => true,
  setClaim: h.setClaim,
}));
vi.mock('@/lib/messaging/usage', () => ({
  canSendOptionalMessage: async () => h.allowance,
  meterClientMessage: h.meter,
}));
vi.mock('@/lib/sms/provider', () => ({ isSmsConfigured: () => h.smsConfigured }));
vi.mock('@/lib/sms/send-sms', () => ({ sendSms: h.sendSms }));

import { captureEmails } from '@/lib/email/send';
import { offerToCandidate } from '@/lib/fill/fill';

// 2024-06-03 16:00 UTC = 12:00 in New York (EDT).
const START = new Date('2024-06-03T16:00:00.000Z').getTime();

function args(candidate: { clientId: string; email?: string; phone?: string }) {
  return {
    groomerId: 'g1',
    candidate,
    gapStartMs: START,
    gapEndMs: START + 60 * 60 * 1000,
    business: 'Happy Paws',
    timezone: 'America/New_York',
    replyTo: 'hello@happypaws.example',
    groomerPhone: '+15555550100',
  };
}

beforeEach(() => {
  h.allowance = true;
  h.smsConfigured = false;
  h.setClaim.mockClear();
  h.meter.mockClear();
  h.sendSms.mockClear();
});

describe('offerToCandidate (email)', () => {
  it('emails the claim link in the groomer timezone with Reply-To and meters it', async () => {
    let result = false;
    const mails = await captureEmails(async () => {
      result = await offerToCandidate(args({ clientId: 'c1', email: 'owner@example.com', phone: '+15555550111' }));
    });

    expect(result).toBe(true);
    expect(mails).toHaveLength(1);
    const [m] = mails;
    expect(m.to).toBe('owner@example.com');
    expect(m.replyTo).toBe('hello@happypaws.example');
    expect(m.text).toMatch(/\/claim\/[\w-]+/);
    expect(m.text).toContain('12:00');
    expect(m.text).toContain('Jun 3');
    expect(h.setClaim).toHaveBeenCalledTimes(1);
    expect(h.meter).toHaveBeenCalledWith('g1');
    // Twilio not configured: no SMS attempt.
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it('skips a client with no email (3.4)', async () => {
    let result = true;
    const mails = await captureEmails(async () => {
      result = await offerToCandidate(args({ clientId: 'c2', phone: '+15555550111' }));
    });
    expect(result).toBe(false);
    expect(mails).toHaveLength(0);
    expect(h.setClaim).not.toHaveBeenCalled();
    expect(h.meter).not.toHaveBeenCalled();
  });

  it('skips sending when the message allowance is used up (3.2)', async () => {
    h.allowance = false;
    let result = true;
    const mails = await captureEmails(async () => {
      result = await offerToCandidate(args({ clientId: 'c3', email: 'owner@example.com' }));
    });
    expect(result).toBe(false);
    expect(mails).toHaveLength(0);
    expect(h.setClaim).not.toHaveBeenCalled();
    expect(h.meter).not.toHaveBeenCalled();
  });

  it('also sends the SMS offer only when Twilio is configured and a phone is set', async () => {
    h.smsConfigured = true;
    await captureEmails(async () => {
      await offerToCandidate(args({ clientId: 'c4', email: 'owner@example.com', phone: '+15555550111' }));
    });
    expect(h.sendSms).toHaveBeenCalledTimes(1);
  });
});
