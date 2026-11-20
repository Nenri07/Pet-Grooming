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
              password (stored hashed), business details such as business name,
              logo, prices and service area, and preferences. If you choose to
              sign in with Google, Google shares your name, email address and
              profile picture with us.
            </>,
            <>
              <strong>Client and pet records.</strong> Information Groomers enter
              about their Clients and pets, such as names, contact details,
              addresses, pet profiles, notes, and appointment history.
            </>,
            <>
              <strong>Booking and messaging data.</strong> Appointments,
              availability, and the confirmations, reminders and other messages
              sent through the Service, with their delivery status. If a Groomer
              logs a message they sent from their own phone (for example by
              WhatsApp or text), we store the text of that message in the
              Client&rsquo;s conversation.
            </>,
            <>
              <strong>Location data.</strong> Addresses are converted into map
              coordinates to check service areas and plan routes. When a Groomer
              starts live tracking for a visit, the position of the
              Groomer&rsquo;s device is stored for up to two hours and shown to
              the Client of that visit.
            </>,
            <>
              <strong>Payment data.</strong> Pawxis subscriptions and message
              top-ups are paid through Polar, our merchant of record. We receive
              limited details such as plan status and the last digits of a card;
              we do not see or store full card numbers. Client deposits are paid
              to the Groomer, either by card through Stripe into the
              Groomer&rsquo;s own Stripe account, or through a payment link the
              Groomer provides. If a Groomer connects their own Stripe account,
              we store the restricted API key they give us, encrypted. Pawxis
              does not receive or hold Client deposit funds.
            </>,
            <>
              <strong>Device and usage data.</strong> IP address, device and
              browser information, and log data, used to operate the Service and
              for security and abuse prevention.
            </>,
            <>
              <strong>Free-trial record.</strong> To limit repeated free trials,
              we keep a small record that stays after an account is closed: the
              normalized email address, a partly masked IP address and an
              anonymous device identifier (a hash), plus a one-way hash of a
              phone number if one is verified.
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

      <Section heading="4. Email and other messages">
        <P>
          Pawxis sends booking confirmations, reminders and similar service
          messages to a Groomer&rsquo;s Clients by email, on the
          Groomer&rsquo;s behalf. Groomers are responsible for having the right
          to contact their Clients and for honoring opt-out requests. Groomers
          can also message Clients through WhatsApp or their phone&rsquo;s
          texting app from their own device; those messages are sent by the
          Groomer, not by Pawxis.
        </P>
        <P>
          Pawxis does not currently send text messages (SMS) automatically. If
          we add this, we will update this policy first and ask for consent
          where the law requires it. We do not sell message content.
        </P>
      </Section>

      <Section heading="5. Cookies and local storage">
        <P>
          We use strictly necessary cookies to keep you signed in and to secure
          your session, and we use your browser&rsquo;s local storage to remember
          your theme preference. We do not set advertising or cross-site
          tracking cookies. Some tools we embed, such as maps and checkout pages,
          may set their own. See our <a href="/cookies">Cookie Policy</a> for
          details.
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
              <strong>Polar</strong> — merchant of record for Pawxis
              subscriptions and message top-ups, including tax handling.
            </>,
            <>
              <strong>Stripe</strong> — only when a Groomer connects their own
              Stripe account: processes Client card deposits for that Groomer.
            </>,
            <>
              <strong>Resend</strong> — delivery of email, such as booking
              confirmations, reminders and account messages.
            </>,
            <>
              <strong>MongoDB Atlas</strong> — database hosting for account,
              client, pet and booking records.
            </>,
            <>
              <strong>Upstash</strong> — short-lived data such as slot holds,
              rate-limit counters and live-tracking positions.
            </>,
            <>
              <strong>Vercel</strong> — hosting of the website and application.
            </>,
            <>
              <strong>Cloudinary</strong> — storage of images uploaded to the
              Service, such as logos, pet photos and before/after photos.
            </>,
            <>
              <strong>Mapbox and OpenStreetMap</strong> — address search, maps
              and driving directions. They receive addresses or coordinates and
              the IP address of the device loading a map.
            </>,
            <>
              <strong>Google</strong> — only if you choose to sign in with Google.
            </>,
            <>
              <strong>Supademo</strong> — the interactive product tour on our
              website. It loads only after you click to start it.
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
          accounting, and security obligations. To delete a Client or pet
          record, or your whole account, email{' '}
          <Placeholder>{PH.email}</Placeholder> from the address on your
          account. We will delete it, except for data we must keep for legal or
          accounting reasons and the free-trial record described in section 2.
          Some data may persist in backups for a limited time before being
          overwritten.
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
          personal data, including encrypted transport, hashed passwords,
          encryption of stored payment API keys, and access controls. No system
          is perfectly secure, so we cannot guarantee absolute security.
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
