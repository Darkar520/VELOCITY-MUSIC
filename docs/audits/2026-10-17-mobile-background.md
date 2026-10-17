# Reproducción móvil, consumo y carátulas — 17 de octubre de 2026

## Alcance y estado

Objetivo abierto: continuidad al bloquear/cambiar de app, cambio de canción
oculto, estabilidad, reducción de trabajo innecesario y carátulas del sistema
en Android/iPhone y Chrome, Brave, Safari, Firefox y Opera Mini. Se mantiene
la PWA por decisión del usuario. Dispositivo declarado: Samsung Android con
Brave; modelo exacto y versiones del sistema/navegador aún desconocidos.

La implementación 3.17 / worker v88 corrige defectos reproducibles de código.
Las pruebas unitarias o una pestaña oculta de escritorio no prueban ejecución
con un teléfono bloqueado, salida audible física ni reducción de temperatura.
El objetivo completo no se declara logrado sin esa evidencia.

## Defectos falsables y correcciones

1. Había cinco play() programados por arranque, incluso después de éxito. Una
   interrupción no invalidaba todos ellos; sus promesas podían reportar PLAYING
   después de ceder foco. Se reproduce en tests. Ahora play es síncrono cuando
   llega el efecto (conserva activación de controles), se revalida política al
   ejecutar/completar y solo AbortError recibe dos reintentos acotados.
2. El effectCtx se reemplazaba por render y perdía epoch/pendingSeek. Se conserva
   una sola identidad, se actualizan dependencias y se invalida al desmontar.
   Una promesa antigua no pausa el elemento de una canción nueva.
3. STREAM_READY y PLAYING tardíos podían reclamar foco durante yield. El reducer
   protege esas transiciones; USER_PLAY/DOC_VISIBLE recuperan explícitamente.
   Se conserva la regla A7 y la capacidad de next en lock sin yield (A11).
4. El pause diferido 300 ms no verificaba que el elemento siguiera pausado ni
   que la pista/fuente siguieran siendo las mismas. Ahora se comprueban ambos,
   se descarta si recuperó y se cancelan timers al desmontar.
5. El watchdog oculto confundía la pausa intencional de TRACK_SET, mientras
   resolvía la siguiente pista, con pérdida de foco. También heredaba currentTime
   y stallMs de la canción anterior. Exige src listo y nueva observación por
   pista/fuente/retroceso. Las dos regresiones fallan antes y pasan después.
6. Screen Wake Lock mantenía la pantalla encendida; no garantiza audio oculto.
   Se elimina su solicitud automática. No se añade AudioContext ni keepalive
   silencioso y no se pelea con otra app que toma foco.
7. Media Session ignoraba portadas relativas /img producidas por el catálogo.
   Se usa la mejor portada y el proxy existente, URL absoluta, sin afirmar MIME
   JPEG o dimensiones desconocidas. Metadata/handlers no se reconstruyen por
   pause/play ni por renovación HMAC. Una imagen fallida recibe fallback, un
   fallo de una imagen vieja no borra la nueva y los blobs se liberan al dejar
   de usarse. Cada acción no soportada se aísla. seekforward/backward buscan
   segundos; anteriormente saltaban de canción.

## Trabajo evitado y límites de la inferencia térmica

- Los relojes de las barras no renderizan al avanzar el store con la página
  oculta; al volver reflejan el tiempo actual. Test con React Profiler: veinte
  cambios de tiempo ocultos conservan el número de commits del árbol observado.
- El reloj de letras de 200 ms solo existe con panel abierto, letras visibles,
  documento visible y reproducción activa.
- La posición del OS se publica como máximo una vez por segundo para avance
  normal; seeks se publican inmediatamente. Test: veinte muestras de 250 ms,
  como máximo cinco publicaciones, además de comprobación del seek.
- El sondeo de versión no hace peticiones oculto/offline y deduplica focus/return.

Son recuentos de operaciones, no métricas de temperatura ni de energía. La
hipótesis de menor consumo debe comprobarse en hardware con fuente/red,
brillo, temperatura ambiente, carga de batería y apps de fondo controladas.

## Verificación de código

La observación real inicial mostró dos play con una firma cacheada. Se rastreó
a TRACK_SET/ensureStream y otro STREAM_READY del caller. El mismo doble camino
leía dos veces un blob offline y podía crear una URL tras desmontar. Tres
regresiones fallaron antes de unificar todo en ensureStream. La suite completa
posterior pasó con 512 pruebas en 45 archivos. Una cuarta regresión comprueba
fallback online ante error de lectura IDB (evita perder esa capacidad al quitar
el camino redundante); el CI del commit final debe incluirla también.

- Gate npm run verify: 446 pruebas Node, cero fallos; build correcto.
- Frontend final: 509 pruebas / 44 archivos, cero fallos.
- Repetición posterior al ajuste de fuentes: 512 / 45 archivos, cero fallos;
  el caso IDB posterior se ejecuta dirigido y queda incluido en el CI final.
- Lints backend y frontend sin errores; diff-check correcto.
- Casos específicos: mobileAudio (11), MediaSession (7), guard (3), trabajo
  oculto (2), identidad del controller y matriz A7–A14 ampliada.
- La primera suite completa detectó un test de stall que no emitía el metadata
  inicial de jsdom antes de inyectar 26,95 s; el seek inicial a cero seguía
  pendiente. Se completa el evento antes de simular media pista. No se cambia
  la aserción 26,95 ni se declara ese fallo como reproducción física.

## Validación de dispositivos pendiente

Ensayo real de navegador con el primer commit 28cf45a: Brave de escritorio,
staging aislado 3001, cola del álbum xx. Intro (127,941 s) y VCR (176,541 s)
terminaron completos y comenzó Crystalised automáticamente. La página estaba
hidden desde el segundo 30,787 de Intro y siguió oculta durante ambos cambios.
Se retiró temporalmente la emulación de foco del debugger para observar la
visibilidad real; sin hacerlo, el navegador de automatización reportaba
visible. En Crystalised se comprobó una portada /img decodificada de 512x512;
en VCR el proxy devolvió 200 image/jpeg, 19.198 bytes. No prueba que el sistema
Android haya pintado esa imagen en su notificación. Artefacto local:
test-results/mobile-audio/hidden-events.json. El ensayo distingue un error del
elemento vacío al limpiar fuente (id null) de un error durante una pista real.

| Plataforma | Código / pruebas simuladas | Hardware físico |
|---|---|---|
| Samsung Android / Brave | Cambios y regresiones aplicables | Pendiente |
| Android / Chrome | Política nativa HTMLMediaElement + Media Session | Pendiente |
| iPhone / Safari | Sin Web Audio ni dependencia de Screen Wake Lock | Pendiente, versión requerida para interpretar resultados |
| Firefox móvil | Acciones opcionales protegidas | Pendiente |
| Opera Mini | No se presupone ejecución JS persistente en modo Extreme | Pendiente; limitaciones del motor/proxy no eliminables desde la PWA |

Protocolo Samsung inicial: confirmar v3.17 en Perfil; comenzar una cola de al
menos tres pistas sin descargar, bloquear a mitad de la primera y mantener
bloqueado hasta entrar en la tercera. Comprobar portada/título/controles en la
notificación durante la primera y después del cambio. Repetir cambiando a una
app sin audio. Control negativo: iniciar un vídeo con sonido en otra app debe
ceder foco sin superposición; al volver a Velocity debe recuperar posición.
Pausa manual debe seguir pausada al volver. Repetir con tres pistas offline.

Registrar pista, segundo aproximado, pantalla bloqueada o app usada, portada,
red, versión Brave/Android y cualquier fallo. Para consumo, dos ensayos de diez
minutos con idéntica cola, brillo/red y teléfono sin cargar; registrar energía
y temperatura solo si el dispositivo las expone. Sin baseline equivalente no
atribuir un cambio térmico a esta intervención.

## Fuentes primarias

- Screen Wake Lock mantiene la pantalla encendida, con restricciones de
  visibilidad: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- Media Session y acciones del sistema:
  https://developer.mozilla.org/en-US/docs/Web/API/MediaSession
- Safari 17.5 corrigió la continuación de HTML audio entre actividades en
  background: https://webkit.org/blog/15383/webkit-features-in-safari-17-5/
- Opera Mini y su ejecución de scripts en servidor/modo ahorro:
  https://help.opera.com/en/opera-mini-and-javascript/
  https://help.opera.com/en/opera-mini-content-authoring-guidelines/
