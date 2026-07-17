# Trazabilidad de errores de audio (anti-regresión)

Documento vivo. **Antes de tocar reproducción en background**, lee esto y
actualiza la tabla si introduces un cambio.

## Comportamiento objetivo

| Escenario | Esperado |
|-----------|----------|
| Escuchar y **apagar pantalla** (Chrome) | Sigue la música si el SO no pausa; lock con play/pause/**prev/next** |
| Escuchar y **salir a inicio** | Idealmente sigue; si el SO corta, al volver reanuda |
| Abrir **vídeo Instagram/Facebook/YouTube** | Velocity **para**; el vídeo se oye **solo** (sin superposición) |
| Salir del vídeo / volver a Velocity | Reanuda **desde el segundo guardado** |
| Pausa manual del usuario | Se queda pausado; no auto-resume al volver |

## Historial de bugs (no reintroducir)

| ID | Síntoma | Causa raíz | Fix correcto | Anti-patrón |
|----|---------|------------|--------------|-------------|
| A1 | Chrome mata la sesión al cambiar de pista con pantalla off | `forceReacquire` / `load()` en background | Solo soft `play()` **si visible**; reacquire **solo visible** | `load()` o pause+load+play oculto |
| A2 | Notificación “playing” pero otra canción al sincronizar letras | (letras, no audio) lrclib fuzzy | Score artist/title | Tomar `arr[0]` de lrclib |
| A3 | Letra salta a otra canción al sync | Front reemplazaba plain por LRC ajeno | Overlap check | Blind replace |
| A4 | Tras vídeo, notificación cuenta segundos y al entrar rebobina | `playing=true` + no guardar posición | `yieldedFocus` + `interruptPosition` | Mantener playing sin ceder |
| A5 | Al salir de la app se queda **pausado** y hay que despausar a mano | Tratar todo pause-on-hide como yield y no reanudar al volver | Yield en hide + **tryResume al visible** | Soft-play en hide “por si acaso” |
| A6 | Pegado en el segundo N (playing sin avanzar) | Keep-alive creía `!paused` = OK; `restore` clavaba el ancla | Zombie check **solo visible** + restore **solo si rebobinó** | `restore` si `current≈saved` |
| A7 | **Superposición** música + vídeo IG/FB; vídeo muere ~2s | `play()` en background **tras ceder / recover** reclama el foco en Chrome | **Cero** `play()` oculto si `yieldedFocus`; yield al primer pause externo oculto. (Next en lock sin yield = A11, sí play) | Soft-recover / bucles de play ocultos **con yield** |
| A8 | Lock screen solo muestra pause (sin prev/next) al inicio | Media Session incompleta / handlers tardíos | Re-bind handlers + `setPositionState` al `playing` | No registrar next/prev hasta pause |
| A9 | Chrome background “a veces sí a veces no” | Política inconsistente + pelea de foco | Política de `audioContinuity.js` + tests | Parches ad-hoc por browser |
| A10 | Seek vuelve al min 2; pistas nuevas arrancan a mitad; next en lock no suena | Ancla de yield se guardaba en play normal y se restauraba siempre; `playSync` bloqueaba todo play oculto | Ancla **solo al yield**, scoped a trackId; restore solo si `yieldedFocus`; soft-play oculto si **no** yielded (next lock) | `restore` en cada `onPlay`; `savePlaybackAnchor` continuo; noop en todo hide |
| A11 | Next en notificación/lock no cambia de canción | `playSyncStrategy` hacía `noop` si hidden aunque el usuario pidiera next | soft-play si `playing && !yieldedFocus` aunque hidden; handlers MS vía refs | Bloquear todo `play()` con `document.hidden` |
| A12 | Reabro la app: UI en 0:50 pausado, play reinicia a 0:00 | `resumeRef` se aplicaba una vez y se perdía al re-firmar URL; play no seek-eaba | `sessionResumeRef` {trackId,position}; apply en metadata/canplay/play/togglePlay | Borrar resume al primer metadata; no seek al play |
| A13 | Reabro: UI “sonando” sin audio; pause → loading infinito | URL firmada caducada → `error` → `handleAudioError` llama `play()` → `onPlay` fuerza `playing=true` | No restaurar URL stale; error sin auto-play si `!playingRef`; togglePlay re-firma; onPlay no promueve playing | Restaurar `track.url` caducado; recovery con play automático |
| A14 | Notificación "playing" pero silencio total en background (zombie) | `mediaSessionPlaybackState` mintió `'playing'` cuando el elemento estaba yielded/pausado + `scheduleBackgroundResume` + watchdog hacían play() oculto que resolvía pero Chrome descartaba la salida de audio | MS honesto (paused al yield), `isAudioPipelineDead` → `PIPELINE_DEAD` → yield con ancla; recovery solo en `DOC_VISIBLE` | `play()` oculto tras yield; watchdog que asume play()=audible; mentir al OS sobre playbackState |

## Política actual (código) — máquina de estados (2026-07-17)

| Capa | Archivo | Rol |
|------|---------|-----|
| Predicados | `frontend/src/audioContinuity.js` | Reglas puras A7–A14 (incluye `isAudioPipelineDead`) |
| **Reduce** | `frontend/src/audio/audioMachine.js` | `reduce(state, event) → { state, effects }` |
| Effects | `frontend/src/audio/runAudioEffects.js` | Solo DOM/React/red (sin política) |
| Adapter | `App.jsx` | `dispatchAudio` + espejos; **no** ifs de yield/seek sueltos |

```text
evento → dispatchAudio → reduce → runAudioEffects
```

1. **Hide + sigue `!paused`** → no tocar (pantalla off / Media Session).
2. **Hide + pause externo** → `EXTERNAL_PAUSE` → focus `yielded` (sin soft-recover).
3. **`selectPlaySync`**: `noop` oculto solo si yielded; next lock sin yield → soft-play.
4. **Ancla (A10)**: solo en yield; limpia en `USER_SEEK` / `TRACK_SET`.
5. **Sesión (A12)**: `HYDRATE` + `USER_PLAY` / `STREAM_READY` seek a `sessionPosition`.
6. **URL (A13)**: no montar `playSrc` caducado; `PLAY_FAILED` sin intent → clearSrc, no play.
7. **Visible + intent play** → `DOC_VISIBLE` (seek ancla si yield, play).
8. **SW**: invalidar shell al cambiar audio (`velocity-vN`).
9. **Zombie (A14)**: `isAudioPipelineDead` (stall + buffer + readyState) en background → `PIPELINE_DEAD` → yield honesto; recovery solo en visible.

### Por qué Brave “iba bien” y Chrome no

Chrome reclama el audio focus al siguiente `HTMLMediaElement.play()` aunque la pestaña
esté en background. Un recover “suave” a 0–200 ms tras el pause del SO es suficiente
para matar el vídeo de Instagram y dejar solo Velocity. Brave cede mejor el foco;
el fix es no pelear en Chrome, no detectar el browser.

## Tests obligatorios

```bash
node --test test/audioContinuity.test.js test/audioPolicyMatrix.test.js test/audioMachine.test.js test/runAudioEffects.test.js
node --test
cd frontend && npm run build
```

| Archivo | Qué prueba |
|---------|------------|
| `audioContinuity.test.js` | Helpers A7–A13 |
| `audioPolicyMatrix.test.js` | Escenarios cruzados (no romper A al fix B) |
| `audioMachine.test.js` | Transiciones `reduce` |
| `runAudioEffects.test.js` | Runner sin política |

## Checklist manual (Chrome Android primero)

- [ ] Play → apagar pantalla 30s → sigue (si el SO no corta) + lock con prev/next
- [ ] Play → ir a inicio 20s → audio o reanuda al volver
- [ ] Play → **Instagram/Facebook** vídeo con sonido → **solo** el vídeo (sin música encima, sin cortar el vídeo a los 2s)
- [ ] Salir del vídeo / volver a Velocity → reanuda en el mismo segundo
- [ ] Pausa manual → ir a IG → volver → **sigue pausado**
- [ ] Dejar canción a mitad → cerrar app del todo → reabrir → play → **sigue en el mismo segundo** (no 0:00)

## Al cambiar código de audio

1. Preferir cambiar **`audioMachine.js` / `audioContinuity.js`**, no ifs en App.
2. Actualiza esta tabla si aparece un bug nuevo (A14…).
3. Test unitario + fila en `audioPolicyMatrix.test.js` + transición en `audioMachine.test.js`.
4. **No** soft-recover en hide ni `play()` oculto con focus yielded.
5. SW bump (`velocity-vN`).
6. `node --test` + build + checklist Chrome.

## Matriz mental (no romper al “arreglar”)

| Quieres… | No toques… | Helper |
|----------|------------|--------|
| Parar superposición IG | next en lock, autoplay hide | `playSyncStrategy` + `yieldedFocus` |
| Next en notificación | yield a IG (no quitar `yieldedFocus` check) | A11 vs A7 |
| Seek libre / pista desde 0 | ancla de yield aplicada siempre | `canRestoreInterruptPosition` |
| Resume al reabrir app | ancla de yield / URL caducada | `shouldApplySessionResume` + `isStreamUrlFresh` |
| UI pausada al reabrir | auto-`play()` en `handleAudioError` | `playingRef` gate (A13) |
