import * as React from 'react';

/**
 * Small "Pro" tag for marketing copy that needs the Pro plan. Screen readers
 * hear "Pro plan". Shared by BentoFeatures, Comparison and the for-groomers
 * WhatYouGet grid so the markup stays identical everywhere.
 */
export function ProPill() {
  return (
    <span className="rounded-badge bg-primary/10 px-2 py-0.5 font-sans text-xs font-semibold text-primary">
      Pro<span className="sr-only"> plan</span>
    </span>
  );
}

export default ProPill;
