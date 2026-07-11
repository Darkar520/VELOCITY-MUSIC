# Plan — Máquina de estados de audio (dispatch único)

**Fecha:** 2026-07-11  
**Prioridad:** Antes de partir `App.jsx` (P1-E)  
**Relación:** Continúa A7–A13 + `audioPolicyMatrix`; desbloquea modularización segura  
**No es:** XState, Redux, ni rewrite del reproductor UI  

---

## 0. Orden de trabajo (decisión)

| Orden | Trabajo | Por qué |
|-------|---------|---------|
| **1 (ahora)** | Máquina de estados de audio | Concentra la lógica que causa regresiones (play/yield/seek/resume/URL) |
| **2** | Partir `App.jsx` (P1 **E**, no C) | Con FSM hecha, los módulos son adaptadores finos; si se parte antes, se **dispersa** el caos |
| **3** | Deferidos P1 C/D (guest spam, httpOnly) | Independientes del audio; no bloquean UX de reproducción |
| **P0 semana 1** | Ya ejecutado en gran parte | No reabrir salvo checklist residual en `2026-07-10-security-p0-week1.md` |

**Nota de nomenclatura (P1 design):**  
- **C** = guest spam  
- **D** = httpOnly cookies  
- **E** = split de `App.jsx`  

Lo que quieres (“partir App.jsx”) es **E**. Este plan es el prerequisito de **E**.

---

## 1. Objetivo

Un solo punto de decisión:

```text
estado + evento  →  reduce()  →  { nextState, effects[] }
App.jsx solo: dispatch(event) y ejecutar effects
```

- **Pure:** `reduce` sin DOM, sin React, sin `fetch`.  
- **Testeable:** cada bug A7–A13 = transición en tests (matriz ampliada).  
- **Fino:** no reimplementar Media Session, firmas ni UI; solo **política de reproducción**.

### Éxito

| Criterio | Evidencia |
|----------|-----------|
| App no decide yield/play/seek con ifs dispersos | `grep` en `App.jsx`: cero `yieldAudioFocus` / `applySessionResume` sueltos; solo `dispatch` + runner de effects |
| Matriz A7–A13 sigue verde + transiciones nuevas | `node --test test/audio*.test.js` |
| Suite completa verde | `node --test` |
| Build OK | `cd frontend && npm run build` |
| Checklist manual Chrome sin regresión | docs/AUDIO-REGRESSIONS.md |

### No-objetivos

- Extraer playlists, feed, lyrics, auth de `App.jsx` (eso es **P1-E**, fase 2).  
- Librería externa de state machines.  
- Cambiar API de stream / backend.  
- Perfecta continuidad bajo Instagram (ceder es correcto).

---

## 2. Diseño (mínimo suficiente)

### 2.1 Estado (serializable, plano)

```js
// frontend/src/audio/audioMachine.js  (nuevo)
{
  // Intención del usuario (no el elemento HTML)
  intent: 'play' | 'pause',

  // Foco de altavoz
  focus: 'own' | 'yielded',

  // Pista actual (id o null)
  trackId: string | null,

  // Posiciones (segundos); null = no aplica
  livePosition: number,          // último known-good
  sessionPosition: number | null, // A12: al reabrir app
  yieldPosition: number | null,   // A10: solo tras yield
  yieldTrackId: string | null,

  // Fuente
  srcStatus: 'none' | 'ready' | 'stale',
}
```

Helpers existentes en `audioContinuity.js` se **reutilizan** dentro de `reduce` / selectores (no duplicar reglas).

### 2.2 Eventos (cerrados; ampliar solo con test)

| Evento | Origen típico |
|--------|----------------|
| `TRACK_SET` | `play(track)` — pista nueva (limpia sesión/ancla) |
| `USER_PLAY` | toggle / Media Session play |
| `USER_PAUSE` | toggle / Media Session pause |
| `USER_SEEK` | seek UI / MS seekto |
| `USER_NEXT` / `USER_PREV` | next/prev / MS |
| `DOC_HIDDEN` / `DOC_VISIBLE` | visibilitychange |
| `EXTERNAL_PAUSE` | `onPause` externo |
| `PLAYING` | `onPlaying` (audio arrancó de verdad) |
| `PLAY_FAILED` | play() reject / error con intent play |
| `STREAM_READY` | ensureStreamUrl OK `{ url, trackId }` |
| `STREAM_STALE` | URL caducada detectada |
| `ENDED` | onEnded |
| `HYDRATE` | loadPlayerState al boot `{ trackId, position, urlFresh }` |

### 2.3 Effects (imperativos; App los ejecuta)

Lista cerrada; el runner no inventa lógica:

| Effect | Acción App |
|--------|------------|
| `{ type: 'play' }` | `audio.play()` |
| `{ type: 'pause', self: true }` | selfPause + `audio.pause()` |
| `{ type: 'seek', position }` | `audio.currentTime = position` |
| `{ type: 'setSrc', url }` | `setPlaySrc(url)` |
| `{ type: 'clearSrc' }` | `setPlaySrc(null)` |
| `{ type: 'ensureStream', trackId }` | `ensureStreamUrl` → `dispatch(STREAM_READY\|FAILED)` |
| `{ type: 'mediaSession', state, position? }` | MS playbackState / position |
| `{ type: 'syncReact', patch }` | `setPlaying` / `setTime` / `setLoadingAudio` |
| `{ type: 'toast', message }` | showToast |

**Regla de oro:** ningún effect decide política; solo el `reduce`.

### 2.4 Transiciones clave (contrato anti-regresión)

| Situación | Evento | intent | focus | Effects esperados |
|-----------|--------|--------|-------|-------------------|
| IG toma audio (hidden) | `EXTERNAL_PAUSE` | play | → yielded | pause self, MS paused, guardar yieldPosition |
| Next en lock | `USER_NEXT` + `TRACK_SET` + `STREAM_READY` | play | own | setSrc, seek 0, play (aunque hidden) |
| Yielded + hidden + soft tick | (ningún tick) | play | yielded | **ningún** `play` |
| Yielded + visible | `DOC_VISIBLE` | play | → own | seek yieldPosition si rebobinó, play |
| Reabrir app | `HYDRATE` | pause | own | no play; sessionPosition set; clearSrc si stale |
| USER_PLAY post hydrate | `USER_PLAY` | play | own | ensureStream → STREAM_READY → seek session → play |
| Seek usuario | `USER_SEEK` | — | — | clear yield+session anchors; seek |
| Error sin intent play | `PLAY_FAILED` / error | pause | — | clearSrc si stale; **no** play |

Estas filas van a `test/audioMachine.test.js` (+ seguir cubriendo matriz pura).

---

## 3. Archivos

| Archivo | Rol |
|---------|-----|
| `frontend/src/audio/audioMachine.js` | `initialState`, `reduce(state, event) → { state, effects }` |
| `frontend/src/audio/audioEffects.js` | opcional: tipos JSDoc de effects (sin runtime) |
| `frontend/src/audioContinuity.js` | **se mantiene**; predicados puros usados por reduce |
| `test/audioMachine.test.js` | transiciones (A7–A13 como escenarios) |
| `test/audioPolicyMatrix.test.js` | se mantiene / se alinea con reduce |
| `frontend/src/App.jsx` | adapter: refs del audio + `dispatch` + `runEffects` |
| `docs/AUDIO-REGRESSIONS.md` | sección “Audio machine” + IDs |
| `docs/GUARDRAILS.md` | §3: política solo vía machine |

**No** crear carpeta de 15 archivos. Máximo 2 módulos nuevos + tests.

---

## 4. Fases de implementación

### Fase 0 — Baseline (30 min)

1. `node --test` verde (181+).  
2. Congelar checklist manual actual.  
3. Branch: `feat/audio-machine` (o trabajo en `main` si preferís commits atómicos cortos).

### Fase 1 — Machine pura + tests (sin tocar App) ✅ 2026-07-11

1. ✅ `frontend/src/audio/audioMachine.js` — `initialState`, `reduce`, `selectPlaySync`
2. ✅ `test/audioMachine.test.js` — TDD red→green (A7, A10–A13, hydrate, seek, MS)
3. ✅ Reutiliza predicados de `audioContinuity.js`
4. ✅ DoD: machine + matriz verdes; **App.jsx aún no migrado** (Fase 2)

### Fase 2 — Adapter mínimo en App (un camino a la vez)

Orden de migración (un PR lógico / un commit por camino):

1. **Boot:** `HYDRATE` sustituye init de `sessionResumeRef` + playSrc stale.  
2. **USER_PLAY / USER_PAUSE** (`togglePlay`).  
3. **EXTERNAL_PAUSE + DOC_HIDDEN/VISIBLE** (yield / tryResume).  
4. **TRACK_SET + NEXT/PREV**.  
5. **onPlaying / onError / ENDED**.  
6. **Media Session handlers** → solo `dispatch`.

En cada paso: borrar el if-spaghetti equivalente; no dejar dos dueños de la misma decisión.

**DoD Fase 2:**  
- `grep` sin `systemPausedRef` / `sessionResumeRef` como fuente de verdad (pueden existir solo como cache de UI si hace falta, pero el dueño es `machineState`).  
- Suite completa + build verdes.  
- Checklist A7, A10, A11, A12, A13 manual en Chrome.

### Fase 3 — Limpieza

1. Eliminar dead code (`hideRecoverDelays` legacy si ya no se importa).  
2. SW bump.  
3. Actualizar AUDIO-REGRESSIONS + GUARDRAILS.  
4. Merge.

### Fase 4 — Después (P1-E split App.jsx) — **otro plan, no este**

Solo cuando la machine esté estable:

| Módulo | Contenido |
|--------|-----------|
| `audio/AudioHost.jsx` o hook `useAudioEngine` | audio element + dispatch + effects runner |
| `player/*` | MiniPlayer, ExpandedPlayer (ya parcialmente en App) |
| `auth/*`, `library/*`, `feed/*` | según cortes naturales |

El split **no** mueve política de audio: solo mueve UI y wiring.

---

## 5. Esqueleto del reduce (referencia, no copy-paste ciego)

```js
export function reduce(state, event) {
  const effects = [];
  let next = state;

  switch (event.type) {
    case 'USER_PAUSE':
      next = { ...state, intent: 'pause', focus: 'own', yieldPosition: null, yieldTrackId: null };
      effects.push({ type: 'pause', self: true });
      effects.push({ type: 'mediaSession', state: 'paused' });
      effects.push({ type: 'syncReact', patch: { playing: false, loadingAudio: false } });
      break;

    case 'EXTERNAL_PAUSE':
      if (event.hidden && state.intent === 'play' && state.focus !== 'yielded' && !event.selfPause) {
        next = {
          ...state,
          focus: 'yielded',
          yieldPosition: event.position ?? state.livePosition,
          yieldTrackId: state.trackId,
        };
        effects.push({ type: 'pause', self: true });
        effects.push({ type: 'mediaSession', state: 'paused', position: next.yieldPosition });
        effects.push({ type: 'syncReact', patch: { mediaInterrupted: true } });
      }
      // visible + intent play → effect softKick lo decide el adapter solo si reduce emite 'play'
      break;

    // ... resto de eventos en implementación
    default:
      break;
  }

  return { state: next, effects };
}
```

App:

```js
const dispatch = (event) => {
  const { state, effects } = reduce(machineRef.current, event);
  machineRef.current = state;
  runEffects(effects);
};
```

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Doble dueño (machine + refs viejos) | Migrar por evento; borrar código viejo en el mismo commit |
| Effects async (ensureStream) | Solo via effect `ensureStream` → re-`dispatch`; no await dentro de reduce |
| Regresión Chrome | Checklist manual por fase 2; no merge sin A7+A11+A12+A13 |
| Scope creep split App | Fase 4 fuera de este plan |

---

## 7. Checklist de cierre de este plan

- [ ] `audioMachine.js` + `reduce` + tests de transición  
- [ ] App cableada solo por `dispatch` / `runEffects` en caminos de audio  
- [ ] `node --test` 100%  
- [ ] `frontend` build OK  
- [ ] SW bump  
- [ ] AUDIO-REGRESSIONS actualizado  
- [ ] Checklist manual Chrome (tabla A7–A13)  
- [ ] Plan P1-E (split) abierto como **siguiente** documento, no mezclado aquí  

---

## 8. Relación con planes previos

| Plan | Estado | Acción |
|------|--------|--------|
| `2026-07-10-security-p0-week1.md` | Mayoría hecha | No bloquea; residual ops/rotación aparte |
| `2026-07-10-p1-audio-covers.md` | A+B hechos | Continuidad evoluciona a **esta machine** |
| P1 design deferred **E** App split | Pendiente | **Después** de este plan |
| P1 deferred **C/D** | Pendiente | Después o en paralelo a E, no antes de machine |

---

## 9. Estimación realista

| Fase | Esfuerzo |
|------|----------|
| 0–1 Machine + tests | ~0.5–1 día |
| 2 Adapter App (por caminos) | ~1–2 días |
| 3 Limpieza + verify | ~0.5 día |
| **Total** | **~2–3.5 días** enfocados |

No paralelizar con split de App.jsx.
