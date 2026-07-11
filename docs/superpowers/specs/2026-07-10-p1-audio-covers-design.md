# P1 Design — Continuidad de audio + carátulas offline

**Status:** approved 2026-07-10  
**Scope this PR:** Workstreams **A** (audio continuity) + **B** (offline covers)  
**Deferred:** C guest spam · D httpOnly cookies · E App.jsx split  

**Update 2026-07-11:** Antes de **E**, ejecutar  
`docs/superpowers/plans/2026-07-11-audio-state-machine.md`  
(máquina de estados de audio / `dispatch` único). Partir App sin FSM solo  
reparte regresiones A7–A13.

## Goals

1. Online playback continues across screen lock on mobile browsers (Brave/Chrome/etc.) for queued tracks.
2. After competing media (e.g. long video), audio re-engages when returning to the app without manual re-tap when possible.
3. Offline tracks show covers consistently in mini player, expanded player, and Media Session when a cover exists in IDB.

## Non-goals

- Opening stream proxy without HMAC
- Full App.jsx split
- httpOnly cookie auth migration
- Perfect Opera Mini parity

## A — Continuidad

### Root cause

`play()` awaits `ensureStreamUrl` (network). On lock, Brave/Chrome throttle JS/network → `onEnded` → `next()` → failed/slow sign → silence. Offline uses blobs → no sign → works.

### Design

1. **Pre-warm** signed URLs for current + next 2–3 queue entries while document is visible.
2. **`peekStreamUrl`**: synchronous cache read (min remaining TTL, default 90s).
3. **`play()` critical path**:
   - Offline blob: unchanged (async blob load only).
   - Online cache hit: set `playSrc` **synchronously** (no await).
   - Online cache miss + visible: await sign once, then set src.
   - Online cache miss + hidden: still attempt await (best-effort); never leave unsigned URL as playSrc.
4. **`prefetchNext`**: also warm signatures (not only `/api/resolve`).
5. **Re-acquire**: on `visibilitychange`→visible, `focus`, `pageshow` — if user still wants play, restore volume + soft `play()`; `forceReacquire` **only when document is visible**. Never force-reacquire in background (Chrome kills Media Session). See `frontend/src/audioContinuity.js`.
6. **External pause** (YouTube/FB/other app): keep `playingRef=true`, set `systemPausedRef`; resume on return to app — do not `setPlaying(false)`.
7. **Preload `<audio>` elements**: clear `src` when going hidden so they do not compete with Media Session.

## B — Covers

1. Hydrate from IDB: always promote `data:` cover over HTTPS in catalog + current track.
2. Call `backfillCovers` when online at startup.
3. Media Session: HTTPS cover as today; `data:` → same-origin `blob:` URL for artwork; else app icons. Revoke previous blob artwork URLs.

## Success criteria

| Scenario | Pass |
|----------|------|
| Online queue ≥3, screen off (Brave) | Next track starts without reopening app |
| Offline queue | No regression |
| After other video tab, return to app | Audio resumes ≤2s if still “playing” |
| Offline with IDB cover | Mini + expanded show art; notification has art or stable app icon |
| `npm run verify` | Green |

## Invariants (GUARDRAILS §3)

- Single `<audio>` element for main playback.
- No gzip/rate-limit on stream-proxy.
- HMAC stream signatures remain required.
- Prefer sync advance on `onEnded` when URL is pre-warmed.
