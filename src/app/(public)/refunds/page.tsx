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
 * /refunds — Refund & Cancellation Policy. Static server component; indexable.
 */
export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description:
    'How deposits, cancellations, and Pawxis subscription refunds work.',
  alternates: { canonical: '/refunds' },
  robots: { index: true, follow: true },
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      intro="This policy covers two separate things: deposits paid by Clients to Groomers, and the Pawxis subscription paid by Groomers."
    >
      <Section heading="1. Client deposits are set by each Groomer">
        <P>
          When a Client pays a deposit through a Groomer&rsquo;s booking page,
          that payment is processed via Stripe and goes directly to the Groomer.
          The deposit amount, cancellation window, no-show rules, and any refund
          of a deposit are set and controlled by the <strong>Groomer</strong>,
          not by Pawxis.
        </P>
        <UL
          items={[
            'Pawxis facilitates the payment but is not the merchant of record for Client deposits and does not decide whether a deposit is refundable.',
            'Clients should review the Groomer’s stated cancellation and deposit terms before booking.',
            'Refund or cancellation requests for a deposit should be directed to the Groomer who provided the service.',
          ]}
        />
      </Section>

      <Section heading="2. Cancellations by Clients">
        <P>
          Clients cancel or reschedule according to the policy shown by their
          Groomer at the time of booking. Depending on that policy and timing, a
          deposit may be fully refundable, partially refundable, or non-refundable.
        </P>
      </Section>

      <Section heading="3. Pawxis subscription — free trial">
        <P>
          New Groomer accounts may include a 14-day free trial. We do not charge
          you during the trial. If you cancel before the trial ends, you are not
          billed for the subscription, so there is nothing to refund.
        </P>
      </Section>

      <Section heading="4. Pawxis subscription — refunds">
        <UL
          items={[
            'Subscription fees are billed in advance for each billing period and are generally non-refundable except where required by law.',
            'Cancelling your subscription stops future renewals; you keep access until the end of the current paid period.',
            'If you believe you were billed in error, contact us promptly and we will review the charge in good faith.',
          ]}
        />
        <P>
          Where a refund is granted, it is returned to your original payment
          method through Stripe.
        </P>
      </Section>

      <Section heading="5. How to request a subscription refund">
        <P>
          Email <Placeholder>{PH.email}</Placeholder> from the address on your
          account and include your account details and the charge in question. We
          aim to respond within a reasonable time.
        </P>
      </Section>

      <Section heading="6. Changes and contact">
        <P>
          We may update this policy and will revise the effective date above when
          we do. Questions can be sent to <Placeholder>{PH.company}</Placeholder>{' '}
          at <Placeholder>{PH.email}</Placeholder>,{' '}
          <Placeholder>{PH.address}</Placeholder>.
        </P>
      </Section>
    </LegalPage>
  );
}
