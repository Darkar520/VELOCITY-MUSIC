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

## Política actual (código)

Archivo: `frontend/src/audioContinuity.js` + `App.jsx`.

1. **Hide + sigue `!paused`** → no tocar (mejor caso pantalla off / Media Session).
2. **Hide + `pause` externo** → **`yieldAudioFocus`** (ancla + trackId). Sin soft-recover.
3. **`playSyncStrategy`**: `noop` oculto **solo si** `yieldedFocus`. Si no yielded (next/autoplay) → `soft-play` aunque hidden.
4. **Ancla (A10)**: guardar solo al yield; limpiar en `play()` / `seek` / next / prev; restore solo con `canRestoreInterruptPosition({ yieldedFocus: true, ... })`.
5. **Sesión (A12)**: `velocity.player.t` + trackId; al reabrir, seek al segundo guardado en la **misma** pista al play/metadata. Limpiar en seek/next/pista nueva.
6. **URL (A13)**: no montar `playSrc` caducado; al reabrir `playing=false` y sin auto-play; play del usuario re-firma stream.
7. **Visible + intención play** → `tryResume` si hace falta.
8. **Foreground** pause residual → `softKickPlayback` sin tocar ancla de yield.

### Por qué Brave “iba bien” y Chrome no

Chrome reclama el audio focus al siguiente `HTMLMediaElement.play()` aunque la pestaña
esté en background. Un recover “suave” a 0–200 ms tras el pause del SO es suficiente
para matar el vídeo de Instagram y dejar solo Velocity. Brave cede mejor el foco;
el fix es no pelear en Chrome, no detectar el browser.

## Tests obligatorios

```bash
node --test test/audioContinuity.test.js test/audioPolicyMatrix.test.js
```

- `audioContinuity.test.js`: unidades por helper (A7, A10–A13, …).
- `audioPolicyMatrix.test.js`: **matriz cruzada** — un fix no puede romper otro
  escenario sin fallar el CI. Actualizar matriz + esta tabla en el mismo commit.

Cubren: play oculto solo sin yield, yield al pause oculto, MS paused al ceder,
ancla solo con yield, sesión por trackId, URL firmada fresca, sin hide-recover.

## Checklist manual (Chrome Android primero)

- [ ] Play → apagar pantalla 30s → sigue (si el SO no corta) + lock con prev/next
- [ ] Play → ir a inicio 20s → audio o reanuda al volver
- [ ] Play → **Instagram/Facebook** vídeo con sonido → **solo** el vídeo (sin música encima, sin cortar el vídeo a los 2s)
- [ ] Salir del vídeo / volver a Velocity → reanuda en el mismo segundo
- [ ] Pausa manual → ir a IG → volver → **sigue pausado**
- [ ] Dejar canción a mitad → cerrar app del todo → reabrir → play → **sigue en el mismo segundo** (no 0:00)

## Al cambiar código de audio

1. Actualiza esta tabla si aparece un bug nuevo.
2. Añade un test unitario **y** una fila en `audioPolicyMatrix.test.js` que falle sin el fix.
3. **No reintroduzcas** timers de soft-recover en hide ni `play()` oculto con `yieldedFocus`.
4. Sube versión del service worker (`velocity-vN`) para invalidar caché del shell.
5. Antes de merge: `node --test` (suite completa) + checklist manual Chrome.

## Matriz mental (no romper al “arreglar”)

| Quieres… | No toques… | Helper |
|----------|------------|--------|
| Parar superposición IG | next en lock, autoplay hide | `playSyncStrategy` + `yieldedFocus` |
| Next en notificación | yield a IG (no quitar `yieldedFocus` check) | A11 vs A7 |
| Seek libre / pista desde 0 | ancla de yield aplicada siempre | `canRestoreInterruptPosition` |
| Resume al reabrir app | ancla de yield / URL caducada | `shouldApplySessionResume` + `isStreamUrlFresh` |
| UI pausada al reabrir | auto-`play()` en `handleAudioError` | `playingRef` gate (A13) |
