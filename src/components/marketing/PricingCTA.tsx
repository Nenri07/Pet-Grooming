'use client';
import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { fadeUp, staggerParent, micro } from '@/lib/animation';
import { SectionHeading } from './SectionHeading';

type Plan = {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  featured?: boolean;
};

const plans: Plan[] = [
  {
    name: 'Starter',
    price: '$0',
    cadence: '/mo',
    description: 'For groomers just getting mobile.',
    features: ['Up to 20 bookings/mo', 'Client & pet profiles', 'Email reminders'],
  },
  {
    name: 'Pro',
    price: '$29',
    cadence: '/mo',
    description: 'Everything you need to grow a route.',
    features: [
      'Unlimited bookings',
      'Smart availability & routing',
      'Digital pet cards',
      'Analytics dashboard',
    ],
    featured: true,
  },
  {
    name: 'Team',
    price: '$79',
    cadence: '/mo',
    description: 'For multi-groomer operations.',
    features: ['Everything in Pro', 'Multiple groomers', 'Priority support'],
  },
];

/**
 * Pricing/plan cards with a primary conversion CTA that navigates to /register.
 * Framer owns the card stagger and CTA micro-interaction. CTAs are >=44px.
 */
export function PricingCTA() {
  return (
    <section id="pricing" className="bg-base-200 px-gutter py-section">
      <SectionHeading
        eyebrow="Simple pricing"
        title="Plans that grow with your grooming business"
        subtitle="Start free. Upgrade when you're ready. Cancel anytime."
      />

      <motion.div
        className="mx-auto mt-16 grid max-w-6xl gap-6 md:grid-cols-3"
        variants={staggerParent(0.12)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
      >
        {plans.map((plan) => (
          <motion.div
            key={plan.name}
            variants={fadeUp}
            className={`flex flex-col rounded-box p-8 shadow-card ${
              plan.featured
                ? 'bg-base-100 shadow-glow ring-2 ring-primary'
                : 'bg-base-100'
            }`}
          >
            {plan.featured && (
              <span className="mb-4 w-fit rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                Most popular
              </span>
            )}
            <h3 className="text-xl font-display font-bold text-base-content">
              {plan.name}
            </h3>
            <p className="mt-2 text-sm text-base-content/60">{plan.description}</p>
            <div className="mt-6 flex items-end gap-1">
              <span className="text-h2 font-display font-bold text-base-content">
                {plan.price}
              </span>
              <span className="mb-1 text-base-content/60">{plan.cadence}</span>
            </div>
            <ul className="mt-6 flex-1 space-y-3">
              {plan.features.map((feat) => (
                <li key={feat} className="flex items-start gap-3">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-base-content/80">{feat}</span>
                </li>
              ))}
            </ul>
            <motion.div whileHover={micro.hover} whileTap={micro.tap} className="mt-8">
              <Link
                href="/register"
                className={`btn min-h-[44px] w-full rounded-btn ${
                  plan.featured ? 'btn-primary' : 'btn-outline btn-primary'
                }`}
              >
                Get started
              </Link>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
