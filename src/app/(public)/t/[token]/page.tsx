import type { Metadata } from 'next';
import { resolveTracker } from '@/lib/tracking';
import { TrackerView } from '@/components/public/TrackerView';

/**
 * Public "van is on the way" tracker — /t/[token] (Master Spec §11.2).
 *
 * Server component resolves the initial tracker payload (branding, pet, ETA);
 * the client {@link TrackerView} polls `/api/track/{token}` every 10s to keep
 * the ETA fresh. Tracker pages are noindex — private, expiring links.
 *
 * _Master Spec: §11.2_
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your groomer is on the way',
  robots: { index: false, follow: false },
};

export default async function TrackerPage({ params }: { params: { token: string } }) {
  const data = await resolveTracker(params.token);

  return (
    <main className="min-h-screen bg-base-200 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        {data ? (
          <TrackerView
            token={params.token}
            initial={{
              business: data.business,
              logoUrl: data.logoUrl,
              petName: data.petName,
              groomerPhone: data.groomerPhone,
              van: data.van,
              etaMinutes: data.etaMinutes,
              ended: data.ended,
            }}
          />
        ) : (
          <div className="rounded-box border border-base-content/10 bg-base-100 p-8 text-center shadow-card">
            <h1 className="text-2xl font-bold text-base-content">Trip not found</h1>
            <p className="mt-3 text-base-content/70">
              This tracking link has expired or the trip has ended.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
