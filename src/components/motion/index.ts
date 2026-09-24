/**
 * Motion layer barrel (Section 6.2). All marketing/site motion primitives are
 * consumed from here. Ownership split:
 *   - Framer Motion: Reveal, Tilt, NumberTicker, PageTransition.
 *   - GSAP + ScrollTrigger: Marquee, Parallax, PinnedSection.
 *   - Lenis + provider wiring: MotionProvider.
 */
export { MotionProvider } from './MotionProvider';
export { Reveal } from './Reveal';
export { Marquee } from './Marquee';
export { Parallax } from './Parallax';
export { PinnedSection } from './PinnedSection';
export { Tilt } from './Tilt';
export { NumberTicker } from './NumberTicker';
export { PageTransition, stepTransition } from './PageTransition';
