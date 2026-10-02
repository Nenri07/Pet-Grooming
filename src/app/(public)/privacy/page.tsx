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
 * /privacy — Privacy Policy. Static server component; indexable.
 */
export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Pawxis collects, uses, shares, and protects personal data for groomers and their clients.',
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This policy explains what personal data Pawxis collects, how we use and share it, and the choices you have."
    >
      <Section heading="1. Who controls your data">
        <P>
          Pawxis is operated by <Placeholder>{PH.company}</Placeholder> (&ldquo;we,&rdquo;
          &ldquo;us&rdquo;), located at <Placeholder>{PH.address}</Placeholder>.
          For data that a Groomer stores about their own Clients and pets, the
          Groomer is the controller and Pawxis acts as a processor on their
          behalf. For account, billing, and security data about Groomers, Pawxis
          is the controller.
        </P>
      </Section>

      <Section heading="2. Data we collect">
        <UL
          items={[
            <>
              <strong>Account data.</strong> Name, email address, phone number,
              password (stored hashed), business details, and preferences.
            </>,
            <>
              <strong>Client and pet records.</strong> Information Groomers enter
              about their Clients and pets, such as names, contact details,
              addresses, pet profiles, notes, and appointment history.
            </>,
            <>
              <strong>Booking and messaging data.</strong> Appointments,
              availability, and the content and delivery status of SMS and email
              reminders.
            </>,
            <>
              <strong>Payment data.</strong> Subscription and deposit transactions
              are processed by Stripe. We receive limited details such as status
              and the last digits of a card; we do not store full card numbers.
            </>,
            <>
              <strong>Device and usage data.</strong> IP address, device and
              browser information, and log data, used to operate the Service and
              for security and abuse prevention.
            </>,
          ]}
        />
      </Section>

      <Section heading="3. How we use data">
        <UL
          items={[
            'Provide, maintain, and improve the Service, including bookings, routing, reminders, and payments.',
            'Authenticate users and keep accounts and sessions secure.',
            'Send transactional messages such as booking confirmations, reminders, and account notices.',
            'Prevent, detect, and investigate fraud, abuse, and security incidents, including rate-limiting and IP-based protections.',
            'Comply with legal obligations and enforce our terms.',
          ]}
        />
      </Section>

      <Section heading="4. SMS and email consent">
        <P>
          Groomers are responsible for obtaining consent from their Clients before
          contacting them by SMS or email through the Service, and for honoring
          opt-outs. Clients can opt out of SMS at any time by replying{' '}
          <strong>STOP</strong> to a message; replying <strong>HELP</strong> requests
          help. We process these messages to deliver reminders and confirmations and
          do not sell message content.
        </P>
      </Section>

      <Section heading="5. Cookies and local storage">
        <P>
          We use strictly necessary cookies to keep you signed in and to secure
          your session, and we use your browser&rsquo;s local storage to remember
          your theme preference. We do not use advertising or cross-site tracking
          cookies. See our <a href="/cookies">Cookie Policy</a> for details.
        </P>
      </Section>

      <Section heading="6. How we share data">
        <P>
          We do not sell personal data. We share it only as needed to run the
          Service, with service providers acting on our instructions:
        </P>
        <UL
          items={[
            <>
              <strong>Stripe</strong> — subscription billing and, via Stripe
              Connect, Client deposit processing paid to Groomers.
            </>,
            <>
              <strong>Twilio</strong> — delivery of SMS reminders and
              notifications.
            </>,
            <>
              <strong>Email provider</strong> — delivery of transactional email.
            </>,
            <>
              <strong>Hosting and infrastructure providers</strong> — hosting,
              storage, and operational tooling.
            </>,
          ]}
        />
        <P>
          We may also disclose data to comply with law, enforce our terms, or
          protect rights and safety, and in connection with a merger, acquisition,
          or sale of assets.
        </P>
      </Section>

      <Section heading="7. Retention">
        <P>
          We keep personal data for as long as an account is active and as needed
          to provide the Service, then for a reasonable period to meet legal,
          accounting, and security obligations. Groomers can delete Client and pet
          records they control; some data may persist in backups for a limited
          time before being overwritten.
        </P>
      </Section>

      <Section heading="8. Your rights">
        <P>
          Depending on your location, you may have rights to access, correct,
          delete, or port your personal data, and to object to or restrict certain
          processing. To exercise a right, contact{' '}
          <Placeholder>{PH.email}</Placeholder>. If your data is held by a Groomer
          as controller, we may direct your request to that Groomer. We will
          respond consistent with applicable law.
        </P>
      </Section>

      <Section heading="9. Security">
        <P>
          We use technical and organizational measures designed to protect
          personal data, including encrypted transport, hashed passwords, and
          access controls. No system is perfectly secure, so we cannot guarantee
          absolute security.
        </P>
      </Section>

      <Section heading="10. Children">
        <P>
          The Service is intended for business users and is not directed to
          children. We do not knowingly collect personal data from children.
        </P>
      </Section>

      <Section heading="11. International transfers">
        <P>
          Our providers may process data in countries other than yours. Where
          required, we rely on appropriate safeguards for such transfers.
        </P>
      </Section>

      <Section heading="12. Changes and contact">
        <P>
          We may update this policy and will revise the effective date above when
          we do. For privacy questions or requests, contact{' '}
          <Placeholder>{PH.company}</Placeholder> at{' '}
          <Placeholder>{PH.email}</Placeholder>,{' '}
          <Placeholder>{PH.address}</Placeholder>.
        </P>
      </Section>
    </LegalPage>
  );
}
