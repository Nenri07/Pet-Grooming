import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureEmails, sendFillOfferEmail, sendRebookNudgeEmail } from '@/lib/email/send';

// Requirements 3.1, 4.2: Fill My Day offers and rebooking nudges are emailed
// with the groomer-branded layout, the claim/book link and Reply-To set to the groomer.

const prevBusinessEmail = process.env.BUSINESS_EMAIL;
beforeAll(() => {
  process.env.BUSINESS_EMAIL = 'support@pawxis.app';
});
afterAll(() => {
  if (prevBusinessEmail === undefined) delete process.env.BUSINESS_EMAIL;
  else process.env.BUSINESS_EMAIL = prevBusinessEmail;
});

const GROOMER_EMAIL = 'hello@happypaws.example';
const CLAIM_URL = 'https://pawxis.app/claim/abc123';
const BOOK_URL = 'https://pawxis.app/book/happy-paws?pet=p1';

const fillBase = {
  businessName: 'Happy Paws',
  petName: 'Bella',
  date: 'Thu, Jun 12',
  time: '2:30 PM',
  claimUrl: CLAIM_URL,
  replyTo: GROOMER_EMAIL,
};

const rebookBase = {
  businessName: 'Happy Paws',
  petName: 'Bella',
  dueDate: 'Thu, Jun 12',
  bookUrl: BOOK_URL,
  replyTo: GROOMER_EMAIL,
};

describe('Fill My Day offer email', () => {
  it('sends as the groomer with the claim link, slot and Reply-To', async () => {
    const [m] = await captureEmails(() => sendFillOfferEmail('client@example.com', fillBase));
    expect(m.to).toBe('client@example.com');
    expect(m.from).toBe('"Happy Paws via Pawxis" <support@pawxis.app>');
    expect(m.replyTo).toBe(GROOMER_EMAIL);
    expect(m.subject).toBe('Happy Paws has an opening on Thu, Jun 12 at 2:30 PM');
    expect(m.html).toContain(`href="${CLAIM_URL}"`);
    expect(m.text).toContain(CLAIM_URL);
    expect(m.text).toContain('Date: Thu, Jun 12');
    expect(m.text).toContain('Time: 2:30 PM');
    expect(m.text).not.toMatch(/<[a-z]/i);
  });

  it('escapes business and pet names in the HTML', async () => {
    const [m] = await captureEmails(() =>
      sendFillOfferEmail('client@example.com', { ...fillBase, businessName: 'Tom & Jerry <Grooming>', petName: '<b>Rex</b>' })
    );
    expect(m.html).toContain('Tom &amp; Jerry &lt;Grooming&gt;');
    expect(m.html).not.toContain('<Grooming>');
    expect(m.html).not.toContain('<b>Rex</b>');
    expect(m.from).toBe('"Tom & Jerry Grooming via Pawxis" <support@pawxis.app>');
  });

  it('drops a reply-to that is not a valid address', async () => {
    const [m] = await captureEmails(() => sendFillOfferEmail('client@example.com', { ...fillBase, replyTo: 'not an email' }));
    expect(m.replyTo).toBeUndefined();
  });
});

describe('Rebooking nudge email', () => {
  it('sends as the groomer with the booking link, due date and Reply-To', async () => {
    const [m] = await captureEmails(() => sendRebookNudgeEmail('client@example.com', rebookBase));
    expect(m.to).toBe('client@example.com');
    expect(m.from).toBe('"Happy Paws via Pawxis" <support@pawxis.app>');
    expect(m.replyTo).toBe(GROOMER_EMAIL);
    expect(m.subject).toBe('Bella is due for a groom');
    expect(m.html).toContain(`href="${BOOK_URL}"`);
    expect(m.text).toContain(BOOK_URL);
    expect(m.text).toContain('Bella is due for a groom around Thu, Jun 12');
    expect(m.text).not.toMatch(/<[a-z]/i);
  });

  it('escapes business and pet names in the HTML', async () => {
    const [m] = await captureEmails(() =>
      sendRebookNudgeEmail('client@example.com', { ...rebookBase, businessName: 'Tom & Jerry <Grooming>', petName: '<b>Rex</b>' })
    );
    expect(m.html).toContain('Tom &amp; Jerry &lt;Grooming&gt;');
    expect(m.html).not.toContain('<Grooming>');
    expect(m.html).not.toContain('<b>Rex</b>');
    expect(m.from).toBe('"Tom & Jerry Grooming via Pawxis" <support@pawxis.app>');
  });

  it('drops a reply-to that is not a valid address', async () => {
    const [m] = await captureEmails(() => sendRebookNudgeEmail('client@example.com', { ...rebookBase, replyTo: 'not an email' }));
    expect(m.replyTo).toBeUndefined();
  });
});
