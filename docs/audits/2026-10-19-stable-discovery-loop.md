# Stable discovery and repeating home feed

Candidate: 3.29, worker velocity-v100. Branch: feature/stable-discovery-loop.

## Confirmed causes and changes

- Listening updated recent history, which changed the feed generation signature. Explicit-taste sessions now consume new listening/heart signals on the next refresh rather than rebuilding on interaction.
- DiscoverySongs rendered an unfilled heart even when aria-pressed was true. The icon now uses the same saved-ID state.
- Song recommendations could be re-interleaved when another page arrived. The song selection freezes on its first interaction for that taste profile; new mix pages can still append.
- Artist mixes borrowed the entire multi-genre catalog. They now admit the seed artist and artists in its known editorial genre context. Unknown genre relations are not assumed just to reach the length target. This is a conservative editorial rule, not a learned genre classifier.
- Raw search batches could be opened before final mix construction. Generated batches are now pending, excluded from playback and cache, and removed if no complete selection can be constructed. User-created/local collections keep their actual lengths.
- Home now has two visual cycles. Scrolling through the second cycle's boundary subtracts one period from scrollTop, preserving the relative viewport position. The visual bridge is inert and aria-hidden; DOM cycle count stays at two.
- Artwork cache lookup previously enumerated and parsed every cached URL on each size-variant miss. A shared index amortizes that enumeration, coalesces concurrent index creation and receives newly saved URLs. A 60-second lifetime refreshes changes made by other contexts. Exact cache hits remain checked first.

## Validation evidence

- Staging at 390 px: heart and playback on the twelfth song retained song ordering and internal scrollTop=500. Heart was pressed and filled; remote audio advanced to 3.54 seconds.
- Initial loop crossing: requested scrollTop=2787.61, rebased scrollTop=209, period=2578.86. First-cycle position differed from the mapped bridge position by 0.25 px.
- Final candidate bundle index-DVR0qPlA.js: three consecutive boundary crossings each had 0.25 px mapping error, two DOM cycles and document width=viewport width=390.
- Actual catalog queries for Rock, EDM and a ballad artist produced an Oasis mix with 50 tracks from eleven Rock artists. Skrillex, Porter Robinson and Jose Jose were absent; adjacent artist repeats=0.
- Artwork regression: twenty concurrent misses over a cache with 1000 images enumerate that cache once; a newly saved variant is found without another enumeration.
- Observational image timings in staging: 161 image resource entries, median=52.5 ms, p95=618.6 ms. This mixes cache/network observations and is not a controlled before/after latency experiment.

## Required gates

Directed mix, cache, loop, interaction and pending-selection regressions pass. Canonical verify, production build and lint passed. The full frontend suite passed 584 tests in 54 files with two workers. Release CI remains required before publication.

## Limits

Favorite display follows the saved track ID. Equivalence between different recordings/provider IDs has not been inferred by loose title matching. Editorial context cannot certify every artist's entire discography as one genre. The catalog tests prove the measured selection and regression exclusions, not universal music classification accuracy.
