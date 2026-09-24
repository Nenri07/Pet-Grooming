# Task for Kiro: wire up the marketing images

The image assets already exist. **Do not generate, download, or hotlink any images.** Do not use gradient placeholders where an image belongs.

## Files (already in the repo)
- `public/images/marketing/*.jpg` — hero-poster, feature-booking, feature-route, feature-card, cat-groom, before, after, dog-bath
- `public/og.jpg`
- `src/content/images.generated.ts` — exports `images` with `{ src, width, height, blurDataURL, alt, credit }` per key: `hero, featureBooking, featureRoute, featureCard, cat, before, after, bath`. **Auto-generated; never edit by hand.**
- `public/images/marketing/credits.json`

## Do this
1. **Hero:** point `heroMedia` (Hero_Media_Config) `poster` at `images.hero.src`. Render with `next/image`, `priority`, `fill` inside a container with a reserved aspect ratio (CLS 0), `placeholder="blur"` + `blurDataURL`, `sizes="100vw"`, `alt` from the map. Keep the CSS gradient (`bg-hero`) as the fallback under it. Add a dark/ivory overlay using theme tokens (e.g. `bg-base-100/40` gradient) so headline contrast is ≥ 4.5:1 in BOTH themes.
2. **Sections:** use `images.featureBooking`, `featureRoute`, `featureCard`, `cat`, `bath` in the bento/feature/showcase sections from the master spec. Every `next/image` uses `width/height` (or `fill` + aspect wrapper), `placeholder="blur"`, real `alt`, and `sizes` appropriate to layout. Only the hero gets `priority`; everything else lazy.
3. **Before/After slider:** use `images.before` and `images.after`. Add a small caption "Illustrative example". Never label them as a real customer.
4. **Parallax/motion:** apply GSAP parallax to a dedicated wrapper around the `<Image>`, never to the image element that Framer also touches. Reduced-motion: static.
5. **SEO/OG:** in the root `metadata`, set `openGraph.images = [{ url: "/og.jpg", width: 1200, height: 630 }]` and Twitter card `summary_large_image`.
6. **Credits:** in the marketing footer add a small muted line "Photography: Pexels" linking to https://www.pexels.com. On a `/credits` page (linked from the footer), list every photographer from `credits.json` with links to `sourceUrl`.
7. **next.config:** no remote domains needed (all images are local). Do not add `images.remotePatterns` for stock sites.
8. **Verify:** no `<img>` tags in marketing components; `grep -r "unsplash\|pexels.com/photos\|pixabay" src` returns nothing outside `images.generated.ts`/credits; Lighthouse: hero is the LCP element; CLS 0; total marketing image weight on first load < 500 KB (if not, lower JPG quality in the script, not in components).

## If an image is missing
If a key is absent from `images.generated.ts` (script found no match), render that section with a text-first layout, not a placeholder box, and tell me which key was missing.
