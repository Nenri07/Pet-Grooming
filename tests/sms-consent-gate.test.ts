import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The "Text me appointment updates" checkbox collects consent for texts. While
 * automatic texting is off (Twilio not configured), showing it would promise
 * messages that are never sent. These source-level checks keep it hidden unless
 * `isSmsConfigured()` says texting is on. Pure: no DOM, no network.
 */

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

describe('SMS consent checkbox is only offered when texting is on', () => {
  it('StepOwnerDetails renders the checkbox only inside an offerSms gate', () => {
    const src = read('src/components/booking/StepOwnerDetails.tsx');
    const gate = src.indexOf('{offerSms && (');
    const checkbox = src.indexOf('id="owner-sms-consent"');
    expect(gate, 'offerSms gate').toBeGreaterThan(-1);
    expect(checkbox, 'checkbox').toBeGreaterThan(-1);
    expect(gate).toBeLessThan(checkbox);
  });

  it('BookingFlow only passes offerSms when the groomer object says so', () => {
    const src = read('src/components/booking/BookingFlow.tsx');
    expect(src).toContain('offerSms: groomer.offerSms === true');
  });

  it('the public booking page turns it on only from isSmsConfigured()', () => {
    const src = read('src/app/(booking-standalone)/book/[groomerSlug]/page.tsx');
    expect(src).toContain("import { isSmsConfigured } from '@/lib/sms/provider'");
    expect(src).toContain('offerSms: isSmsConfigured()');
  });
});
