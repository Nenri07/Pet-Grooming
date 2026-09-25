'use client';
import * as React from 'react';
import { motion, useInView } from 'framer-motion';
import {
  Globe,
  CalendarCheck,
  MessageSquare,
  IdCard,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useReducedMotion } from '@/lib/animation';
import { SectionHeading } from '@/components/marketing/SectionHeading';
import { forGroomers, type BundleIcon } from '@/content/for-groomers';

/**
 * BundleValue — the "one bundle instead of 3-4 tools" visual.
 *
 * Left: a stack of separate tool cards (website builder, booking tool, SMS
 * tool, pet records). When the section scrolls into view, Framer scales + fades
 * them slightly toward the centre and the single PawPort card scales up — a
 * light "merge" gesture. Under reduced motion (or JS off) it renders as a plain
 * static side-by-side with no transform, so the honest framing reads either way.
 *
 * Honest framing only: we contrast juggling several separate tools against one
 * bundle. No invented competitor prices.
 */

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

const ICONS: Partial<Record<BundleIcon, LucideIcon>> = {
  globe: Globe,
  'calendar-check': CalendarCheck,
  'message-square': MessageSquare,
  'id-card': IdCard,
};

export function BundleValue() {
  const reduced = useReducedMotion();
  const { bundleValue } = forGroomers;
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35, once: true });
  const animate = !reduced && inView;

  return (
    <section id="bundle-value" aria-labelledby="bundle-value-heading" className="bg-base-200">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow={bundleValue.eyebrow}
          title={bundleValue.title}
          subtitle={bundleValue.subtitle}
          titleId="bundle-value-heading"
        />

        <div
          ref={ref}
          className="mt-14 grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_auto_1fr]"
        >
          {/* ---- Left: the separate tools ---- */}
          <ul className="space-y-3">
            {bundleValue.replaces.map((tool, i) => {
              const Icon = ICONS[tool.icon] ?? Globe;
              return (
                <motion.li
                  key={tool.label}
                  initial={false}
                  animate={
                    animate
                      ? { opacity: 0.55, scale: 0.96, y: 0 }
                      : { opacity: 1, scale: 1, y: 0 }
                  }
                  transition={{ duration: 0.6, ease: easeOutExpo, delay: i * 0.06 }}
                  className="flex items-center gap-3 rounded-box border border-base-content/10 bg-base-100 px-4 py-3 shadow-soft"
                >
                  <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-base-300 text-base-content/70">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-base-content">
                      {tool.label}
                    </span>
                    <span className="block truncate text-xs text-base-content/60">
                      {tool.role}
                    </span>
                  </span>
                </motion.li>
              );
            })}
          </ul>

          {/* ---- Middle: the arrow ---- */}
          <div className="flex items-center justify-center">
            <motion.span
              aria-hidden
              initial={false}
              animate={animate ? { opacity: 1, scale: 1 } : { opacity: 0.6, scale: 1 }}
              transition={{ duration: 0.5, ease: easeOutExpo, delay: 0.3 }}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <ArrowRight className="h-6 w-6 rotate-90 lg:rotate-0" />
            </motion.span>
          </div>

          {/* ---- Right: the single merged PawPort card ---- */}
          <motion.div
            initial={false}
            animate={animate ? { scale: 1.03 } : { scale: 1 }}
            transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.2 }}
            className="rounded-box border border-primary/30 bg-base-100 p-6 shadow-glow"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="font-display text-xl font-bold text-primary">
                {bundleValue.bundleLabel}
              </span>
            </div>
            <p className="mt-3 text-sm text-base-content/70">{bundleValue.note}</p>

            <ul className="mt-5 grid grid-cols-2 gap-2">
              {bundleValue.replaces.map((tool) => (
                <li
                  key={tool.label}
                  className="rounded-xl bg-base-200 px-3 py-2 text-xs font-medium text-base-content/80"
                >
                  {tool.label}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default BundleValue;
