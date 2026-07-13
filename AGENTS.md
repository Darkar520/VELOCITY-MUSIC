# AGENTS.md

Repo-specific guidance for OpenCode sessions. Read this first; the README and `docs/` describe intent, this file captures what actually bites you.

## Commands

- **Backend tests:** `npm test` (Node built-in runner, `node --test test/*.test.js`). ~222 tests, includes property-based (fast-check) + frontend catalog/helpers/api tests run via the Node runner).
- **Frontend tests:** `cd frontend && npm test` (vitest). Only ~22 tests, only `src/store/__tests__/*.test.jsx` (playerStore, libraryStore).
- **Build:** `cd frontend && npm run build` writes to **`../public`** (served by the backend Express). `npm run build:pages` writes to `frontend/dist` (used by Cloudflare Pages). Don't confuse them.
- **Lint:** `cd frontend && npm run lint:errors` (CI runs `npm run lint -- --quiet`: errors only, warnings non-blocking).
- **Canonical verify gate:** `npm run verify` = `node --test test/*.test.js && cd frontend && npm run build`. This is what `npm run preflight` runs too.
- **Pre-push hook is opt-in:** `npm run setup:hooks` sets `core.hooksPath=.githooks`. Without it, `git push` will NOT block on failing tests. The hook is `/bin/sh` (works under Git's bash on Windows).

## Architecture gotchas

- **Two stores, separate test runners:** `frontend/src/store/{playerStore,libraryStore}.js` (Zustand) is tested via **vitest**, not the Node runner. The Node runner does test frontend code (`catalog.js`, `helpers.js`, `api.js`) via `test/frontend-*.test.js`. Changes to stores require BOTH suites.
- **`App.jsx` is a slim shell:** tests in `test/app-shell*.test.js` enforce that `App.jsx` stays slim and delegates to `frontend/src/tabs/*`, `frontend/src/hooks/*`, `frontend/src/store/*`. Don't inline new UI components there.
- **Audio continuity is a state machine — never bypass it.** Flow: `audioContinuity.js` → `audio/audioMachine.js` (`reduce`) → `audio/runAudioEffects.js` → `App.jsx dispatchAudio`. Tests: `audioMachine`, `audioPolicyMatrix`, `audioContinuity`, `runAudioEffects`. Background + yielded = NEVER `audio.play()`. See `docs/AUDIO-REGRESSIONS.md` before touching playback. Cell-by-cell test matrix (A7–A13) must stay green.
- **Stream URL is HMAC-signed, NOT Bearer.** `/api/stream-proxy` requires `exp+sig` (signed with `JWT_SECRET`); `<audio>` can't send Bearer headers. Sign via `GET /api/stream-sign` → `api.ensureStreamUrl()`. `/api/resolve` (prefetch) requires JWT. Never add Bearer auth to `/api/stream-proxy`.
- **Stream proxy quirks:** no gzip, no rate-limiting (breaks Range). gzip/compression only for text routes.

## Domain key conventions (regressions happened here)

- **Library collections use specific key fields:** albums → `albumId`, saved playlists/mixes → `playlistId`, tracks/favs → `id`. The store's `saveAlbum`/`isAlbumSaved`/`unsaveAlbum` MUST compare on `albumId` (regression `c851b7e` — were wrongly keyed by `id`). When adding a new collection, follow the existing field name exactly and add a regression test.
- **`CoverImg` must reset load state on `src` change.** If you refactor `frontend/src/components.jsx` `CoverImg`, preserve the reset logic — tests (`catalog.js`) cover this; a stale `failed` flag leaves the fallback permanently stuck across tracks.
- **`hiResCover(url, size)` takes a real size** (≈512 miniatures, ≈900 large player). Don't default to 1200 globally (slow). Tests cover null/data: handling.
- **Service Worker version bump is mandatory** when editing `frontend/public/sw.js`: change `CACHE = 'velocity-vN'`. Backend serves `index.html` and `sw.js` with `no-cache`; hashed assets with `immutable`. Don't invert. SW reload is auto — but only fires when music is paused (to not cut playback).

## Environment / deploy

- **`.env` is gitignored, single source of secrets.** Required in prod: `JWT_SECRET` (long random), `ADMIN_KEY` (≥8 chars, no default — admin panel disabled if unset), `ALLOWED_ORIGIN` (CORS fail-closed in prod if missing — DO NOT add `*`).
- **Default storage is JSON** (`data/velocity-db.json`); PostgreSQL is opt-in via `USE_POSTGRES=1` (+ `DATABASE_URL`). **Cluster mode requires Postgres** — JSON corrupts across processes.
- **Backend restart only needed for `src/**` changes.** Touching `frontend/**` does NOT require backend restart. After backend changes: stop the Node process; the guardian (`scripts/velocity-guardian.ps1`) revives it in ~30s. Verify with `GET /api/status` → `{"status":"operational"}`.
- **Staging sandbox:** `npm run start:staging` (port 3001, isolated `data-staging/`). Don't run the prod backend against `data/` when testing.
- **`trust proxy = 1`** (not `true`) — only the last hop (Cloudflare). Prevents IP spoofing to dodge rate limits. Don't loosen.
- **Passwords:** scrypt hash only (`scrypt$salt$hash`). Never plaintext, never in logs/responses.
- **Each JWT has a `jti`** — revocation via `tokens_invalid_before` + jti blacklist. Don't strip `jti` when issuing tokens.

## Branch / release flow

- `main` = production, `develop` = integration, `feature/*` for work. Merge to `main` is gated by CI (`verify` job required status check).
- Sync develop from main: `git push origin main:develop`.
- Don't force-push `main`.
- After merge to `main`, Cloudflare Pages auto-deploys. Clients get the update on next reload (SW triggers when audio paused).

## Editing on this machine (Windows)

- **NEVER edit source files with `Set-Content` / `>` redirects** — corrupts UTF-8 (App.jsx was once saved as Latin-1). Always use the editor's edit tools.
- **Shell is PowerShell 5.1**: no ternary `?:`, no `&&` (use `;` or `; if ($?) { }`), call executables with spaces via `& "path"`, wrap paths with spaces in double quotes.
- Working dir is `C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC` (the OneDrive path — paths with spaces need quoting).

## Things not worth re-discovering

- Property-based tests can be slow: Property 16 (LRU eviction ~650ms), Property 23 (scrypt ~4-7s), logout-all revocation (~1.5s). Not flaky.
- Pre-push hook failing = push refused. Real emergency override: `git push --no-verify`.
- `mcps/`, `scripts/_*.ps1`, `terminals/` and similar untracked session-local dirs are scratch — don't commit them.
- Spotify OAuth: only `SPOTIFY_CLIENT_ID` (public, Implicit Grant); NEVER put the Client Secret in `.env`.
- Test counts drift over time; rely on "0 fail" not on exact totals.