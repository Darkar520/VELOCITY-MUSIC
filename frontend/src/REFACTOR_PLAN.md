# REFACTOR_PLAN — Extracción de estado de App.jsx

> Generado por auditoría directa de `frontend/src/App.jsx` (2623 líneas, 35 `useState`, 25 `useRef`, 30 `useEffect`).
> No es una propuesta: es el mapa que se sigue en los commits `feat(frontend): playerStore...` y siguientes.

## 1. Inventario de estado por dominio

### Dominio PLAYER — **VA AL STORE** (16 estados)
Estado del reproductor, cola, salida de audio, interrupciones.

| Estado | Tipo | Origen | Destino |
|---|---|---|---|
| `track` | object \| null | `useState(loadPlayerState)` | `playerStore.track` |
| `playing` | boolean | `useState(false)` | `playerStore.playing` |
| `time` | number | `useState(loadPlayerState.t)` | `playerStore.time` |
| `dur` | number | `useState(0)` | `playerStore.duration` |
| `vol` | number | `useState(0.85)` | `playerStore.volume` |
| `expanded` | boolean | `useState(false)` | `playerStore.expanded` |
| `shuffle` | boolean | `useState(false)` | `playerStore.shuffle` |
| `repeat` | boolean | `useState(false)` | `playerStore.repeat` |
| `queue` | string[] | `useState(loadPlayerState.queue)` | `playerStore.queue` |
| `loadingAudio` | boolean | `useState(false)` | `playerStore.loadingAudio` |
| `playSrc` | string \| null | `useState(loadPlayerState)` | `playerStore.playSrc` |
| `outputs` | MediaDeviceInfo[] | `useState([])` | `playerStore.outputs` |
| `sinkId` | string | `useState('')` | `playerStore.sinkId` |
| `remotePlaying` | object \| null | `useState(null)` | **Retirado**: el handoff remoto fue eliminado del runtime |
| `mediaInterrupted` | boolean | `useState(false)` | `playerStore.mediaInterrupted` |
| `downloaded` | Set | `useState(new Set())` | `playerStore.downloaded` |
| `downloading` | Set | `useState(new Set())` | `playerStore.downloading` |

### Dominio PLAYER REFS — **QUEDAN EN HOOKS** (no en store)
Refs de DOM, de proceso, de policy de audio. No son estado reactivo.

> **Nota histórica:** el hook `useAudioElementSync` que aparece abajo como destino nunca llegó a cablearse en producción y fue eliminado como código muerto. El adapter real al DOM es `runAudioEffects` (registrado vía `setPolicyEffectCtx`/`effectCtxRef` en `usePlaybackController` + handlers inline del `<audio>` en App.jsx). La tabla se conserva como registro del plan original.

| Ref | Destino |
|---|---|
| `audioRef`, `preloadAudioRef`, `preloadAudio2Ref` | `useAudioElementSync` |
| `objUrlRef`, `playErrorRef`, `consecutiveFailsRef`, `sustainedPlayRef` | `useAudioElementSync` |
| `playingRef`, `selfPauseRef`, `fadeRafRef`, `fadeSafetyRef`, `pendingFadeRef` | `useAudioElementSync` |
| `queueRef`, `trackRef`, `settingsRef` | `useAudioElementSync` (mirrors del store para acceso síncrono en handlers) |
| `sseRef` | **Retirado**: no hay suscripción SSE de handoff en el frontend |
| `sessionResumeRef`, `radioRef`, `radioSeedRef`, `mixSessionRef` | `usePlayerPersistence` |
| `homeRowsRef`, `libReadyRef`, `persistRef`, `pendingRef`, `resumedRef`, `playStatsRef` | `usePlayerPersistence` |
| `mountedAtRef`, `runningBundleRef`, `toastTimer`, `systemPausedRef` | App.jsx (UI lifecycle, no mover) |

### Dominio AUTH — **QUEDA EN APP** (5 estados)
| Estado | Motivo |
|---|---|
| `authed`, `email`, `displayName`, `avatar`, `backendDown` | El auth es cross-cutting pero su ciclo de vida es de la app, no del player. Moverlo es un refactor aparte. |

### Dominio LIBRARY — **NO EN ESTE REFACTOR** (9 estados)
| Estado | Motivo |
|---|---|
| `favs`, `playlists`, `recent`, `savedAlbums`, `savedPlaylists`, `homeRows`, `homeLoading`, `feedNonce`, `catVer` | Dominio separado del player. Sería un `libraryStore` en un futuro refactor. Por ahora siguen en App.jsx y se pasan como props nombradas a tabs que las necesitan. |

### Dominio UI — **QUEDA EN APP** (10 estados)
| Estado | Motivo |
|---|---|
| `tab`, `view`, `detailData`, `detailLoading`, `openPlaylist`, `playingFrom`, `selecting`, `selection`, `showQueue`, `expanded` (UI), `toast`, `showImport`, `importJob`, `installEvt`, `updateReady` | Estado de navegación/UI local. Moverlos a un store no aporta valor. |

## 2. Efectos (useEffect) — agrupados por hook destino

### `useAudioElementSync` — sync del `<audio>` con el store
> **Nota histórica:** este hook nunca se cableó y fue eliminado como código muerto; el sync real vive en `runAudioEffects` + handlers inline del `<audio>` en App.jsx.
- Líneas 1079 (volume), 1084 (src change), 1104 (play/pause), 1111 (playingRef mirror), 1161 (timeupdate), 1242 (ended), 1254 (error), 1289 (canplay), 1314 (sustained play check)
- Refs que managea: `audioRef`, `preloadAudioRef`, `objUrlRef`, `playErrorRef`, `fadeRafRef`, `playingRef`, `selfPauseRef`
- Expone: `dispatch(event)` que corre `audioMachine.reduce()` y aplica effects al DOM + store

### `useSSESession` — suscripción a eventos remotos (histórico)
- El handoff now-playing fue retirado del runtime; esta sección conserva el registro del diseño anterior.
- La telemetría `api.updateNowPlaying()` permanece disponible para compatibilidad de backend, pero no controla la UI ni la reproducción local.

### `usePlayerPersistence` — persistir estado a localStorage/DB
- Líneas 587, 599, 695, 748 (save player state + meta), 1001 (load profile)
- Refs que managea: `sessionResumeRef`, `radioRef`, `radioSeedRef`, `mixSessionRef`, `playStatsRef`
- Recibe: callbacks de `api.savePlayerState`, `api.saveMeta`

## 3. Estrategia de migración — sin breaking changes

El refactor se hace **sin romper la app en ningún momento**. La secuencia:

1. Crear `playerStore` con el estado del dominio player. App.jsx sincroniza su estado existente con el store (one-way: App.jsx lee del store en render).
2. Cada componente se migra individualmente: deja de leer de `ctx` y lee de `usePlayerStore(selector)`.
3. App.jsx deja de pasar esas props a componentes migrados.
4. Cuando todos los componentes del dominio player están migrados, App.jsx elimina los `useState` redundantes y queda como orquestador.
5. `ctx` se elimina cuando todos los componentes que lo usan (7) consumen de stores o props nombradas.

## 4. Scope de ESTE refactor

**Incluido:**
- Store del dominio PLAYER (Zustand + audioMachine)
- 3 hooks de efectos (audio sync, SSE, persistence)
- Refactor de 7 componentes que usan `ctx` → leen del store
- App.jsx baja de 2623 a target <1500 líneas (realista: 800 requiere también extraer library, fuera de scope)

**NO incluido (refactors futuros):**
- `libraryStore` para favs/playlists/recent (estado de biblioteca)
- `authStore` (auth y profile)
- Migración de `audioContinuity.js` a la máquina (ya está integrada vía adaptadores)
- Tests E2E (solo unit tests del store)

## 5. Dependencia nueva

**Zustand 5.x** — ~1.2 kB minified+gzip.
- Curva: 0 (API es `create(set => ...)`)
- Devtools: sí (`@redux-devtools/extension` o middleware propio)
- Compatibilidad con audioMachine.js: total (audioMachine es reduce puro, se llama dentro de acciones del store)

Justificación vs XState: XState añadiría 32 kB y obligaría a reescribir audioMachine.js (que ya está pagado y testeado). Zustand lo envuelve sin tocarlo.

## 6. Riesgo principal

El `audioMachine` emite `effects` que mutan React state vía `syncReact`. Ese patrón se rompe si el store y el `audioRef` no están sincronizados. Mitigación: un único adapter dispatcha eventos al machine y aplica effects al DOM. En la implementación final ese adapter es `runAudioEffects` (vía `setPolicyEffectCtx`/`effectCtxRef` en `usePlaybackController` + handlers inline del `<audio>` en App.jsx), no el `useAudioElementSync` planificado (eliminado como código muerto). Componentes solo leen estado, no dispatchan directo.

## 7. Criterio de éxito

- [x] ESLint pasa con 0 errors (PASO 1 — hecho en commit 49a7933)
- [ ] `npm run build` ≥ 67 módulos después de cada commit
- [ ] App.jsx < 1500 líneas (target aspiracional <800)
- [ ] 0 referencias a `ctx` en tabs/player/modals/layout/screens
- [ ] Tests del store: play, pause, next, prev, queue push (5 casos)
- [x] Handoff remoto `remotePlaying` retirado; `DeviceChip` sigue en `ExpandedPlayer`
- [ ] audioMachine.js sin modificar (regla MUST del prompt)
