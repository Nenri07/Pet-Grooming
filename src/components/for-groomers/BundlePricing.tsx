'use client';
import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { staggerParent, fadeUp, reducedVariants, micro, useReducedMotion } from '@/lib/animation';
import { SectionHeading } from '@/components/marketing/SectionHeading';
import { forGroomers } from '@/content/for-groomers';
import { PLANS, FOUNDING } from '@/lib/plans';

/**
 * BundlePricing — Solo / Pro cards with a monthly/annual toggle and a
 * founding-member banner, adapted from the landing PricingCTA.
 *
 * The REAL prices come from `@/lib/plans` (PLANS + FOUNDING) so the numbers
 * never drift from the billing catalog; only the copy (taglines, feature
 * bullets, CTA label) lives in the for-groomers content. Every CTA points at
 * /register. Framer owns the card stagger + CTA micro; the toggle is plain
 * React state and defaults to monthly (fully readable).
 */

type Cycle = 'monthly' | 'annual';

interface PlanView {
  name: string;
  tagline: string;
  features: string[];
  monthly: number;
  annual: number;
  featured: boolean;
}

export function BundlePricing() {
  const reduced = useReducedMotion();
  const variant = reduced ? reducedVariants : fadeUp;
  const [cycle, setCycle] = React.useState<Cycle>('monthly');
  const { pricing } = forGroomers;

  const plans: PlanView[] = [
    {
      name: pricing.solo.name,
      tagline: pricing.solo.tagline,
      features: pricing.solo.features,
      monthly: PLANS.solo.priceMonth,
      annual: PLANS.solo.priceYear,
      featured: false,
    },
    {
      name: pricing.pro.name,
      tagline: pricing.pro.tagline,
      features: pricing.pro.features,
      monthly: PLANS.pro.priceMonth,
      annual: PLANS.pro.priceYear,
      featured: true,
    },
  ];

  return (
    <section id="pricing" aria-labelledby="for-groomers-pricing-heading" className="bg-base-100">
      <div className="mx-auto max-w-6xl px-gutter py-section">
        <SectionHeading
          eyebrow={pricing.eyebrow}
          title={pricing.title}
          subtitle={pricing.subtitle}
          titleId="for-groomers-pricing-heading"
        />

        {/* Founding-member banner (real numbers from FOUNDING). */}
        <div className="mx-auto mt-8 max-w-2xl rounded-box border border-primary/20 bg-primary/5 px-6 py-4 text-center">
          <p className="text-sm text-base-content">
            <span className="font-semibold text-primary">First {FOUNDING.spots} groomers:</span>{' '}
            Solo ${FOUNDING.soloMonth} / Pro ${FOUNDING.proMonth}, locked for life.
          </p>
        </div>

        {/* Billing cycle toggle. */}
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
            Annual <span className="text-accent">(2 months free)</span>
          </span>
        </div>

        <p className="mt-3 text-center text-sm text-base-content/60">{pricing.annualNote}</p>

        {/* Plan cards. */}
        <motion.div
          className="mt-12 grid gap-6 md:mx-auto md:max-w-3xl md:grid-cols-2"
          variants={staggerParent(0.12)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {plans.map((plan) => {
            const price = cycle === 'monthly' ? plan.monthly : plan.annual;
            const unit = cycle === 'monthly' ? '/mo' : '/yr';
            return (
              <motion.div
                key={plan.name}
                variants={variant}
                className={[
                  'reveal-init flex flex-col rounded-box border p-8 shadow-card',
                  plan.featured
                    ? 'border-primary/40 bg-base-100 shadow-glow'
                    : 'border-base-content/10 bg-base-200',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-bold text-base-content">{plan.name}</h3>
                  {plan.featured && (
                    <span className="rounded-badge bg-primary px-3 py-1 text-xs font-semibold text-primary-content">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-base-content/70">{plan.tagline}</p>

                <p className="mt-6">
                  <span className="font-display text-4xl font-bold tabular-nums text-base-content">
                    ${price}
                  </span>
                  <span className="text-base-content/60">{unit}</span>
                </p>

                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-base-content/80">
                      <Check
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-success"
                        aria-hidden="true"
                      />
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
                    href={pricing.cta.href}
                    className={[
                      'btn min-h-[44px] w-full',
                      plan.featured ? 'btn-primary shadow-glow' : 'btn-outline',
                    ].join(' ')}
                  >
                    {pricing.cta.label}
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

export default BundlePricing;
