// scripts/images.config.mjs — EDIT THIS to change which photos are used.
// Each slot tries its queries in order and takes the `pick`-th result (0 = best match)
// that is at least `minWidth` px wide. Open scripts/out/preview.html after a run,
// don't like one? bump its `pick` (or change the query) and re-run.
export const slots = [
  {
    key: "hero", file: "hero-poster", orientation: "landscape", minWidth: 2000, width: 2400, pick: 0,
    queries: ["dog groomer holding fluffy dog", "happy fluffy dog golden hour", "groomer with dog outdoors"],
    alt: "A mobile groomer with a freshly groomed fluffy dog",
  },
  {
    key: "featureBooking", file: "feature-booking", orientation: "landscape", minWidth: 1400, width: 1600, pick: 0,
    queries: ["woman using smartphone with dog", "phone booking pet owner dog", "person holding phone dog"],
    alt: "A pet owner booking a groom on their phone with their dog beside them",
  },
  {
    key: "featureRoute", file: "feature-route", orientation: "landscape", minWidth: 1400, width: 1600, pick: 0,
    queries: ["white van suburban street", "van driving residential street", "delivery van neighborhood"],
    alt: "A service van on a quiet suburban street",
  },
  {
    key: "featureCard", file: "feature-card", orientation: "portrait", minWidth: 1000, width: 1200, pick: 0,
    queries: ["groomed poodle portrait", "well groomed dog portrait", "fluffy dog portrait studio"],
    alt: "Portrait of a freshly groomed dog",
  },
  {
    key: "cat", file: "cat-groom", orientation: "landscape", minWidth: 1400, width: 1600, pick: 0,
    queries: ["cat grooming", "cat being brushed", "persian cat groomer"],
    alt: "A calm cat being groomed",
  },
  {
    // NOTE: stock photos can't give the SAME dog before/after. Treat these as an illustration
    // until you replace them with real photos from your first groomers.
    key: "before", file: "before", orientation: "square", minWidth: 1000, width: 1200, pick: 0,
    queries: ["shaggy dog overgrown fur", "matted fur dog"],
    alt: "A dog with overgrown fur before grooming (illustrative)",
  },
  {
    key: "after", file: "after", orientation: "square", minWidth: 1000, width: 1200, pick: 0,
    queries: ["groomed dog trimmed fur", "neatly groomed dog"],
    alt: "A neatly groomed dog after grooming (illustrative)",
  },
  {
    key: "bath", file: "dog-bath", orientation: "landscape", minWidth: 1400, width: 1600, pick: 0,
    queries: ["dog bath bubbles", "dog being washed"],
    alt: "A dog enjoying a bath",
  },
];
