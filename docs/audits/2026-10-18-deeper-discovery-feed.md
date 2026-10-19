# Deeper discovery feed — working validation

Scope: feature/deeper-discovery-feed. The separate notification-next-recurrence worktree has not been merged into this change.

## Implemented

- Generated mixes target 50 unique tracks, interleave recording artists and cap each artist at five tracks.
- Genre collection searches ten editorial artists per selected genre instead of filling long mixes from three searches. The collection buffer accepts 200 tracks before mix selection.
- Artist/discovery mix selection rejects candidates sharing more than 30 tracks with another accepted recommendation in those rows.
- Scrolling requests additional editorial artists, then radio results seeded from the selected genre mixes. A published page requires 8–10 mixes of 50 tracks and new track IDs. Empty results expose a retry action.
- The scroll observer registers when content arrives after an empty render and requires leaving/re-entering the viewport before requesting another page.
- Artist portraits resolve exact normalized names and use bounded concurrency with a metadata cache.
- Feed cache format 2 stores each track once and reconstructs mix references. Legacy cache payloads remain readable. Persistence is bounded to eight sections and stops rewriting after the bound is reached.
- Track rows request 128 px images, media cards 256 px, and four-image mix cards 128 px per tile. Images outside the viewport use lazy loading; detail artwork and the home hero request eager loading.

## Observed in staging

- Rock mix rendered 50 rows from 11 artists, maximum five tracks per artist and zero adjacent repeated artists.
- Jazz mix rendered 50 rows from 11 artists with zero adjacent repeated artists.
- Queen, Radiohead and Pink Floyd portraits decoded successfully in the browser. Their proxy responses were HTTP 200 image/jpeg.
- At 390 px viewport width, document width remained 390 px. Song sections had internal vertical scrolling.
- Editing Rock/Metal/EDM to Rock/Metal/Jazz replaced the EDM genre mix. The selection survived reload. Saving Jazz produced a saved playlist of 50 tracks visible in Library after reload.
- Scrolling appended new sections. In the latest observed bundle (index-CStWbZZl.js), the first appended page remained the last page after an additional eight-second wait, without an automatic second request.
- Cache measurements: an earlier uncompressed extended feed reached 3,273,552 characters. Format 2 with six sections measured 272,893 characters. These are different feed sizes, not a controlled latency comparison.
- One real cover measured 6,309 bytes at 128 px, 19,071 at 256 px and 59,048 at 512 px. Request times varied; this does not establish a general latency improvement.

## Automatic playback investigation

Two staging transitions were observed after seeking near the natural end: one foreground and one after opening another desktop browser tab. Native pause/ended were followed by source load, loadedmetadata and playing for the next track, with its clock advancing. Network records included HTTP 206 audio responses.

App shell regressions additionally assert that ENDED selects the second track, requests its signed stream and leaves policy in trackId=second, intent=play, srcStatus=ready, including simulated hidden visibility with focus=own.

The physical Samsung lock-screen failure has not been reproduced. Desktop tab switching and simulated hidden visibility do not prove physical mobile continuity. Device result, network type and running version were requested from the user and are pending.

## Validation status

Complete verification passed npm run verify, lint:errors and 576 frontend tests with two workers. The final artist-cap adjustment also passed the directed Node mix/cache regressions. Release version is 3.27 with worker velocity-v98; production publication remains pending.

## Still required

- CI verification of the release commit.
- Publication and public bundle verification.
- Physical Samsung transition evidence and diagnosis of any remaining device-specific failure.
