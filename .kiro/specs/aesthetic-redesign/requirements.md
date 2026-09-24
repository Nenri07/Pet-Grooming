# Requirements Document

## Introduction

The Aesthetic Redesign feature layers a modern, motion-rich visual redesign onto the existing PawPort application without regressing any existing functionality. It introduces two deliberately separated concerns: (1) a single central theme file that becomes the site-wide source of truth for visual design tokens, so that editing one file re-themes both the public marketing surface and the authenticated portal; and (2) a new public marketing landing page with a shared marketing shell and a reusable animation layer that combines Framer Motion (transitions, in-view reveals, micro-interactions) and GSAP with ScrollTrigger (scroll-scrubbed parallax, pinned sections, marquees).

These requirements are derived from the approved design document. They capture what the redesigned system must do while remaining implementation-agnostic in wording, and they stay consistent with the design decisions (D1–D7) and correctness properties (P1–P8) recorded in the design.

## Glossary

- **PawPort_Application**: The existing Next.js 14 App Router application (auth, booking flow, groomer portal, digital pet card) onto which the redesign is layered.
- **Theme_System**: The site-wide theming mechanism whose single source of truth is `src/styles/theme.css`, a file of CSS custom properties (design tokens) with a light block and a dark override block.
- **Theme_Token**: A named design value (for example `primary`, `base-100`, `accent`, radius, shadow, spacing, typography) resolved from a CSS custom property declared in the Theme_System.
- **Styling_Layer**: The Tailwind CSS configuration and DaisyUI custom themes (`pawport_light`, `pawport_dark`) that reference Theme_System variables via `var(--…)` rather than holding literal color values.
- **Theme_Controller**: The existing `next-themes` provider that sets the `data-theme` attribute on the root element to select light or dark presentation.
- **Marketing_Surface**: The public landing page at `/` and the shared public marketing shell (animated header and footer) under the `(public)` route group.
- **Portal_Surface**: The authenticated groomer portal pages and auth pages that inherit the central tokens but are not given scroll choreography.
- **Marketing_Shell**: The shared `(public)` layout providing a marketing header and footer around public routes.
- **Hero_Component**: The landing-page hero region that resolves a background from video, poster image, or CSS gradient.
- **Hero_Media_Config**: The configuration module (`heroMedia`) that declares optional poster and video source paths and optional decorative layers.
- **Motion_System**: The reusable animation utilities layer, comprising the Framer Motion utilities, the GSAP/ScrollTrigger utilities, and the reduced-motion guard.
- **Framer_Layer**: The Framer Motion portion of the Motion_System that owns route/page/step transitions, in-view reveals, and micro-interactions.
- **GSAP_Layer**: The GSAP with ScrollTrigger portion of the Motion_System that owns scroll-scrubbed parallax, pinned sections, and marquees.
- **Animation_Provider**: The client-only provider that registers ScrollTrigger exactly once and exposes a ready state.
- **Reduced_Motion_Preference**: The user setting expressed by the `prefers-reduced-motion: reduce` media query.
- **GSAP_Context**: A scoped GSAP context bound to a component element that automatically reverts (cleans up) its tweens and ScrollTriggers on unmount.
- **LCP**: Largest Contentful Paint, the performance metric used to describe the primary hero image loading behavior.
- **Touch_Target**: An interactive element sized so its minimum interactive dimension is at least 44 pixels.

## Requirements

### Requirement 1: Central Theme System as Single Source of Truth

**User Story:** As a developer maintaining PawPort, I want one central theme file to drive the entire site's visual tokens, so that I can re-theme the whole application by editing a single file without touching component markup.

#### Acceptance Criteria

1. THE Theme_System SHALL declare all color, radius, shadow, spacing, and typography tokens as CSS custom properties in a single source file at `src/styles/theme.css`.
2. THE Styling_Layer SHALL resolve every color token by referencing the corresponding Theme_System variable via `var(--…)` rather than a literal color value.
3. WHEN a color variable value in the Theme_System is changed and the application is rebuilt, THE PawPort_Application SHALL render the updated color on every element that uses that token across the Marketing_Surface and the Portal_Surface, with no other file edited.
4. THE Theme_System SHALL preserve the existing token names (including `primary`, `secondary`, `accent`, `neutral`, and `base-100`) so that existing DaisyUI and Tailwind class references continue to resolve.
5. THE Styling_Layer SHALL express color tokens so that Tailwind alpha opacity modifiers (for example `bg-primary/20`) resolve to the token color at the specified opacity.
6. IF a referenced Theme_System color variable is undefined at build time, THEN THE Styling_Layer SHALL fail the build with an error identifying the missing token rather than emitting an invalid color value.

### Requirement 2: Light and Dark Theming

**User Story:** As a user of PawPort, I want the site to support coherent light and dark themes, so that both the marketing pages and the portal look correct in either mode.

#### Acceptance Criteria

1. THE Theme_System SHALL define a light token block and a dark token override block, each keyed to a `data-theme` value (`pawport_light` and `pawport_dark`), such that every token defined in the light block has a corresponding override in the dark block with no unmatched tokens in either block.
2. WHEN the Theme_Controller sets the `data-theme` attribute to `pawport_dark`, THE PawPort_Application SHALL resolve every token to the value defined in the dark block of the Theme_System with zero tokens falling back to a light or default value.
3. WHEN the Theme_Controller sets the `data-theme` attribute to `pawport_light`, THE PawPort_Application SHALL resolve every token to the value defined in the light block of the Theme_System with zero tokens falling back to a dark or default value.
4. WHEN the active theme changes, THE Marketing_Surface and THE Portal_Surface SHALL both re-resolve every shared Theme_System token to the newly active theme's values, such that no element on either surface retains a color from the previously active theme.
5. IF the Theme_Controller sets the `data-theme` attribute to a value other than `pawport_light` or `pawport_dark`, THEN THE PawPort_Application SHALL resolve every token to the light block values as the default.
6. WHILE the active theme is being applied on initial page load, THE PawPort_Application SHALL render the resolved theme's tokens before first visible paint, such that no element displays an unthemed or opposite-theme color during load.

### Requirement 3: Marketing Landing Page and Shell

**User Story:** As a prospective customer, I want a modern marketing landing page at the site root, so that I can understand the PawPort offering and be guided toward signing up.

#### Acceptance Criteria

1. WHEN a visitor navigates to the URL `/`, THE Marketing_Surface SHALL render a landing page containing, in top-to-bottom order, a hero section, one or more feature sections, a parallax showcase section, a stats/marquee section, a testimonial section, and a pricing/CTA section.
2. THE Marketing_Shell SHALL wrap the landing page with a shared marketing header displayed at the top of the viewport and a marketing footer displayed at the bottom of the page content.
3. WHERE a public route is rendered within the `(public)` route group, THE Marketing_Shell SHALL provide the shared marketing header and footer around that route.
4. THE pricing/CTA section SHALL present a primary conversion call-to-action control that references the registration destination.
5. WHEN the visitor activates the primary conversion call-to-action, THE Marketing_Surface SHALL navigate the visitor to the registration route `/register`.
6. WHEN the visitor scrolls the landing page vertically past the top of the viewport, THE Marketing_Shell SHALL apply the scrolled visual state to the marketing header, and WHEN the visitor scrolls back to the top of the viewport, THE Marketing_Shell SHALL restore the header to its default (non-scrolled) visual state.

### Requirement 4: Hero Media with Graceful Fallback

**User Story:** As a developer, I want the hero to display the best available background media and degrade gracefully, so that the landing page renders correctly even when no media assets are present.

#### Acceptance Criteria

1. THE Hero_Component SHALL read its media configuration from the Hero_Media_Config module.
2. WHERE a video source is configured AND the user's reduced-motion preference is not enabled, THE Hero_Component SHALL render the video background layered above the poster image.
3. WHILE the configured video is loading, THE Hero_Component SHALL render the poster image until the video reaches a playable state.
4. IF a configured video fails to load or cannot reach a playable state within 5 seconds, THEN THE Hero_Component SHALL render the poster image when a poster is configured, otherwise render the CSS gradient background, without displaying an empty region.
5. IF no video source is configured OR the user's reduced-motion preference is enabled, THEN THE Hero_Component SHALL render the poster image when a poster is configured.
6. IF neither a video source nor a poster image is configured, THEN THE Hero_Component SHALL render a CSS gradient background.
7. WHEN the Hero_Component renders with no hero media assets present, THE Hero_Component SHALL render a background element that fills 100% of the hero container width and height with a visible, non-transparent fill.
8. WHEN poster or video source paths in Hero_Media_Config are changed to reference different files, THE Hero_Component SHALL resolve and render the updated paths on the next page load without requiring source code changes.

### Requirement 5: Motion and Animation Ownership

**User Story:** As a developer, I want a clear division of animation responsibilities between animation libraries, so that motion is coherent and no element is animated conflictingly.

#### Acceptance Criteria

1. THE Framer_Layer SHALL own route transitions, page/step transitions, in-view reveals, and micro-interactions, and SHALL NOT apply scroll-scrubbed transforms, pinned-section behavior, or marquee animations.
2. THE GSAP_Layer SHALL own scroll-scrubbed parallax, pinned sections, and marquee animations, and SHALL NOT apply route transitions, page/step transitions, in-view reveals, or micro-interactions.
3. THE Motion_System SHALL ensure that no DOM element is animated on the same CSS property by both the Framer_Layer and the GSAP_Layer.
4. WHERE a section uses parallax, THE GSAP_Layer SHALL apply the scroll-scrubbed transform to a dedicated layer element that no Framer_Layer transform targets.
5. WHILE a user has enabled a reduced-motion preference, THE Motion_System SHALL disable scroll-scrubbed parallax, pinned-section motion, and marquee animations, and SHALL render the corresponding sections in their final static state.

### Requirement 6: Accessibility — Reduced Motion

**User Story:** As a user who prefers reduced motion, I want animations to be suppressed while all content remains visible, so that I can use the site comfortably without disorienting motion.

#### Acceptance Criteria

1. WHILE the Reduced_Motion_Preference is active, THE GSAP_Layer SHALL NOT run scroll-scrubbed or parallax motion, and SHALL render the affected elements in their final resting position within 100 milliseconds of page load.
2. WHILE the Reduced_Motion_Preference is active, THE Framer_Layer SHALL collapse in-view reveals to an instant appearance with zero transition duration, presenting each element at full opacity and its final position on first render.
3. WHILE the Reduced_Motion_Preference is active, THE Hero_Component SHALL skip attaching the hero video and SHALL present the poster image, or the gradient fallback if the poster image is unavailable, within 100 milliseconds of page load.
4. WHILE the Reduced_Motion_Preference is active, THE Marketing_Surface SHALL keep 100 percent of content elements fully visible at full opacity with no elements hidden, offscreen, or clipped.
5. IF the Reduced_Motion_Preference changes from inactive to active during an active session, THEN THE GSAP_Layer and THE Framer_Layer SHALL halt any in-progress motion within 100 milliseconds and place all affected elements in their final resting position at full opacity.

### Requirement 7: Performance and SSR Safety

**User Story:** As a user on a range of devices, I want the marketing page to load quickly and stably, so that content appears fast without layout shifts or errors.

#### Acceptance Criteria

1. THE Hero_Component SHALL defer initialization of the hero video until after the hero's largest contentful element has painted, so that video loading does not block LCP.
2. WHERE a poster image is configured, THE Hero_Component SHALL render the poster image in the initial paint as the LCP candidate without waiting for the video to load.
3. THE Hero_Component SHALL reserve its layout dimensions such that the hero region produces a Cumulative Layout Shift of 0 while hero media resolves.
4. WHEN a component that uses the GSAP_Layer is unmounted, THE Motion_System SHALL revert its GSAP_Context, leaving no active ScrollTrigger for that scope.
5. THE Animation_Provider SHALL register ScrollTrigger exactly once on the client and SHALL NOT re-register it on subsequent renders or navigations.
6. THE Motion_System SHALL NOT access `window`, `document`, or `matchMedia` during render or on the server.
7. IF a configured hero video fails to load, THEN THE Hero_Component SHALL retain the poster or gradient fallback without raising an unhandled error.

### Requirement 8: No Regression of Existing Functionality

**User Story:** As an existing PawPort user, I want all current features to keep working after the redesign, so that the new visuals do not break authentication, booking, the portal, or the digital pet card.

#### Acceptance Criteria

1. WHEN a user completes the primary task of the authentication, booking, groomer portal, or digital pet card feature after the redesign, THE PawPort_Application SHALL produce the same observable outcome (successful navigation to the expected next view and persistence of submitted data) that the feature produced before the redesign.
2. IF any of the authentication, booking, groomer portal, or digital pet card features fails to complete its primary task after the redesign, THEN THE PawPort_Application SHALL retain the user's submitted input and present an error indication describing the failed action without data loss.
3. WHEN a page transition or a booking-flow step transition is triggered after the redesign, THE Framer_Layer SHALL run the transition from the same trigger point as before the redesign and complete it without visual error within 1000 milliseconds.
4. WHERE the booking page and pet-card page are rendered, THE Marketing_Shell SHALL apply the shared shell and central theme WHILE THE PawPort_Application produces the same navigation results and data outputs for identical user inputs as before the redesign.
5. THE Theme_System SHALL keep existing token names unchanged so that every existing DaisyUI and Tailwind class reference resolves and the project builds with zero unresolved-class or missing-token errors.

### Requirement 9: Responsive Layout and Touch Targets

**User Story:** As a mobile user, I want the marketing pages to adapt to my screen and offer comfortably sized controls, so that I can browse and interact easily on any device.

#### Acceptance Criteria

1. THE Marketing_Surface SHALL present a mobile-first responsive layout with breakpoints at 767 pixels and below (mobile), 768 to 1023 pixels (tablet), and 1024 pixels and above (desktop).
2. WHEN the Marketing_Surface is rendered at any supported viewport width, THE Marketing_Surface SHALL lay out content without introducing horizontal scrolling.
3. THE Marketing_Surface SHALL size each interactive element as a Touch_Target measuring at least 44 pixels in width and 44 pixels in height, consistent with the rest of the PawPort_Application.

## Requirements to Correctness Properties Traceability

The following mapping ties acceptance criteria to the design's correctness properties (P1–P8) and design decisions (D1–D7):

- **Requirement 1** (1.1–1.6) → **P1** (single source of truth); consistent with **D2**.
- **Requirement 2** (2.1–2.6) → **P2** (theme swap coherence); consistent with **D2**.
- **Requirement 3** (3.1–3.6) → consistent with **D1** (scope: new marketing landing + shell).
- **Requirement 4** (4.2–4.8) → **P3** (graceful hero); consistent with **D3**.
- **Requirement 5** (5.1–5.5) → **P8** (property ownership); consistent with **D4**.
- **Requirement 6** (6.1–6.5) → **P4** (reduced motion); consistent with **D6**.
- **Requirement 7** (7.1–7.3, 7.7) → performance (LCP, no layout shift, video fallback); (7.4) → **P6** (cleanup); (7.5–7.6) → **P5** (SSR safety); consistent with **D5**.
- **Requirement 8** (8.1–8.5) → **P7** (no regression); consistent with **D1** and **D7**.
- **Requirement 9** (9.1–9.3) → consistent with performance and accessibility guidance in the design.
