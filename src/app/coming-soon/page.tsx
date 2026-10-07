import type { Metadata } from 'next';
import { ComingSoonClient } from './ComingSoonClient';

/**
 * Coming-soon / pre-launch landing (\`/coming-soon\`).
 *
 * When \`COMING_SOON\` is enabled the middleware redirects ALL public traffic
 * here (with a \`?preview=\` bypass for the team). It is a self-contained,
 * full-screen animated page: Pawxis branding, an animated headline, a live
 * countdown to launch, and an early-access email capture backed by
 * \`joinWaitlist\`. It renders its own shell (no marketing nav/footer).
 *
 * Launch target is a FIXED instant so the countdown is a true countdown
 * (not reset per load): Sunday, Oct 11, 2026, 12:00 PM. Overridable via the
 * \`NEXT_PUBLIC_LAUNCH_AT\` env (ISO 8601) without a code change.
 */
export const metadata: Metadata = {
  title: 'Pawxis — Launching soon',
  description:
    'The booking, routing and no-show shield built for solo mobile pet groomers. Launching in a few days — join the early-access list.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Default launch instant: Sunday, Oct 11, 2026, 12:00 PM (local offset +05:00, Asia/Karachi). */
const DEFAULT_LAUNCH_AT = '2026-10-11T12:00:00+05:00';

export default function ComingSoonPage() {
  const launchAtRaw = process.env.NEXT_PUBLIC_LAUNCH_AT?.trim() || DEFAULT_LAUNCH_AT;
  // Validate; fall back to the default if the env value is unparseable.
  const launchMs = Number.isNaN(new Date(launchAtRaw).getTime())
    ? new Date(DEFAULT_LAUNCH_AT).getTime()
    : new Date(launchAtRaw).getTime();

  return <ComingSoonClient launchAtMs={launchMs} />;
}
