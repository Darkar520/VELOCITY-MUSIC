# Auditoría de descargas PWA — evidencia final

## Estado final (sustituye los estados intermedios de abajo)

El usuario eligió mantener la PWA: continuidad con Background Fetch donde el
navegador realmente la permite y conservación/reanudación al volver en las
demás plataformas. Versión 3.16, worker velocity-v87. No se promete ejecución
universal después de que cualquier sistema operativo cierre el navegador.

CI del commit c713a750e44fdbbc41387ce5554c2b16b9a2e40d confirmó 445 pruebas
Node y 485 frontend en 40 archivos, cero fallos; build, lints, Quality Gate y
CodeQL correctos. Run:
https://github.com/Darkar520/VELOCITY-MUSIC/actions/runs/39067562958
La auditoría de dependencias es advisory: su estado verde no equivale a cero CVEs.

La repetición final en Brave con el protocolo v2 cerró la página antes del
primer guardado. Se inspeccionó luego únicamente el manifest, sin ejecutar
React: nueve canciones, 32.214.219 bytes, cola y gestor nativo vacíos; último
guardado a 14.018 ms del inicio. Confirma que el monitor nuevo no obliga a
mantener la página abierta. La fuente estaba caliente; no es una comparación
causal con el primer ensayo en frío.

También se recuperaron las nueve canciones del navegador integrado detenido:
archivos completos, cola vacía y UI Descargado. Las regresiones incluyen la
reconexión durante un intento activo y el render de mezclas sin label. Las
capturas finales son background-completed.png y recovered-queue.png dentro de
test-results/download-audit. Las propiedades temporales de visibilidad de
staging se retiraron después de la prueba.

Los modelos cubren 350 tareas; las pruebas reales utilizan nueve canciones.
No se verificaron físicamente iPhone/Android bloqueados ni televisores. En
plataformas que suspenden la PWA se conservan los archivos completos; la
canción parcial de primer plano se reinicia desde cero al volver. Forzar el
cierre del navegador puede detener incluso sus transferencias nativas. Los
bloqueos externos de acceso al proveedor siguen siendo bloqueos externos.

La comparación controlada observó 28,5 % menos tiempo medio con bytes idénticos
en tres archivos; no estima una distribución ni garantiza ese porcentaje para
una lista pública de 350 pistas. No se transcodifica ni se reduce la calidad.

PR preparado para integración después del gate final:
https://github.com/Darkar520/VELOCITY-MUSIC/pull/33

## Registro cronológico de diagnóstico y verificación

## Alcance y estado

Objetivo: acelerar canciones y listas de unas 350 pistas manteniendo el audio
original, conservar la cola y continuar al cambiar de app, bloquear o cerrar la
PWA. El usuario confirmó que incluye Android, iPhone, laptop, tablet y TV.

**El objetivo completo sigue abierto; los cambios se preparan para revisión.** La compatibilidad de una
API no demuestra que el dispositivo complete una transferencia cerrada la app.

## Defectos reproducidos antes de corregir

Tres pruebas nuevas fallaron contra la implementación anterior:

- Un ID repetido tres veces ocasionó tres guardados del mismo audio.
- Dos pulsaciones antes de otro render ocasionaron dos guardados.
- Una descarga individual fallida desapareció de pendientes.

Los tres casos pasan con la cola nueva. Las listas y canciones comparten ocho
slots de trabajo y cuatro de preparación; ya no hay otro recorrido completo de
prefetch del catálogo compitiendo con las preparaciones de las descargas.
Solo se invalida la preparación de la canción que se reintenta. Se verifica el
Content-Length cuando existe y se rechazan cuerpos vacíos o no musicales.
Las carátulas se completan después del audio, sin bloquear su guardado.

## Segundo plano: intervención y prueba negativa

Una primera variante pretendía registrar lotes sucesivos de ocho peticiones
desde el Service Worker. Pasó el modelo simulado y falló en Chromium 155 real
con NotAllowedError. Se sustituyó antes de publicar: la página registra todas
las peticiones de la lista con Background Fetch; el worker solo guarda los
resultados y nunca inicia nuevas descargas. La concurrencia de ese transporte
la administra el navegador.

La restricción existe en Chromium desde la política de Chrome 149:
https://chromium.googlesource.com/chromium/src/+/40b33139e0..328bcb443d

La cola persistente `velocity-downloads/jobs` guarda metadata, calidad, estado
y URLs firmadas HMAC; no guarda tokens Bearer. El audio se escribe en los stores
existentes de `velocity-offline` v3, sin borrar las descargas anteriores.

El modelo final comprueba 350 respuestas, reemplazo del worker, contenido
inalterado mediante SHA-256, respuestas parciales o HTML, errores de cuota,
cancelación y limpieza durante una transferencia. El cliente comprueba que se
entregan las 350 peticiones en una sola operación del navegador y como máximo
se firman cuatro a la vez. No son 350 canciones descargadas de la red real.

## Observaciones reales en staging

Datos aislados: `data-staging/download-audit-20261017`, backend 3001, preview
4173 con VITE_API=http://127.0.0.1:3001. No se modificó la biblioteca real.

En primer plano se guardaron nueve canciones reales, 32.214.219 bytes, en
23.735 ms hasta el último commit de audio. Primer commit a 8.737 ms. Es una
sola muestra local, incluye resoluciones frías y no demuestra una mejora de
velocidad frente a la versión anterior ni permite proyectar 350 canciones.

En otro origen (`localhost:4173`) se pulsó Descargar, se observaron nueve jobs
background y una inscripción nativa; cero canciones guardadas a los 627 ms.
Se cerró la pestaña. Después se inspeccionó únicamente el manifest, sin ejecutar
React: seguían cero archivos y la inscripción reportaba cero bytes, sin error.
El permiso background-fetch figuraba granted. **Esta prueba no pasó.**

Se abrió después una sesión aislada equivalente en Brave, se entregaron nueve
peticiones y se cerró la pestaña con cero archivos guardados. La inspección de
esa sesión sigue pendiente: la automatización de la pestaña de inspección
agotó el tiempo y posteriormente notificó Debugger unattached. No se cambió la
configuración de seguridad ni se tomó el timeout como prueba de fallo del audio.

## Verificación y pendientes

- Pruebas específicas finales: 7 Node y 23 frontend, cero fallos.
- Gate repetido sin ejecutar ambas suites simultáneamente: 443 pruebas Node,
  cero fallos; build correcto. Frontend completo con dos workers en ejecución
  al registrar este estado. Lint backend y frontend sin errores.
- La primera ejecución simultánea produjo dos fallos de deadlines pequeños en
  streamProxy y cuatro fallos de frontend (tres timeouts y un seek). No se
  relajaron las aserciones. Se debe conservar el resultado de la repetición.
- Falta demostrar transferencia y guardado con la página cerrada, explicar el
  contador nativo detenido y validar reconexión/reapertura en dispositivos.
- Falta comparar rendimiento con controles equivalentes (fuente, caché, calidad,
  red y concurrencia), incluyendo una canción y una lista larga.
- Safari/iPhone y dispositivos sin Background Fetch no ofrecen una garantía
  universal de ejecución tras cerrar una PWA. La alternativa implementada
  conserva las canciones completas y reanuda pendientes al volver; una descarga
  parcial de ese transporte todavía se reinicia desde cero.
- No se ha creado commit, PR ni publicación de esta intervención.

Actualización de la repetición: el frontend con dos workers volvió a fallar
en `appShell / flujo resume` (seek 0 en lugar de 42); ese mismo caso ejecutado
aisladamente pasó. Esto no permite declarar la suite verde: falta aislar la
interacción entre pruebas. Se detectaron además puertos MessageChannel del mock
Node sin cerrar y se corrigió su cierre explícito; debe repetirse la suite con
esa corrección. No se modificó ni debilitó la aserción de resume.

Guía primaria de capacidades y restricciones:
https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API
https://developer.chrome.com/blog/background-fetch

## Verificación posterior de Brave

Se recuperó la conexión y se inspeccionó únicamente el manifest (sin React).
La cola estaba vacía y había nueve canciones, 32.214.219 bytes, guardadas tras
cerrar la pestaña. El último commit ocurrió a los 17.613 ms del inicio. La
resolución del servidor ya estaba caliente: no es una comparación causal con
los 23.735 ms del primer ensayo en frío.

Los blobs originales de Don't Know Why, Rolling in the Deep y NUEVAYoL conservan
exactamente los tres SHA-256 registrados en `2026-10-17-cold-playback.md`.
Esto verifica los bytes de tres de las nueve pistas del lote real en segundo
plano. No prueba un teléfono bloqueado, un TV ni 350 transferencias reales.

El fallo intermitente de resume se rastreó al protocolo del test: jsdom no
emitía metadata para completar el seek inicial a 0. El test parcheaba después
sessionPosition=42 dejando aquel seek pendiente; el siguiente metadata aplicaba
SEEK_APPLIED y borraba la posición recién parcheada. Se completa ahora el
metadata inicial antes de instalar el 42. No se cambió la máquina de audio ni
la aserción final. La suite completa se repite con ese protocolo.

La repetición completa posterior pasó: 39 archivos y 480 pruebas frontend,
cero fallos (78,62 s, dos workers).

## Experimento controlado de pausas entre bloques

Se comparó el mismo handler, las mismas tres URLs upstream y calidad, sin
extracción, alternando 120/0/0/120 ms de pausa fija. Dos muestras por variante:

| Archivo | Bytes | Con 120 ms | Con 0 ms |
|---|---:|---:|---:|
| 0 | 4.968.484 | 2306 / 1964 ms | 1608 / 1446 ms |
| 1 | 3.257.849 | 1401 / 1350 ms | 964 / 975 ms |
| 2 | 3.635.310 | 1446 / 1353 ms | 1015 / 1017 ms |

Las doce respuestas fueron 200, sin 403 ni avisos, y con SHA-256 idéntico por
archivo entre variantes. Media agregada 1636,7 frente a 1170,8 ms (28,5% menos)
en este ensayo local; no es un porcentaje garantizado de la playlist pública.
Artefacto: `test-results/download-audit/pacing.json`. El helper inicial tuvo un
error de fixture y produjo 502; se corrigió antes de recoger estos resultados.

Se elimina por ello la pausa obligatoria en transferencias sanas. Ante un 403
intermedio se conserva el backoff de 800/1800 ms y se activa además la pausa de
120 ms para los bloques restantes. Una regresión nueva comprueba recuperación
del bloque rechazado sin pérdida ni duplicación de bytes.

Dos rondas de ocho transferencias simultáneas con la variante adaptativa
terminaron en 4883 y 4645 ms: dieciséis respuestas 200 con SHA-256 esperado,
cero 403 y cero avisos del proxy. Son las tres mismas fuentes repetidas, no
dieciséis canciones diferentes. Artefacto: `concurrent.json` en la misma carpeta.

Gate final después del cambio de transporte: 444 pruebas Node sin fallos,
build correcto, lints backend/frontend y diff-check correctos. La suite completa
frontend pasó con 480 pruebas como se describe arriba; el último cambio después
de ella afecta únicamente al proxy backend y su prueba.

Al reabrir Brave, Me gusta muestra nueve canciones y el botón Descargado.
Captura: `test-results/download-audit/background-completed.png`.

Permanece por verificar reconexión real, dispositivos móviles bloqueados y una
playlist real de 350 pistas. El navegador integrado que expone Background Fetch
sin transferir datos necesita una detección de falta de progreso y fallback;
no debe confundirse la detección de la API con soporte efectivo. Se solicitó
al usuario una decisión de alcance entre PWA y una aplicación nativa para
plataformas con restricciones web. No se declara completado el objetivo.

## Alcance confirmado y detección de progreso

El usuario eligió mantener la PWA. Por tanto, la implementación conserva
continuidad donde el navegador la permite y reanudación en las otras plataformas,
sin añadir aplicaciones nativas.

El protocolo de worker v2 observa progreso real antes de confirmar el inicio.
Si no llega durante 45 s y la página está visible y online, abandona esa
inscripción y usa la cola de primer plano. Al volver detecta inscripciones
sin bytes de más de 60 s y las recupera. La desactivación temporal de Background
Fetch dura una hora y evita reiterar una capacidad que solo existe nominalmente.
El abandono automático se distingue de una cancelación del usuario.

Gate posterior: 445 Node, 482 frontend y build/lints correctos. Pruebas
específicas de progreso y recuperación incluidas.

Durante la prueba real de recuperación apareció otro bloqueo reproducible:
MixCard llamaba a label.replace con una mezcla cacheada sin label, lo que
desmontaba App y también sus efectos de descarga. El stack minificado se
contrastó con el fuente. Se añade título alternativo y dos regresiones de
renderizado; esas pruebas y las ocho del cliente de descargas pasan (10/10).
La recuperación real se repite después de ese ajuste.

La repetición real recuperó las nueve canciones detenidas en el navegador
integrado: nueve blobs guardados, cola vacía y Background Fetch diferido. Se
simuló temporalmente visibilidad de primer plano en ese origen de staging y se
retiró la propiedad de prueba después. La UI Me gusta indica Descargado;
captura `recovered-queue.png`. Se coalescen además eventos de reconexión recibidos
mientras otra reanudación sigue activa; una regresión específica comprueba que
el evento no se pierde y que el siguiente intento guarda la pista una sola vez.

Último frontend completo: 40 archivos / 484 pruebas, cero fallos; build y lint
correctos. Después, la regresión de coalescencia y los tests de cola, progreso
y mezcla se ejecutaron juntos: 28 pruebas sin fallos. El CI del PR comprobará
el conjunto final. Backend completo: 445 sin fallos. El primer commit está
en PR #33; la recuperación y las regresiones posteriores se añaden antes de
declararlo listo para integrar.
