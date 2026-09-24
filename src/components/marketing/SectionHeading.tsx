'use client';
import * as React from 'react';
import { ScrollReveal } from '@/lib/animation';

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
  className?: string;
};

/**
 * Shared section heading: eyebrow + title + subtitle, reveal-animated via
 * ScrollReveal (Framer owns the opacity/transform reveal here).
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
  className = '',
}: Props) {
  const alignment = align === 'center' ? 'mx-auto text-center' : 'text-left';

  return (
    <ScrollReveal className={`max-w-2xl ${alignment} ${className}`}>
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-accent">
          {eyebrow}
        </p>
      )}
      <h2 className="text-h2 font-display font-bold text-base-content">{title}</h2>
      {subtitle && (
        <p className="mt-4 text-lg text-base-content/70">{subtitle}</p>
      )}
    </ScrollReveal>
  );
}
