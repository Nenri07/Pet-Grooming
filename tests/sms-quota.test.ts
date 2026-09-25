/**
 * SMS pure-core unit tests (Master Spec §0 rule 3 — SMS quota tests allowed;
 * §12.3).
 *
 * These exercise ONLY the pure decision cores — no Twilio, no Redis, no DB:
 *   - quota: canSend shedding order (marketing first, then all but
 *     confirmations) + isTransactional classification.
 *   - quiet-hours: isWithinQuietHours (marketing window; transactional anytime).
 *   - consent: mayReceive (opt-out / consent / confirmation exception) +
 *     interpretInbound (STOP / START / HELP / reply).
 *   - reminders: computeReminderDelays (drops past reminders).
 */
import { describe, expect, it } from 'vitest';
import { canSend, isTransactional, QUOTA_BUFFER } from '@/lib/sms/quota';
import { isWithinQuietHours } from '@/lib/sms/quiet-hours';
import { mayReceive, interpretInbound } from '@/lib/sms/consent';
import { computeReminderDelays } from '@/lib/sms/reminders';
import type { SmsKind } from '@/lib/sms/provider';

// ---------------------------------------------------------------------------
// isTransactional classification (§12.3)
// ---------------------------------------------------------------------------
describe('isTransactional', () => {
  const transactional: SmsKind[] = [
    'booking_confirmed',
    'reminder_24h',
    'reminder_2h',
    'on_my_way',
    'running_late',
    'rescheduled',
    'cancelled',
    'deposit_receipt',
    'reply',
  ];
  const marketing: SmsKind[] = ['rebook_nudge', 'review_request', 'fill_my_day_offer'];

  it('classifies confirmations, reminders, receipts and status as transactional', () => {
    for (const kind of transactional) {
      expect(isTransactional(kind), kind).toBe(true);
    }
  });

  it('classifies rebook / review / fill offers as marketing', () => {
    for (const kind of marketing) {
      expect(isTransactional(kind), kind).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// canSend shedding order (§12.3)
// ---------------------------------------------------------------------------
describe('canSend quota decision', () => {
  const included = 300;
  // soft = included - buffer; below soft everything flows.
  const soft = included - QUOTA_BUFFER;

  it('allows all kinds well under the allowance', () => {
    for (const kind of [
      'booking_confirmed',
      'reminder_24h',
      'rebook_nudge',
      'review_request',
    ] as SmsKind[]) {
      expect(canSend({ used: 0, included, kind }).allowed, kind).toBe(true);
    }
  });

  it('blocks MARKETING first once the buffered soft ceiling is reached', () => {
    // At the soft ceiling: marketing blocked, transactional still allowed.
    expect(canSend({ used: soft, included, kind: 'rebook_nudge' })).toEqual({
      allowed: false,
      reason: 'quota_marketing',
    });
    expect(canSend({ used: soft, included, kind: 'fill_my_day_offer' }).allowed).toBe(false);
    expect(canSend({ used: soft, included, kind: 'review_request' }).allowed).toBe(false);

    // Transactional still flows in the buffer zone.
    expect(canSend({ used: soft, included, kind: 'reminder_24h' }).allowed).toBe(true);
    expect(canSend({ used: soft, included, kind: 'booking_confirmed' }).allowed).toBe(true);
  });

  it('blocks EVERYTHING except booking confirmations at 100%', () => {
    // At/over the hard ceiling: only booking_confirmed survives.
    const used = included;
    expect(canSend({ used, included, kind: 'booking_confirmed' }).allowed).toBe(true);

    for (const kind of [
      'reminder_24h',
      'reminder_2h',
      'on_my_way',
      'deposit_receipt',
      'reply',
      'rebook_nudge',
      'review_request',
      'fill_my_day_offer',
    ] as SmsKind[]) {
      const res = canSend({ used, included, kind });
      expect(res.allowed, kind).toBe(false);
      expect(res.reason, kind).toBe('quota_exhausted');
    }
  });

  it('over 100% still lets booking confirmations through', () => {
    expect(canSend({ used: included + 50, included, kind: 'booking_confirmed' }).allowed).toBe(
      true
    );
    expect(canSend({ used: included + 50, included, kind: 'reminder_24h' }).allowed).toBe(false);
  });

  it('degrades safely with a non-positive allowance (confirmations only)', () => {
    expect(canSend({ used: 0, included: 0, kind: 'booking_confirmed' }).allowed).toBe(true);
    expect(canSend({ used: 0, included: 0, kind: 'reminder_24h' }).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// quiet hours (§12.3)
// ---------------------------------------------------------------------------
describe('isWithinQuietHours', () => {
  it('never restricts transactional messages (anytime)', () => {
    for (const h of [0, 3, 7, 21, 23]) {
      expect(isWithinQuietHours({ hour: h, minute: 0 }, 'booking_confirmed')).toBe(false);
      expect(isWithinQuietHours({ hour: h, minute: 0 }, 'reminder_2h')).toBe(false);
    }
  });

  it('blocks marketing OUTSIDE 08:00–20:30 local', () => {
    // Before the window.
    expect(isWithinQuietHours({ hour: 7, minute: 59 }, 'rebook_nudge')).toBe(true);
    expect(isWithinQuietHours({ hour: 0, minute: 0 }, 'review_request')).toBe(true);
    // After the window.
    expect(isWithinQuietHours({ hour: 20, minute: 31 }, 'fill_my_day_offer')).toBe(true);
    expect(isWithinQuietHours({ hour: 23, minute: 0 }, 'rebook_nudge')).toBe(true);
  });

  it('allows marketing INSIDE the window, boundaries inclusive', () => {
    expect(isWithinQuietHours({ hour: 8, minute: 0 }, 'rebook_nudge')).toBe(false);
    expect(isWithinQuietHours({ hour: 12, minute: 0 }, 'review_request')).toBe(false);
    expect(isWithinQuietHours({ hour: 20, minute: 30 }, 'fill_my_day_offer')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consent gate (§12.3)
// ---------------------------------------------------------------------------
describe('mayReceive consent gate', () => {
  it('never sends to an opted-out number', () => {
    expect(mayReceive('booking_confirmed', { optOut: true, consentAt: new Date() })).toBe(false);
    expect(mayReceive('reminder_24h', { optOut: true })).toBe(false);
    expect(mayReceive('rebook_nudge', { optOut: true, consentAt: new Date() })).toBe(false);
  });

  it('sends anything (except opt-out) when consent is recorded', () => {
    const consentAt = new Date();
    for (const kind of ['booking_confirmed', 'reminder_24h', 'rebook_nudge'] as SmsKind[]) {
      expect(mayReceive(kind, { consentAt }), kind).toBe(true);
    }
  });

  it('without consent, allows ONLY a transactional booking confirmation', () => {
    expect(mayReceive('booking_confirmed', {})).toBe(true);
    expect(mayReceive('booking_confirmed', { consentAt: null })).toBe(true);

    for (const kind of ['reminder_24h', 'rebook_nudge', 'review_request', 'reply'] as SmsKind[]) {
      expect(mayReceive(kind, {}), kind).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// inbound keyword handling (§12.3)
// ---------------------------------------------------------------------------
describe('interpretInbound', () => {
  it('recognises STOP variants', () => {
    for (const b of ['STOP', 'stop', ' Stop ', 'STOP.', 'unsubscribe', 'cancel', 'quit', 'END']) {
      expect(interpretInbound(b), b).toBe('stop');
    }
  });

  it('recognises START variants', () => {
    for (const b of ['START', 'start', 'Yes', 'unstop']) {
      expect(interpretInbound(b), b).toBe('start');
    }
  });

  it('recognises HELP variants', () => {
    for (const b of ['HELP', 'help', 'info', 'Help!']) {
      expect(interpretInbound(b), b).toBe('help');
    }
  });

  it('treats a normal message as a reply', () => {
    for (const b of ['see you then', 'can we move to 3pm?', 'thanks!', '', '   ']) {
      expect(interpretInbound(b), JSON.stringify(b)).toBe('reply');
    }
  });

  it('only treats the FIRST token as a command', () => {
    // "please stop by later" starts with "please", so it's a reply, not STOP.
    expect(interpretInbound('please stop by later')).toBe('reply');
  });
});

// ---------------------------------------------------------------------------
// reminder scheduling math (§12.3)
// ---------------------------------------------------------------------------
describe('computeReminderDelays', () => {
  const HOUR = 60 * 60 * 1000;
  const now = 1_700_000_000_000;

  it('schedules both when the appointment is > 24h out', () => {
    const start = now + 48 * HOUR;
    const delays = computeReminderDelays(start, now);
    expect(delays.map((d) => d.kind)).toEqual(['reminder_24h', 'reminder_2h']);
    expect(delays[0].delayMs).toBe(24 * HOUR);
    expect(delays[1].delayMs).toBe(46 * HOUR);
  });

  it('drops the 24h reminder when the appointment is < 24h out', () => {
    const start = now + 3 * HOUR;
    const delays = computeReminderDelays(start, now);
    expect(delays.map((d) => d.kind)).toEqual(['reminder_2h']);
    expect(delays[0].delayMs).toBe(1 * HOUR);
  });

  it('schedules nothing when the appointment is < 2h out', () => {
    const start = now + 30 * 60 * 1000; // 30 min
    expect(computeReminderDelays(start, now)).toEqual([]);
  });
});
