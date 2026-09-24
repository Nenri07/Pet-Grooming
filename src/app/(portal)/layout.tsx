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
 * Mobile-first: the nav collapses to a top bar + drawer below 768px, and the
 * sidebar appears at md+ (768px). All interactive elements meet the 44x44px
 * touch-target minimum on mobile.
 *
 * _Requirements: 18.2, 19.1, 19.2_
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-base-200 md:flex-row">
      <PortalNav />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
