import * as React from 'react';
import { PortalNav } from '@/components/portal/PortalNav';

/**
 * (portal) route group layout.
 *
 * The authenticated Groomer_Portal shell shared by every portal page
 * (dashboard, clients, appointments, services, availability, analytics,
 * settings). Renders a persistent sidebar on tablet/desktop and a hamburger
 * drawer on mobile via {@link PortalNav}, with the theme toggle living in the
 * nav. Content sits in a scrollable main region beside the sidebar.
 *
 * Mobile-first: below 768px the nav is a top bar + fixed bottom tab bar; the
 * collapsible sidebar appears at md+ (768px). Main content adds bottom padding
 * on mobile so it is never hidden behind the fixed bottom tab bar (plus the
 * safe-area inset), and clears the fixed desktop search strip on md+. All
 * interactive elements meet the 44x44px touch-target minimum on mobile.
 *
 * _Master Spec: §8. Requirements: 18.2, 19.1, 19.2_
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-base-200 md:flex-row">
      <PortalNav />
      <main className="min-w-0 flex-1 p-4 pb-[calc(72px+env(safe-area-inset-bottom))] sm:p-6 md:pb-6 md:pt-16 lg:p-8 lg:pt-16">
        {children}
      </main>
    </div>
  );
}
