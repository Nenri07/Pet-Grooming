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
 * /terms — Terms of Service.
 *
 * Static server component. The title resolves to "Terms of Service · Pawxis"
 * via the root layout's `%s · Pawxis` template. Indexable (default robots).
 */
export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms that govern use of Pawxis, the mobile pet-grooming booking and subscription platform.',
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms govern your access to and use of Pawxis, the mobile pet-grooming booking and subscription platform operated by the company named below."
    >
      <Section heading="1. Who we are and acceptance of these terms">
        <P>
          Pawxis (the &ldquo;Service&rdquo;) is operated by{' '}
          <Placeholder>{PH.company}</Placeholder>, located at{' '}
          <Placeholder>{PH.address}</Placeholder> (&ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By creating an account,
          accessing, or using the Service you agree to these Terms of Service. If
          you do not agree, do not use the Service.
        </P>
        <P>
          These terms take effect on{' '}
          <Placeholder>{PH.effectiveDate}</Placeholder> and apply to all users of
          the Service.
        </P>
      </Section>

      <Section heading="2. The Service and user roles">
        <P>
          Pawxis helps independent and mobile pet groomers (&ldquo;Groomers&rdquo;)
          run their business — managing bookings and schedules, routing,
          availability, client and pet records, deposits, and reminders. The
          Service also provides public booking pages used by a Groomer&rsquo;s
          customers (&ldquo;Clients&rdquo;).
        </P>
        <UL
          items={[
            <>
              <strong>Groomers</strong> hold a Pawxis account, configure their
              services and policies, and are responsible for the grooming
              services they provide to their Clients.
            </>,
            <>
              <strong>Clients</strong> interact with a Groomer&rsquo;s booking
              page to request appointments and, where required, pay a deposit.
            </>,
          ]}
        />
        <P>
          Pawxis provides software only. We are not a party to the grooming
          services arranged between a Groomer and a Client, and we do not provide
          pet-grooming services ourselves.
        </P>
      </Section>

      <Section heading="3. Accounts and eligibility">
        <P>
          You must be at least 18 years old and able to form a binding contract
          to create an account. You are responsible for keeping your login
          credentials secure and for all activity under your account. Notify us
          promptly at <Placeholder>{PH.email}</Placeholder> if you suspect
          unauthorized use. You agree to provide accurate information and to keep
          it up to date.
        </P>
      </Section>

      <Section heading="4. Subscriptions, trial, and billing">
        <P>
          Groomer access to Pawxis is sold as a subscription. New Groomer
          accounts may begin with a 14-day free trial. We do not charge you
          during the trial, and if you cancel before the trial ends you will not
          be billed for the subscription.
        </P>
        <UL
          items={[
            'After the trial, the subscription renews automatically each billing period until cancelled, and your chosen payment method is charged the then-current fee plus any applicable taxes.',
            'You can cancel at any time from your account settings. Cancellation stops future renewals; it does not retroactively refund the current period except as described in our Refund & Cancellation Policy.',
            'We may change subscription pricing with reasonable advance notice; changes apply to billing periods that begin after the notice.',
          ]}
        />
        <P>
          Pawxis subscription payments are processed by our payment processor,
          Stripe. By subscribing you also agree to Stripe&rsquo;s applicable
          terms.
        </P>
      </Section>

      <Section heading="5. Client deposits and payment processing">
        <P>
          Where a Groomer requires a deposit, payments from Clients are processed
          through Stripe using Stripe Connect, and funds are paid directly to the
          Groomer&rsquo;s connected Stripe account. For these Client deposits,
          Pawxis is <strong>not</strong> the merchant of record — the Groomer is
          the merchant and is solely responsible for the underlying grooming
          service, pricing, taxes, deposit terms, and any refunds.
        </P>
        <P>
          Pawxis facilitates the transaction and may collect platform or
          subscription fees from Groomers, but we do not hold Client deposit funds
          as the seller of the grooming service.
        </P>
      </Section>

      <Section heading="6. Acceptable use">
        <P>
          You agree to use the Service lawfully and not to misuse it. Prohibited
          conduct includes, without limitation, sending unlawful or non-consented
          SMS or email, scraping or bulk-extracting data, attempting to breach
          security or access other users&rsquo; data, uploading malware, or
          infringing others&rsquo; rights. Our{' '}
          <a href="/acceptable-use">Acceptable Use Policy</a> is incorporated into
          these terms by reference.
        </P>
      </Section>

      <Section heading="7. Your content and data">
        <P>
          You retain ownership of the content and records you add to the Service,
          including Client and pet records. You grant us a limited license to
          host, process, and display that content solely to operate and improve
          the Service. You are responsible for having the necessary rights and
          consents for the data you upload, including consent to contact Clients
          by SMS or email. Our handling of personal data is described in our{' '}
          <a href="/privacy">Privacy Policy</a>.
        </P>
      </Section>

      <Section heading="8. Intellectual property">
        <P>
          The Service, including its software, design, and the Pawxis name and
          logo, is owned by <Placeholder>{PH.company}</Placeholder> or its
          licensors and is protected by law. These terms do not grant you any
          right to our trademarks or to copy, modify, or reverse engineer the
          Service except as permitted by law.
        </P>
      </Section>

      <Section heading="9. Disclaimers">
        <P>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; without warranties of any kind, whether express or
          implied, including merchantability, fitness for a particular purpose,
          and non-infringement, to the fullest extent permitted by law. We do not
          warrant that the Service will be uninterrupted, error-free, or secure,
          and we are not responsible for the acts or omissions of Groomers or
          Clients.
        </P>
      </Section>

      <Section heading="10. Limitation of liability">
        <P>
          To the maximum extent permitted by law,{' '}
          <Placeholder>{PH.company}</Placeholder> will not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or
          for lost profits, revenue, data, or goodwill. Our total liability for
          any claim relating to the Service will not exceed the amount you paid us
          for the Service in the twelve months before the event giving rise to the
          claim.
        </P>
      </Section>

      <Section heading="11. Indemnification">
        <P>
          You agree to indemnify and hold harmless{' '}
          <Placeholder>{PH.company}</Placeholder> from claims, damages, and
          expenses arising out of your use of the Service, your content, your
          grooming services, or your violation of these terms or applicable law.
        </P>
      </Section>

      <Section heading="12. Suspension and termination">
        <P>
          You may stop using the Service and close your account at any time. We
          may suspend or terminate access if you breach these terms, create risk
          or legal exposure, or fail to pay fees. On termination, your right to
          use the Service ends; some provisions, such as those on liability and
          intellectual property, survive.
        </P>
      </Section>

      <Section heading="13. Changes to these terms">
        <P>
          We may update these terms from time to time. If we make material
          changes we will provide reasonable notice, for example by posting the
          updated terms with a new effective date. Continued use after changes
          take effect means you accept the updated terms.
        </P>
      </Section>

      <Section heading="14. Governing law and disputes">
        <P>
          These terms are governed by the laws of{' '}
          <Placeholder>{PH.jurisdiction}</Placeholder>, without regard to its
          conflict-of-laws rules, and the courts located in{' '}
          <Placeholder>{PH.jurisdiction}</Placeholder> will have jurisdiction over
          any disputes, except where applicable law provides otherwise.
        </P>
      </Section>

      <Section heading="15. Contact">
        <P>
          Questions about these terms can be sent to{' '}
          <Placeholder>{PH.email}</Placeholder>, or by mail to{' '}
          <Placeholder>{PH.company}</Placeholder>,{' '}
          <Placeholder>{PH.address}</Placeholder>.
        </P>
      </Section>
    </LegalPage>
  );
}
