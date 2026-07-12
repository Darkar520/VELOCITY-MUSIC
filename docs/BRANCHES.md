# Ramas de Velocity Music

Actualizado: 2026-07-12.

## Activas

| Rama | Rol |
|------|-----|
| **`main`** | Producción. Frontend Pages + backend guardián. Única rama de release. |
| **`develop`** | Integración. Debe estar **alineada con `main`** (o como máximo unos commits por delante en features estables). |

## Históricas (no borrar sin revisar)

Estas ramas tienen commits que **no están en `main`**. No se eliminan a ciegas:

| Rama | Contenido |
|------|-----------|
| `feat/playlist-search-and-jump` | Import Spotify/YT + NDJSON + buscador en playlists |
| `security-hardening` | OAuth redirect / CSP callback |
| `fix/sw-cache-bump` | SW v8→v9 (obsoleto; `main` va en v36+) |

## Política

1. Feature work → `feature/*` o PR a `main` / `develop`.
2. Tras merge a `main`, borrar la feature branch.
3. `develop` se actualiza con: `git push origin main:develop` (fast-forward o force-with-lease si quedó atrás).
4. Nunca force-push a `main`.

## Limpieza realizada

- `develop` re-sincronizada con `main` (estaba ~137 commits atrás sin commits propios únicos).
