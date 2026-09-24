'use client';
import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { staggerParent, fadeUp, reducedVariants, micro, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';
import { landing } from '@/content/landing';

/**
 * Pricing (Section 7.10) — Solo / Pro cards with a monthly/annual toggle
 * (annual = 2 months free) and a founding-member banner. Every CTA points at
 * /register.
 *
 * Framer owns the card stagger reveal and the CTA hover/tap micro-interaction.
 * The toggle is plain React state. Cards carry `reveal-init` so they are
 * visible with JS off / under reduced motion; the toggle still defaults to a
 * fully readable state (monthly).
 */

type Cycle = 'monthly' | 'annual';

export function PricingCTA() {
  const reduced = useReducedMotion();
  const item = reduced ? reducedVariants : fadeUp;
  const [cycle, setCycle] = React.useState<Cycle>('monthly');
  const { pricing, founding } = landing;

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow="Simple pricing"
          title="One plan per van. No surprises."
          subtitle={pricing.annualNote}
        />

        {/* Founding-member banner */}
        <div className="mx-auto mt-8 max-w-2xl rounded-box border border-primary/20 bg-primary/5 px-6 py-4 text-center">
          <p className="text-sm text-base-content">
            <span className="font-semibold text-primary">
              First {founding.spots} groomers:
            </span>{' '}
            Solo ${founding.soloMonth} / Pro ${founding.proMonth}, locked for
            life.
          </p>
        </div>

        {/* Billing cycle toggle */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <span
            className={
              cycle === 'monthly'
                ? 'text-sm font-semibold text-base-content'
                : 'text-sm text-base-content/60'
            }
          >
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={cycle === 'annual'}
            aria-label="Toggle annual billing"
            onClick={() => setCycle((c) => (c === 'monthly' ? 'annual' : 'monthly'))}
            className="relative flex h-7 min-h-[44px] w-14 items-center rounded-full bg-base-300 px-1"
          >
            <span
              className="h-5 w-5 rounded-full bg-primary transition-transform duration-200"
              style={{
                transform: cycle === 'annual' ? 'translateX(1.75rem)' : 'translateX(0)',
              }}
            />
          </button>
          <span
            className={
              cycle === 'annual'
                ? 'text-sm font-semibold text-base-content'
                : 'text-sm text-base-content/60'
            }
          >
            Annual{' '}
            <span className="text-accent">(2 months free)</span>
          </span>
        </div>

        {/* Plan cards */}
        <motion.div
          className="mt-12 grid gap-6 md:grid-cols-2 md:mx-auto md:max-w-3xl"
          variants={staggerParent(0.12)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {pricing.plans.map((plan) => {
            const price = cycle === 'monthly' ? plan.monthly : plan.annual;
            const unit = cycle === 'monthly' ? '/mo' : '/yr';
            return (
              <motion.div
                key={plan.name}
                variants={item}
                className={[
                  'reveal-init flex flex-col rounded-box border p-8 shadow-card',
                  plan.featured
                    ? 'border-primary/40 bg-base-100 shadow-glow'
                    : 'border-base-content/10 bg-base-200',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-bold text-base-content">
                    {plan.name}
                  </h3>
                  {plan.featured && (
                    <span className="rounded-badge bg-primary px-3 py-1 text-xs font-semibold text-primary-content">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-base-content/70">{plan.tagline}</p>

                <p className="mt-6">
                  <span className="font-display text-4xl font-bold text-base-content tabular-nums">
                    ${price}
                  </span>
                  <span className="text-base-content/60">{unit}</span>
                </p>

                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-base-content/80">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <motion.div
                  className="mt-8"
                  whileHover={reduced ? undefined : micro.hover}
                  whileTap={micro.tap}
                >
                  <Link
                    href={plan.cta.href}
                    className={[
                      'btn min-h-[44px] w-full',
                      plan.featured ? 'btn-primary shadow-glow' : 'btn-outline',
                    ].join(' ')}
                  >
                    {plan.cta.label}
                  </Link>
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

export default PricingCTA;
