# Implementation Plan: Aesthetic Redesign

## Overview

This plan layers a motion-rich visual redesign and a public marketing landing page onto the existing PawPort application (Next.js 14 App Router, TypeScript, Tailwind, DaisyUI, Framer Motion) without regressing any existing feature. Work is delivered incrementally in six stages: (1) the central theme file + Tailwind/DaisyUI refactor, (2) the reusable animation utilities layer, (3) the public marketing shell + landing relocation, (4) the marketing components, (5) accessibility/performance polish, and (6) verification checkpoints.

Every task is additive. Token names are preserved so existing DaisyUI/Tailwind markup keeps resolving. Each task references the exact files named in the design and the specific requirement clauses it satisfies. Optional sub-tasks marked with `*` cover property-style and verification tests derived from correctness properties P1–P8.

## Tasks

- [x] 1. Central theme file and Styling_Layer refactor
  - [x] 1.1 Create the central theme token file `src/styles/theme.css`
    - Declare all color tokens as HSL channel triples (`H S% L%`) in a light block keyed to `:root, [data-theme='pawport_light']` and a matching dark override block keyed to `[data-theme='pawport_dark']`
    - Preserve existing token names: `primary`, `secondary`, `accent`, `neutral`, `base-100`/`200`/`300`, `base-content`, all `-content` pairs, `info`/`success`/`warning`/`error`
    - Add marketing-only tokens (`--color-cream`, `--color-sand`, `--color-ink`) plus radii, shadow, spacing, typography, and motion tokens as defined in the design
    - Add a `@media (prefers-reduced-motion: reduce)` block that collapses `--dur-reveal` to ~0s
    - Ensure every token in the light block has a corresponding dark-block value with no unmatched tokens
    - _Requirements: 1.1, 1.4, 2.1, 2.5, 6.1_

  - [x] 1.2 Import `theme.css` first in `src/app/globals.css`
    - Add `@import '../styles/theme.css';` above the `@tailwind` layer directives so the vars exist before Tailwind/DaisyUI read them
    - Keep existing base body/html rules; wire `font-family: var(--font-sans)`
    - _Requirements: 1.1, 1.2_

  - [x] 1.3 Refactor `tailwind.config.ts` to reference theme vars
    - Express every color in `theme.extend.colors` via the `hsl(var(--color-*) / <alpha-value>)` helper so alpha modifiers (`bg-primary/20`) resolve
    - Add marketing color tokens (`cream`, `sand`, `ink`) and extend `fontFamily`, `fontSize` (`hero`, `h2`), `borderRadius` (keep `2xl` alias valid), `boxShadow` (`card`, `soft`, `glow`), `spacing` (`section`, `gutter`), and `transitionTimingFunction` (`out-expo`) to read the vars
    - Preserve all existing token names so current markup keeps resolving
    - _Requirements: 1.2, 1.5, 8.5_

  - [x] 1.4 Refactor both DaisyUI themes to reference theme vars
    - Update `daisyui.themes` `pawport_light` and `pawport_dark` so every color key and every explicit `-content` key maps to `hsl(var(--color-*))`, and `--rounded-box`/`--rounded-btn` map to the radius vars
    - Keep `darkTheme: 'pawport_dark'`; retain `base`, `styled`, `utils` settings
    - _Requirements: 1.2, 2.1, 8.5_

  - [ ]* 1.5 Write property/verification test for single-source-of-truth and theme coherence
    - **Property P1: Single source of truth** — assert every DaisyUI/Tailwind color key in `tailwind.config.ts` resolves through a `var(--color-*)` reference and never a literal hex value
    - **Property P2: Theme swap coherence** — assert the `pawport_light` and `pawport_dark` blocks in `theme.css` define matching token sets with no unmatched tokens in either block
    - **Validates: Requirements 1.2, 2.1**

  - [x] 1.6 Verify existing surfaces recolor from the central file and light/dark still toggles
    - Manually confirm portal, auth, booking, and pet-card pages still render and pick up colors from `theme.css` with no component edits
    - Confirm the existing `next-themes` toggle still swaps `data-theme` between `pawport_light`/`pawport_dark` and recolors both surfaces
    - _Requirements: 1.3, 2.2, 2.3, 2.4, 8.5_

- [x] 2. Animation utilities layer (`src/lib/animation/`)
  - [x] 2.1 Install GSAP
    - Run `npm install gsap` (bundles `gsap/ScrollTrigger`); confirm `gsap ^3.12.x` lands in `package.json`
    - _Requirements: 5.2_

  - [x] 2.2 Implement `useReducedMotion.ts` (SSR-safe)
    - Return `false` during SSR/first paint; resolve the real `prefers-reduced-motion` value in a `useEffect`, guarded by `typeof window !== 'undefined'`; subscribe to live `change` events
    - _Requirements: 6.5, 7.6_

  - [x] 2.3 Implement `AnimationProvider.tsx` (client-only, registers ScrollTrigger once)
    - Dynamically `import('gsap/ScrollTrigger')` inside a `useEffect`, register the plugin exactly once, expose a `ready` flag via context; do no server-side work
    - _Requirements: 7.5, 7.6_

  - [x] 2.4 Implement `useGsapContext.ts` (scoped context with cleanup)
    - Run `setup` inside `gsap.context(..., scope)` in a `useLayoutEffect`, no-op until `ready`, pass `reduced` into setup, and call `ctx.revert()` on unmount/deps change
    - _Requirements: 5.5, 6.1, 7.4_

  - [x] 2.5 Implement `variants.ts` (Framer library)
    - Export `fadeUp`, `fadeIn`, `staggerParent`, `heroLine`, `micro`, and `reducedVariants` (instant, opacity-only) using the shared ease-out-expo curve
    - _Requirements: 5.1, 6.2_

  - [x] 2.6 Implement `ScrollReveal.tsx` (Framer, owns opacity/transform reveals)
    - Use `useInView` (once) to toggle Framer variants; swap to `reducedVariants` when reduced motion is active so reveals appear instantly at full opacity
    - Framer owns opacity+y here; do not attach GSAP to the same node
    - _Requirements: 5.1, 6.2, 6.4_

  - [x] 2.7 Implement `Parallax.tsx` (GSAP, owns scroll-scrubbed transform)
    - Use `useGsapContext` to scrub `yPercent` on a dedicated inner layer element; return early (static) under reduced motion; never share a node with a Framer transform
    - _Requirements: 5.2, 5.4, 5.5, 6.1_

  - [x] 2.8 Create the `index.ts` barrel for `src/lib/animation/`
    - Re-export `useReducedMotion`, `AnimationProvider`/`useAnimationReady`, `useGsapContext`, all variants, `ScrollReveal`, and `Parallax`
    - _Requirements: 5.1, 5.2_

  - [x] 2.9 Wire `AnimationProvider` into the root layout
    - In `src/app/layout.tsx`, nest `AnimationProvider` inside `ThemeProvider` (around `children` + `ToastProvider`); keep all existing providers unchanged
    - _Requirements: 7.5, 8.3_

  - [ ]* 2.10 Write verification tests for reduced motion, SSR safety, and cleanup
    - **Property P4: Reduced motion** — assert `reducedVariants` is opacity-only with zero duration and that `Parallax` produces no scrubbed tween when `reduced` is true
    - **Property P5: SSR safety** — assert `useReducedMotion` returns `false` without touching `window`/`matchMedia` on the server render path
    - **Property P6: Cleanup** — assert `useGsapContext` calls `ctx.revert()` on unmount
    - **Validates: Requirements 6.2, 7.4, 7.6**

- [x] 3. Public marketing shell and route relocation
  - [x] 3.1 Create the `(public)` marketing shell layout
    - Add `src/app/(public)/layout.tsx` rendering `MarketingHeader` + `main` (`flex-1`) + `MarketingFooter` on a `bg-base-100 text-base-content` column
    - _Requirements: 3.2, 3.3_

  - [x] 3.2 Relocate the landing page into the `(public)` group
    - Move `src/app/page.tsx` to `src/app/(public)/page.tsx` (URL stays `/`) and delete the old root page so there is no duplicate route
    - Confirm `/book/[groomerSlug]` and `/pet-card/[cardId]` render within the shared shell
    - _Requirements: 3.1, 3.3, 8.4_

- [x] 4. Marketing components (`src/components/marketing/`)
  - [x] 4.1 Create `heroMedia.ts` config module
    - Export the `HeroMedia` interface and a `heroMedia` config with optional `poster`, `videoWebm`, `videoMp4`, and decorative `layers`; paths are placeholders that degrade gracefully when absent
    - _Requirements: 4.1, 4.8_

  - [x] 4.2 Implement `Hero.tsx` (video → poster → gradient fallback, LCP-safe)
    - Render layered background: always-present CSS gradient (layer 0), `next/image` poster with `priority` as LCP candidate (layer 1), deferred `preload="none"` `<video>` that fades in on `onCanPlay` (layer 2)
    - Gate video on `hasVideo && !reduced`; reserve fixed `min-h-[92vh]` for CLS 0; Framer owns headline reveal + CTA micro-interaction; primary CTA links to `/register`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.3, 7.1, 7.2, 7.3_

  - [ ]* 4.3 Write property test for hero fallback resolution
    - **Property P3: Graceful hero** — a pure resolver over `{video?, poster?, reduced?}` yields: no video ∧ no poster → gradient; poster ∧ no video → poster; video ∧ ¬reduced → video-over-poster; reduced → poster-or-gradient (no video)
    - **Validates: Requirements 4.4, 4.5, 4.6, 6.3**

  - [x] 4.4 Implement `MarketingHeader.tsx` (GSAP scroll toggle)
    - Fixed header that toggles an `is-scrolled` class via GSAP `ScrollTrigger` (bg/height/shadow); Framer is not used for these properties; reduced-motion users get the class toggled without a tween
    - Keep nav links (Features, Pricing, Log in) as `>= 44px` touch targets
    - _Requirements: 3.6, 5.2, 5.3, 9.3_

  - [x] 4.5 Implement `MarketingFooter.tsx` (with theme toggle)
    - Footer with nav/social links and a theme toggle that calls `useTheme()` (same mechanism as the portal toggle)
    - _Requirements: 2.4, 3.2_

  - [x] 4.6 Implement `SectionHeading.tsx`
    - Shared eyebrow + title + subtitle, reveal-animated via `ScrollReveal`
    - _Requirements: 3.1, 5.1_

  - [x] 4.7 Implement `FeatureSection.tsx` (ScrollReveal)
    - Alternating text/visual blocks; Framer `fadeUp`/stagger reveals copy; any parallax targets a dedicated image-layer node only
    - _Requirements: 3.1, 5.1, 5.4_

  - [x] 4.8 Implement `ParallaxShowcase.tsx` (Parallax)
    - Layered scrubbed imagery using the `Parallax` component; all transforms owned by GSAP on dedicated layers
    - _Requirements: 3.1, 5.2, 5.4_

  - [x] 4.9 Implement `StatsMarquee.tsx` (count-up + GSAP marquee)
    - Framer in-view number count-up; GSAP owns the infinite marquee x-loop (and optional pin); static final state under reduced motion
    - _Requirements: 3.1, 5.1, 5.2, 6.4_

  - [x] 4.10 Implement `Testimonial.tsx`
    - Testimonial card(s) with Framer in-view reveal / quote stagger; no GSAP
    - _Requirements: 3.1, 5.1_

  - [x] 4.11 Implement `PricingCTA.tsx` (primary CTA → /register)
    - Pricing/plan cards with a primary conversion CTA that navigates to `/register`; card stagger + CTA micro-interaction via Framer; CTA `>= 44px`
    - _Requirements: 3.4, 3.5, 5.1, 9.3_

  - [x] 4.12 Create the `index.ts` barrel and compose the landing page
    - Barrel-export all marketing components; compose `src/app/(public)/page.tsx` in order: Hero → FeatureSection(s) → ParallaxShowcase → StatsMarquee → Testimonial → PricingCTA, wiring things together with no orphaned components
    - _Requirements: 3.1, 3.2_

  - [ ]* 4.13 Write property/verification test for animation ownership
    - **Property P8: Property ownership** — assert `ScrollReveal` (Framer) and `Parallax` (GSAP) never target the same node/property; check `Parallax` scrubs a dedicated inner layer while Framer reveals wrap outer content
    - **Validates: Requirements 5.3, 5.4**

- [x] 5. Accessibility, performance, and polish
  - [x] 5.1 Verify and refine reduced-motion behavior across all sections
    - Confirm parallax/marquee/pin are disabled and reveals are instant under reduced motion, with 100% of content visible at full opacity; hero skips video and shows poster/gradient
    - _Requirements: 5.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.2 Verify hero performance (LCP not blocked, CLS 0)
    - Confirm the poster `<Image priority>` is the LCP candidate, video is deferred and fades in without blocking LCP, and the hero reserves layout so CLS is 0; a failed video retains poster/gradient with no unhandled error
    - _Requirements: 7.1, 7.2, 7.3, 7.7_

  - [x] 5.3 Verify responsive layout and 44px touch targets
    - Confirm mobile-first breakpoints (≤767 mobile, 768–1023 tablet, ≥1024 desktop) with no horizontal scroll and every interactive control sized ≥44×44px
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 6. Verification checkpoints
  - [x] 6.1 Checkpoint — type-check and static verification
    - Run `npx tsc --noEmit` and `npm run lint`; ensure zero unresolved-class or missing-token errors. Ensure all checks pass, ask the user if questions arise.
    - _Requirements: 1.6, 8.5_

  - [x] 6.2 Checkpoint — production build and tests
    - Run `npm run build` and `npm test`, confirming no regressions to auth, booking, portal, or pet-card. Note: the project lives under OneDrive, where the `.next` rename can flake — if the build errors on a `.next` rename, clear `.next` and retry (environmental, not a code fault). Ensure all tests pass, ask the user if questions arise.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

## Notes

- Tasks marked with `*` are optional test tasks (property-style and verification) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Property tests use the already-installed `vitest` + `fast-check` toolchain and map directly to the design's correctness properties P1–P8.
- Each task references specific requirement clauses for traceability.
- All work is additive: token names are preserved, existing providers/transitions are untouched, and hero media degrades gracefully when assets are absent.
- Checkpoints ensure incremental validation without deploying, gathering metrics, or running manual end-to-end flows.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.2"] },
    { "id": 2, "tasks": ["1.5", "1.6", "2.3", "2.5"] },
    { "id": 3, "tasks": ["2.4", "2.6"] },
    { "id": 4, "tasks": ["2.7", "2.8", "2.9", "2.10"] },
    { "id": 5, "tasks": ["3.1", "4.2", "4.4", "4.5", "4.6"] },
    { "id": 6, "tasks": ["3.2", "4.3", "4.7", "4.8", "4.9", "4.10", "4.11"] },
    { "id": 7, "tasks": ["4.12"] },
    { "id": 8, "tasks": ["4.13", "5.1", "5.2", "5.3"] },
    { "id": 9, "tasks": ["6.1"] },
    { "id": 10, "tasks": ["6.2"] }
  ]
}
```
