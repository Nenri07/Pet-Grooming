import type { Metadata } from 'next';
import {
  LegalPage,
  LEGAL_PLACEHOLDERS as PH,
  Section,
  P,
  UL,
  Placeholder,
} from '@/components/legal/LegalPage';

/**
 * /acceptable-use — Acceptable Use Policy. Static server component; indexable.
 */
export const metadata: Metadata = {
  title: 'Acceptable Use Policy',
  description:
    'The rules for using Pawxis responsibly, including messaging, data, and security.',
  alternates: { canonical: '/acceptable-use' },
  robots: { index: true, follow: true },
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable Use Policy"
      intro="This policy sets out how you may and may not use Pawxis. It supplements our Terms of Service."
    >
      <Section heading="1. General expectations">
        <P>
          You agree to use Pawxis lawfully, honestly, and in a way that respects
          other users, Clients, and third parties. You are responsible for all
          activity under your account and for the content and data you add.
        </P>
      </Section>

      <Section heading="2. Prohibited conduct">
        <UL
          items={[
            'Using the Service for anything illegal, fraudulent, deceptive, or harmful.',
            'Violating the privacy or rights of others, or uploading data you do not have the right to use.',
            'Attempting to gain unauthorized access to the Service, other accounts, or related systems, or probing or breaching security.',
            'Interfering with or disrupting the Service, including by introducing malware or overloading infrastructure.',
            'Reselling, sublicensing, or copying the Service except as expressly permitted.',
          ]}
        />
      </Section>

      <Section heading="3. Messaging and SMS rules">
        <P>
          The Service can send SMS and email on your behalf. You must only message
          Clients who have consented to be contacted, send only messages that
          relate to their bookings and your legitimate business, and honor
          opt-outs immediately.
        </P>
        <UL
          items={[
            'No spam, bulk unsolicited messaging, or marketing without consent.',
            'Honor STOP requests — recipients who reply STOP must not be messaged again, and HELP requests must be supported.',
            'Comply with all applicable messaging and telemarketing laws and carrier requirements.',
          ]}
        />
      </Section>

      <Section heading="4. Data and scraping">
        <P>
          You must not scrape, crawl, or bulk-extract data from the Service, nor
          use automated means to harvest Client, pet, or booking data beyond the
          features we provide. You must not use the Service to build a competing
          dataset or to deanonymize or track individuals improperly.
        </P>
      </Section>

      <Section heading="5. Payments">
        <P>
          You must not use the Service&rsquo;s payment features for fraudulent,
          deceptive, or prohibited transactions, or in violation of Stripe&rsquo;s
          terms. Groomers are responsible for the accuracy of their pricing,
          deposits, and tax handling.
        </P>
      </Section>

      <Section heading="6. Enforcement">
        <P>
          Violating this policy may result in suspension or termination of your
          account, removal of content, and, where appropriate, reporting to
          authorities. We may act immediately where there is risk of harm, legal
          exposure, or abuse.
        </P>
      </Section>

      <Section heading="7. Reporting and contact">
        <P>
          To report abuse or ask questions about this policy, contact{' '}
          <Placeholder>{PH.company}</Placeholder> at{' '}
          <Placeholder>{PH.email}</Placeholder>. We may update this policy and
          will revise the effective date above when we do.
        </P>
      </Section>
    </LegalPage>
  );
}
