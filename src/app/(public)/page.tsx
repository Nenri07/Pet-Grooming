import {
  Hero,
  ProblemStrip,
  OrderRadarShowcase,
  BentoFeatures,
  FillMyDayEta,
  PetCardShowcase,
  StatsMarquee,
  Testimonial,
  Comparison,
  PricingCTA,
  Faq,
  FinalCTA,
} from '@/components/marketing';

/**
 * PawPort marketing landing page (Section 7). Composed in the exact Section 7
 * order:
 *   1. Hero
 *   2. ProblemStrip
 *   3. OrderRadarShowcase (#order-radar — the centrepiece)
 *   4. BentoFeatures (#features)
 *   5. FillMyDayEta
 *   6. PetCardShowcase
 *   7. StatsMarquee (services marquee + founding fallback)
 *   8. Testimonial (data-driven; renders null while empty)
 *   9. Comparison
 *   10. PricingCTA (#pricing)
 *   11. Faq
 *   12. FinalCTA
 *
 * URL stays "/" via the (public) route group; the shared header/footer come
 * from the group layout.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <ProblemStrip />
      <OrderRadarShowcase />
      <BentoFeatures />
      <FillMyDayEta />
      <PetCardShowcase />
      <StatsMarquee />
      <Testimonial />
      <Comparison />
      <PricingCTA />
      <Faq />
      <FinalCTA />
    </>
  );
}
