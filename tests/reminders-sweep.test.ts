import { describe, expect, it } from 'vitest';
import { isReminderDue, REMINDER_WINDOWS } from '@/lib/reminders/run-due';
import { whatsappLink } from '@/lib/email/send';

const H = 60 * 60 * 1000;
const now = new Date('2026-11-05T12:00:00Z');
const [day, twoHour] = REMINDER_WINDOWS;
const at = (ms: number) => new Date(now.getTime() + ms);

describe('isReminderDue', () => {
  it('sends the 24h reminder once inside 24h, but not inside the last 2h', () => {
    const created = at(-3 * 24 * H);
    expect(isReminderDue(day, { scheduledDate: at(25 * H), createdAt: created }, now)).toBe(false);
    expect(isReminderDue(day, { scheduledDate: at(23 * H), createdAt: created }, now)).toBe(true);
    expect(isReminderDue(day, { scheduledDate: at(1 * H), createdAt: created }, now)).toBe(false);
  });

  it('skips the 24h reminder for a booking made less than 24h ahead', () => {
    expect(isReminderDue(day, { scheduledDate: at(10 * H), createdAt: at(-1 * H) }, now)).toBe(false);
  });

  it('sends the 2h reminder inside 2h only', () => {
    const created = at(-2 * 24 * H);
    expect(isReminderDue(twoHour, { scheduledDate: at(3 * H), createdAt: created }, now)).toBe(false);
    expect(isReminderDue(twoHour, { scheduledDate: at(90 * 60 * 1000), createdAt: created }, now)).toBe(true);
    expect(isReminderDue(twoHour, { scheduledDate: at(-5 * 60 * 1000), createdAt: created }, now)).toBe(false);
  });
});

describe('whatsappLink', () => {
  it('builds wa.me links from formatted numbers', () => {
    expect(whatsappLink('+44 7700 900123')).toBe('https://wa.me/447700900123');
    expect(whatsappLink('12')).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
  });
});
