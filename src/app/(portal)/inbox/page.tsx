import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { authOptions } from '@/lib/auth/config';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Inbox (`/inbox`) — stub for the two-way SMS threads view.
 *
 * Two-way texting (client threads, quick replies, templates) is built in
 * Phase 4 (Master Spec §12). This page currently renders a "coming soon" empty
 * state so the destination exists in the nav (bottom tab bar + sidebar) and is
 * gated by portal auth like every other (portal) route.
 *
 * _Master Spec: §8 (nav), §12 (Phase 4 build)._
 */
export default async function InboxPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-base-content sm:text-3xl">
          Inbox
        </h1>
        <p className="mt-1 text-base-content/60">
          Text your clients from one place.
        </p>
      </header>

      <EmptyState
        icon={<MessageSquare className="h-10 w-10" aria-hidden="true" />}
        title="Two-way texting is coming soon"
        description="Client SMS conversations, quick replies and reminder threads land here in an upcoming release. For now, appointment confirmations still go out automatically."
      />
    </div>
  );
}
