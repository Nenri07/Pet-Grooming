# PawPort Image Kit

Downloads 8 royalty-free photos from Pexels, optimizes them, writes a typed image map + credits, and makes an OG image.
I couldn't download photos for you (my environment can't reach photo sites), so this kit does it on YOUR machine in one command.

## Run it (2 minutes)
1. Get a free Pexels API key: https://www.pexels.com/api/
2. From your project root:
```bash
# copy this kit's `scripts/` folder into your project root, then:
npm i -D sharp
PEXELS_API_KEY=your_key_here node scripts/fetch-images.mjs      # Windows PowerShell: $env:PEXELS_API_KEY="your_key"; node scripts/fetch-images.mjs
```
3. Open `scripts/out/preview.html` and look at the photos. Don't like one? In `scripts/images.config.mjs`
   raise that slot's `pick` (1, 2, 3...) or change its `queries`, then run again.

## What you get
- `public/images/marketing/*.jpg`   (optimized, max 2400px wide, mozjpeg q82)
- `public/og.jpg`                    (1200x630 share image cropped from the hero)
- `public/images/marketing/credits.json`
- `src/content/images.generated.ts`  (typed: src, width, height, blurDataURL, alt, credit)

Then give Kiro `KIRO_IMAGES.md` (same folder) and say: "Follow KIRO_IMAGES.md".

## License notes (check the current terms yourself: https://www.pexels.com/license/)
- Pexels photos are free for commercial use. You may not sell unaltered copies or imply the people/brands endorse you.
- Add a small "Photos: Pexels" credit in the footer (the Kiro task does this from credits.json). It's good practice and API terms ask for a Pexels link.
- Some photos show identifiable people. For paid advertising (Facebook ads), prefer photos without recognizable faces or swap to your own once you have customers.
- The before/after pair is NOT the same dog. It is illustrative. Replace with real before/after photos from your first groomers ASAP and don't present it as a real customer result.

## Best free alternatives if Pexels doesn't have what you want
Unsplash (unsplash.com), Pixabay (pixabay.com). Download by hand, save as the same filenames, and edit
`src/content/images.generated.ts` (or re-generate) so `credit` matches. Both licenses are also free for commercial use.
