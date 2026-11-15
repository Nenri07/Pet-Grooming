import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { landing } from '@/content/landing';

/**
 * ProblemStrip (Section 7.2): three pain points directly below the hero.
 * Copy comes from `landing.problems` (single source of truth).
 */
export function ProblemStrip() {
  return (
    <section aria-labelledby="problem-heading" className="border-b border-base-300 bg-base-100 py-10 md:py-12">
      <div className="mx-auto max-w-6xl px-6 md:px-10 lg:px-12">
        <h2 id="problem-heading" className="sr-only">
          The daily grind of a solo mobile groomer
        </h2>
        <ul className="grid gap-8 md:grid-cols-3">
          {landing.problems.map((p) => (
            <li key={p.title} className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-base-content/40" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="text-base font-medium text-base-content">{p.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-base-content/60">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ProblemStrip;
