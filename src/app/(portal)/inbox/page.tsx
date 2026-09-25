import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { loadInboxThreads } from '@/actions/sms';
import { isSmsConfigured } from '@/lib/sms/provider';
import { InboxView } from '@/components/portal/InboxView';

/**
 * Inbox (`/inbox`) — two-way SMS threads (Master Spec §12, §8).
 *
 * Server-loads the authed groomer's {@link SmsMessage} threads grouped by
 * client and renders the interactive {@link InboxView}. When Twilio is
 * unconfigured the view drops into a clearly-labelled read-only state (logged
 * messages still render; replies + quick actions disabled), so the destination
 * works with or without credentials. Auth-scoped like every (portal) route.
 *
 * _Master Spec: §12_
 */
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }

  const smsConfigured = isSmsConfigured();
  const result = await loadInboxThreads();
  const threads = result.ok ? result.threads : [];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-base-content sm:text-3xl">Inbox</h1>
        <p className="mt-1 text-base-content/60">Text your clients from one place.</p>
      </header>

      {!smsConfigured && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-base-content/80">
          <span className="font-medium">SMS not configured.</span> Messages are logged here, but
          sending is disabled until Twilio credentials are added. This view is read-only.
        </div>
      )}

      {!result.ok && (
        <div className="mb-4 rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {result.error}
        </div>
      )}

      <InboxView threads={threads} smsConfigured={smsConfigured} />
    </div>
  );
}
