import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Shared presentation shell for the templated legal pages (/terms, /privacy,
 * /cookies, /refunds, /acceptable-use).
 *
 * These are static server-rendered documents, so this component holds no
 * client state — it only provides consistent, theme-tokened typography and the
 * mandatory "this is a template, not legal advice" disclaimer that must appear
 * at the top of every legal page.
 *
 * Typography is hand-styled with DaisyUI theme tokens because the project does
 * not include @tailwindcss/typography. The `.legal-prose` rules below mirror a
 * `prose`-style rhythm (headings, paragraphs, lists, links) using semantic
 * tokens so every DaisyUI theme recolors it correctly and contrast stays
 * WCAG AA.
 */

export const LEGAL_PLACEHOLDERS = {
  company: '[COMPANY LEGAL NAME]',
  address: '[COMPANY ADDRESS]',
  email: '[CONTACT EMAIL]',
  jurisdiction: '[JURISDICTION]',
  effectiveDate: '[EFFECTIVE DATE]',
} as const;

type LegalPageProps = {
  /** Document title shown as the page <h1>. */
  title: string;
  /** Short one-line summary rendered under the title. */
  intro: string;
  /** The document body — use the exported Section/H2/P/UL helpers. */
  children: React.ReactNode;
};

export function LegalPage({ title, intro, children }: LegalPageProps) {
  return (
    <div className="mx-auto max-w-3xl px-gutter py-section">
      <header>
        <h1 className="font-display text-h2 font-bold text-base-content">
          {title}
        </h1>
        <p className="mt-4 text-lg text-base-content/70">{intro}</p>
        <p className="mt-6 text-sm font-medium text-base-content/60">
          Last updated: {LEGAL_PLACEHOLDERS.effectiveDate}
        </p>
      </header>

      <div
        role="note"
        className="mt-6 flex items-start gap-3 rounded-box border border-warning/30 bg-warning/10 p-4 text-sm text-base-content"
      >
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <p>
          <span className="font-semibold">Template notice.</span> This document
          is a template provided for convenience and is not legal advice. Review
          and adapt it with a qualified attorney before relying on it.
        </p>
      </div>

      <article className="legal-prose mt-10 text-base-content/80">
        {children}
      </article>
    </div>
  );
}

/** A document section: an <h2> heading plus its content, with top spacing. */
export function Section({
  id,
  heading,
  children,
}: {
  id?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-10 first:mt-0">
      <h2 className="font-display text-xl font-semibold text-base-content">
        {heading}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A body paragraph. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}

/** An unordered list of string/node items. */
export function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6 leading-relaxed marker:text-base-content/40">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Inline emphasis for placeholder tokens so they stand out for editors. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-base-200 px-1 font-mono text-[0.9em] text-base-content">
      {children}
    </span>
  );
}
