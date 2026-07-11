# Trazabilidad de errores de audio (anti-regresión)

Documento vivo. **Antes de tocar reproducción en background**, lee esto y
actualiza la tabla si introduces un cambio.

## Comportamiento objetivo

| Escenario | Esperado |
|-----------|----------|
| Escuchar y **apagar pantalla** (Chrome) | Sigue la música; lock screen con play/pause/**prev/next** |
| Escuchar y **salir a inicio** | Idealmente sigue; si el SO corta, al volver reanuda |
| Abrir **vídeo Facebook/YouTube** | Velocity **para**; el vídeo se oye **solo** (sin superposición) |
| Salir del vídeo / volver a Velocity | Reanuda **desde el segundo guardado** |
| Pausa manual del usuario | Se queda pausado; no auto-resume al volver |

## Historial de bugs (no reintroducir)

| ID | Síntoma | Causa raíz | Fix correcto | Anti-patrón |
|----|---------|------------|--------------|-------------|
| A1 | Chrome mata la sesión al cambiar de pista con pantalla off | `forceReacquire` / `load()` en background | Solo soft `play()`; reacquire **solo visible** | `load()` o pause+load+play oculto |
| A2 | Notificación “playing” pero otra canción al sincronizar letras | (letras, no audio) lrclib fuzzy | Score artist/title | Tomar `arr[0]` de lrclib |
| A3 | Letra salta a otra canción al sync | Front reemplazaba plain por LRC ajeno | Overlap check | Blind replace |
| A4 | Tras vídeo, notificación cuenta segundos y al entrar rebobina | `playing=true` + no guardar posición | `yieldedFocus` + `interruptPosition` | Mantener playing sin ceder |
| A5 | Al salir de la app se queda **pausado** y hay que despausar a mano | Tratar todo pause-on-hide como yield inmediato | Soft recover 1–2 veces | Yield al primer pause siempre |
| A6 | Pegado en el segundo N (playing sin avanzar) | Keep-alive creía `!paused` = OK; `restore` clavaba el ancla | Zombie check + restore **solo si rebobinó** | `restore` si `current≈saved` |
| A7 | **Superposición** música + vídeo FB / vídeo sin sonido | Bucle de `play()` en background cada 1s robaba el foco | **Ceder** si re-pause en <1.6s tras soft-play; sin bucles | Interval/`play()` agresivo en hide |
| A8 | Lock screen solo muestra pause (sin prev/next) al inicio | Media Session incompleta / handlers tardíos | Re-bind handlers + `setPositionState` al `playing` | No registrar next/prev hasta pause |
| A9 | Chrome background “a veces sí a veces no” | Política inconsistente + pelea de foco | Política A/B/C de `audioContinuity.js` + tests | Parches ad-hoc por browser |

## Política actual (código)

Archivo: `frontend/src/audioContinuity.js` + lógica en `App.jsx`.

1. **Hide + sigue `!paused`** → no tocar (mejor caso pantalla off).
2. **Hide + `pause` externo** → `recoverAfterHide` (delays cortos: 0, 200 ms).
3. **Soft-play OK y luego `pause` otra vez en <1600 ms (oculto)** → **`yieldAudioFocus`** (FB/YT).  
   No más `play()` hasta `visibility=visible`.
4. **Visible + intención play** → `tryResume` desde ancla.
5. **`shouldRestoreInterruptPosition`**: solo si `currentTime < saved - 1.25s`.

## Tests obligatorios

```bash
node --test test/audioContinuity.test.js
```

Cubren: soft-play strategy, yield on re-pause, media session paused al ceder,
restore solo si rebobinó, no pelear tras ceder.

## Checklist manual (Chrome Android primero)

- [ ] Play → apagar pantalla 30s → sigue + lock con prev/next
- [ ] Play → ir a inicio 20s → audio o reanuda al volver
- [ ] Play → Facebook vídeo con sonido → **solo** el vídeo (sin música encima)
- [ ] Salir del vídeo / volver a Velocity → reanuda en el mismo segundo
- [ ] Pausa manual → ir a FB → volver → **sigue pausado**

## Al cambiar código de audio

1. Actualiza esta tabla si aparece un bug nuevo.
2. Añade un test en `test/audioContinuity.test.js` que falle sin el fix.
3. No reintroduzcas intervalos de `play()` en background.
