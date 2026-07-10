# P1 Implementation Plan — A audio + B covers

> Spec: `docs/superpowers/specs/2026-07-10-p1-audio-covers-design.md`

## Tasks

### A1 — api.js peek + warm + inflight
- [x] `peekStreamUrl`, `warmStreamUrl`, inflight dedup on `ensureStreamUrl`

### A2 — play síncrono + prefetch firmas
- [x] `prefetchNext` warms current+3 signatures
- [x] `play()` sync path on cache hit; async only on miss
- [x] play generation token to drop stale signs

### A3 — re-acquire post-video
- [x] visibility + focus + pageshow soft resume
- [x] stuck detector for paused-while-playing

### B1 — offline covers
- [x] catalog: data: always wins
- [x] hydrate + backfillCovers on startup
- [x] Media Session: data:→blob: artwork

### Verify
- [ ] `npm run verify`
