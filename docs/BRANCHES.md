# Ramas de Velocity Music

Actualizado: 2026-07-12 (post usePlaybackController + branch hygiene).

## Activas

| Rama | Rol |
|------|-----|
| **`main`** | Producción. Frontend Pages + backend guardián. Única rama de release. |
| **`develop`** | Integración. Debe estar **alineada con `main`**. |

## Política

1. Feature work → `feature/*` o PR a `main` / `develop`.
2. Tras merge a `main`, borrar la feature branch.
3. `develop` se actualiza con: `git push origin main:develop` (fast-forward o force-with-lease si quedó atrás).
4. Nunca force-push a `main`.
5. **No** force-merge ramas pre-store (árbol monolítico de App.jsx) sobre el refactor actual.

## Revisión 2026-07-12

### `feat/playlist-search-and-jump` → **cerrada / borrada**

Commits únicos vs `main` (antes del cierre):

| Commit | Tema | Decisión |
|--------|------|----------|
| `ca33bcb` / `eebbd1b` | Buscador en playlists + ir a playlist desde player/menú | **Ya en main** (extraído: `SearchBar`, `useListSearch`, `LibraryTab` plSearch, `DetailView`, `playingFrom`, `goToPlayingPlaylist`, `TrackMenu`) |
| `c5786ec` / `e7518e0` / `2b5120d` | `importService` Spotify/YTM + NDJSON stream | **No portar tal cual**. Main tiene flujo distinto y deliberado: YTM vía `/api/playlists/import` + Spotify gratis (bookmarklet / pestaña Spotify). El scrape Spotify server-side de la rama choca con ese diseño. Re-evaluar NDJSON solo si import YTM se corta por timeout. |
| `95cdb8b` / `76231d3` | OAuth redirect + CSP callback externo | **Ya en main** (y mejorado: reintentos 502 en `callback.js`) |

### `security-hardening` → **cerrada / borrada**

- Local: ancestro completo de `main` (nada único).
- Remoto: solo los dos commits OAuth/CSP ya absorbidos en main por evolución posterior.

### `fix/sw-cache-bump`

Obsoleto (`main` en SW v38+). Puede borrarse cuando se limpie remoto.

## Limpieza realizada

- `develop` re-sincronizada con `main` (estaba ~137 commits atrás sin commits propios únicos).
- `feat/playlist-search-and-jump` y `security-hardening` revisadas y eliminadas tras documentar port/supersede.
