import {
  Hero,
  FeatureSection,
  ParallaxShowcase,
  StatsMarquee,
  Testimonial,
  PricingCTA,
} from '@/components/marketing';

/**
 * PawPort marketing landing page. Composed from the marketing component
 * library in order: Hero -> FeatureSection(s) -> ParallaxShowcase ->
 * StatsMarquee -> Testimonial -> PricingCTA. URL stays "/" (route group).
 */
export default function Home() {
  return (
    <>
      <Hero />

      <FeatureSection
        id="features"
        eyebrow="Booking, simplified"
        title="Schedule a groom in seconds"
        body="Your clients pick a service, choose a time that fits your route, and confirm — all from their phone. No back-and-forth texts, no double bookings."
        features={[
          'Real-time availability tied to your calendar',
          'Automatic reminders that cut no-shows',
          'Deposits and pricing set upfront',
        ]}
      />

      <FeatureSection
        eyebrow="Every pet, remembered"
        title="Digital pet cards that travel with you"
        body="Coat type, temperament, past styles, and notes live in one place, so every visit feels personal — even the first one."
        features={[
          'Breed and coat profiles',
          'Grooming history at a glance',
          'Shareable pet cards for owners',
        ]}
        reversed
      />

      <FeatureSection
        eyebrow="Grow with confidence"
        title="Insights that keep your route full"
        body="See your busiest days, repeat clients, and revenue trends so you can focus your time where it matters most."
        features={[
          'Revenue and booking analytics',
          'Repeat-client tracking',
          'Smart availability across your service area',
        ]}
      />

      <ParallaxShowcase />

      <StatsMarquee />

      <Testimonial />

      <PricingCTA />
    </>
  );
}
