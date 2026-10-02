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
 * /cookies — Cookie Policy. Static server component; indexable.
 */
export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'How Pawxis uses essential cookies and local storage, and what we do not track.',
  alternates: { canonical: '/cookies' },
  robots: { index: true, follow: true },
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      intro="This policy describes the cookies and local storage Pawxis uses and why."
    >
      <Section heading="1. Overview">
        <P>
          Pawxis uses only what it needs to work. We rely on strictly necessary
          cookies to run authenticated sessions and keep them secure, plus your
          browser&rsquo;s local storage for a small set of preferences. We do{' '}
          <strong>not</strong> use advertising cookies or cross-site tracking.
        </P>
      </Section>

      <Section heading="2. Essential session cookies">
        <P>
          When you sign in, we set cookies that keep you authenticated and protect
          your session (for example against cross-site request forgery). These are
          required for the Service to function; disabling them will prevent you
          from logging in or using the portal.
        </P>
      </Section>

      <Section heading="3. Local storage for preferences">
        <P>
          We use your browser&rsquo;s local storage to remember your selected
          theme so the interface looks the same on your next visit. This stays on
          your device and is not used to track you across other sites.
        </P>
      </Section>

      <Section heading="4. What we do not use">
        <UL
          items={[
            'No advertising or marketing cookies.',
            'No cross-site or third-party tracking cookies.',
            'No selling of browsing data.',
          ]}
        />
      </Section>

      <Section heading="5. Third-party processing">
        <P>
          Some providers we use to deliver the Service — such as Stripe for
          payments — may set their own cookies when you interact with their
          components (for example a checkout). Those cookies are governed by the
          respective provider&rsquo;s policies.
        </P>
      </Section>

      <Section heading="6. Managing cookies">
        <P>
          You can clear or block cookies and local storage through your
          browser&rsquo;s settings. Because our cookies are essential, blocking
          them will limit or break sign-in and other core features.
        </P>
      </Section>

      <Section heading="7. Changes and contact">
        <P>
          We may update this policy and will revise the effective date above when
          we do. Questions can be sent to <Placeholder>{PH.company}</Placeholder>{' '}
          at <Placeholder>{PH.email}</Placeholder>. See also our{' '}
          <a href="/privacy">Privacy Policy</a>.
        </P>
      </Section>
    </LegalPage>
  );
}
