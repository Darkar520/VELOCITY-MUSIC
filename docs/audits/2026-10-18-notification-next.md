# Next desde notificación: pausa y posición de otra pista

## Causa reproducida

`pause()` entrega el evento en una tarea posterior. `play()`/`hardStopAudio`
marcaban `selfPauseRef=true` solo durante la llamada síncrona. Al llegar
`onPause`, TRACK_SET ya había seleccionado la siguiente pista, eliminado el
atributo src y reiniciado su posición, pero el elemento conservaba currentSrc
y currentTime del recurso anterior. En segundo plano, ese pause se interpretaba
como EXTERNAL_PAUSE, cedía el foco y guardaba el tiempo anterior bajo el ID nuevo.
STREAM_READY respetaba el yield y no iniciaba audio. DOC_VISIBLE podía restaurar
ese ancla en la nueva pista. Un timeupdate residual también publicaba el reloj viejo.

## Implementación 3.24 / worker v95

El adaptador de eventos nativos comprueba propiedad del recurso: srcStatus ready,
atributo src no vacío, readyState distinto de HAVE_NOTHING y currentSrc coincidente
con la URL absoluta del atributo. Se aplica a reloj, metadata, canplay, play,
playing, pause y ended; pause exige paused, ended exige ended. No se identifica un
recurso mediante el ID nuevo de React mientras el DOM aún describe el anterior.

Como defensa de política, EXTERNAL_PAUSE con srcStatus none no cede el foco y
DOC_HIDDEN solo recoge posición de una fuente ready. Las interrupciones de una
fuente cargada siguen cediendo, sin reclamar foco oculto. No hay reintentos nuevos,
modificaciones de descargas ni ajustes específicos de navegador.

## Resultados y controles

- Dos regresiones del hook fallaron antes del cambio: EXTERNAL_PAUSE oculto
  con posición 42 de la anterior; publicación del reloj 42 durante TRACK_SET.
- Control nativo Brave/Windows: archivo WAV sintético de 12 segundos, posición
  previa 7 segundos, fuente nueva diferida 120 ms, handler nexttrack registrado
  por useMediaSession, useAudioElement y máquina reales. La visibilidad oculta
  se simula; no es una prueba de bloqueo físico Android.
- Código anterior: siguiente track-2 con focus yielded, paused true,
  livePosition 7. La secuencia registró TRACK_SET -> EXTERNAL_PAUSE -> STREAM_READY.
- Código corregido: seis avances visibles y seis con política oculta; en los
  seis ocultos, paused false, focus own, reloj aproximadamente 1.1–1.4 segundos
  que avanzó a 1.5–1.7 segundos en la segunda muestra. Posición inicial PLAYING
  próxima a cero; no heredó los 7 segundos previos. Es el mismo WAV reutilizado,
  no doce canciones de catálogo ni una medición de salida acústica.
- Controles negativos: fuente vacía, fuente aún cargando y currentSrc anterior
  se ignoran; una pausa externa real de fuente cargada sigue despachándose.
- Node: 462 pruebas, cero fallos. Frontend: 559 pruebas en 48 archivos, cero
  fallos. Build y lint de errores aprobados. Los dos tests previos de ended
  ahora simulan readyState=4 y ended=true, además de emitir el evento.

Artefactos locales ignorados: `test-results/notification-next-20261018/` contiene
`native-hidden-before.json` y `native-hidden-fixed.json`. Harness reproducible
de esta sesión: `frontend/test-results/notification-next{,-before}.{html,jsx}`.
Pendiente: confirmación desde el control real de la notificación de Samsung/Brave.
