# Generated mix contract

Generated recommendations contain 50 distinct recordings. Search-based recommendations also require 50 normalized song titles, preventing a queue of alternate versions and homonyms. A search result page is a seed lookup, never a playlist candidate pool. Persist the recording actually chosen in Search per account; historical queries without that information use the ranked result, actual listening context and selected artists.

Search selections start with the resolved recording ID. Continuation comes from that ID's catalog radio, its artist catalog, or a selected genre roster containing the seed artist. A different selected genre cannot fill the quota. Same-title homonyms and artists named after the seed title are excluded from continuation and graph expansion. This uses catalog relations; acoustic similarity is not measured.

| Generator | Relationship | Publication gate |
| --- | --- | --- |
| Search curiosity | Exact recording radio / artist / contextual genre | 50 songs, seed first |
| Selected-label curiosity | Selected genre roster | 50 songs |
| Artist curiosity and next connections | Artist and shared selected genre | 50 songs |
| Main artist, discovery and genre rows | `deepRecommendationRows` contextual pools | Existing 50-song gate |
| Additional discovery pages | Contextual pool plus catalog radio | Existing 50-song gate |
| Search-tab related mix | One resolved recording, not other title-search artists | 50 songs |
| AI DJ station | Actual listening/favorite seed, or selected artist when no history exists | 50 songs; no generic text-search fallback |

Actual user playlists, favorite subsets, listening history and downloads retain their real contents. They are not padded to invent user actions. A recommendation that cannot obtain 50 qualified tracks remains unavailable and offers retry; it must not use unrelated filler or publish a shorter playlist.

Regressions: `frontend-seeded-mix.test.js`, `frontend-personalized-shelves.test.js`, `personalizedShelves.test.jsx`, and the existing deep-mix and radio cohesion suites. Include real catalog checks for Vía Láctea / Zoé feat. Dorian, Creep / Radiohead, and infinite source / Deftones before release.
