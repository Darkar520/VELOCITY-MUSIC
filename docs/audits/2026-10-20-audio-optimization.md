# Optimización de audio: referencia experimental

Fecha: 2026-10-20
Rama: `codex/audio-optimization-plan`
Base: `origin/main` (`5b19839`)
Entorno: worktree y staging local aislados; sin publicación ni cambios en producción.

## Alcance y criterio

La fase 0 añade contadores acotados en memoria y una medición local del tiempo entre la solicitud de reproducción y el resultado nativo `playing`. El endpoint de staging muestra acumulados de preparación, proxy, errores tipados y proceso. No guarda URLs, firmas, cookies, credenciales, títulos ni IDs de pistas en la instantánea ni en logs. La identidad de una solicitud solo se retiene en memoria durante un máximo de 60 segundos, con un límite de 500 claves, para identificar repeticiones exactas y solapamientos; luego se descarta.

Los valores de proceso son una muestra de un backend ocioso. No representan costo por pista, carga sostenida ni uso de CPU/RAM durante reproducción. Los cero contadores significan que no hubo solicitudes de reproducción en esa sesión, no que reproducir una pista transfiera cero bytes.

## Evidencia observada

| Medida | Resultado | Interpretación válida |
|---|---:|---|
| Resolución | `degraded`; `yt-dlp` no disponible | No se pudo preparar una fuente remota en este worktree. |
| `yt-dlp` activo / en cola | 0 / 0 | Muestra ociosa; no acredita capacidad bajo carga. |
| Solicitudes de preparación / proxy | 0 / 0 | No se reprodujo audio real durante la captura. |
| Bytes del cuerpo escritos por el proxy | 0 | No es una medida por reproducción ni una comparación antes/después. Cuenta los bytes aceptados por `ServerResponse.write`; no confirma recepción por el cliente. |
| CPU acumulada al consultar staging | usuario 1.218 s; sistema 0.671 s | Tiempo de proceso acumulado en una sesión breve y ociosa. |
| RSS / heap usado al consultar staging | 88,854,528 / 22,435,024 bytes | Memoria del proceso ocioso, no costo durante audio. |
| Inicio real de reproducción | Sin medir | Falta una fuente autorizada que el resolver pueda preparar. |
| Errores, reconexiones y solicitudes repetidas de audio | Sin medir en una sesión real | Los contadores están disponibles; no hubo reproducción que observar. |

El staging devolvió `status: operational` y `resolutionMode: degraded` a la vez. Por tanto, la salud HTTP del proceso no constituye evidencia de reproducción disponible. No se usó cuenta personal ni se consultó producción.

El elemento de precarga existente declara `preload="metadata"`. No hay evidencia de que descargue el audio completo antes de reproducir; la cantidad real de bytes de esas solicitudes sigue sin medirse.

## Hipótesis y supuestos

- H1: las métricas de preparación, bytes, rangos, reintentos, solapamientos, errores y tiempo de inicio permitirán una comparación por modo si se capturan sesiones equivalentes con audio autorizado.
- H2: mover la preferencia de precarga reducirá transferencia no prioritaria; todavía no se demuestra que reduzca bytes totales ni que conserve el tiempo de cambio de pista.
- Supuesto: una sesión de staging en este worktree describe el comportamiento local del código, no una sesión de producción ni un navegador/dispositivo físico.
- No se infiere compatibilidad, velocidad audible, ahorro de subida ni continuidad en pantalla bloqueada a partir del endpoint de estado, tests sintéticos o `canPlayType()`.

## Verificación de fase 0

- Backend: `npm test` — 535/535 pasan.
- Frontend: `npm test -- --reporter=dot --maxWorkers=2` — 631/631 pasan. Una ejecución sin límite de workers tuvo tres timeouts por saturación; las tres pruebas pasaron al aislarlas y la corrida completa limitada pasó sin cambiar timeouts.
- Lint: `npm run lint:errors` — pasa.
- Build: `npm run build` — pasa. Se mantienen los avisos previos de chunk JavaScript mayor de 500 kB y de `offlineLibrary.js` importado de forma estática y dinámica.
- Contador sintético del proxy: dos respuestas fixture contaron sus bytes de cuerpo, detectaron una repetición exacta secuencial y la instantánea no incluye el artista, título o ID privados de la solicitud.
- Medición de inicio: la unidad verifica el cronómetro acotado en memoria; no hay muestra de reproducción real.

En Windows, el test de contexto de letras ahora prueba `python3`, `python` y `py -3` en ese orden cuando falta el ejecutable empaquetado. Esto corrige la dependencia del nombre Unix `python3` en el runner Windows; no cambia producto.

## Fase 1 — Precarga configurable

Se añadió una preferencia persistida con tres opciones: `current` conserva las dos fuentes ocultas existentes; `one-track` prepara solo la siguiente pista; `url-only` conserva la firma/preparación anticipada de `prefetchNext()` sin montar audio oculto. `current` es el valor inicial para mantener el comportamiento de usuarios sin una preferencia previa a esta fase; las preferencias guardadas se conservan. Las preparaciones obsoletas se abortan y las respuestas tardías no pueden volver a instalar una fuente vieja. Al avanzar la cola, una fuente ya preparada para la nueva pista actual se conserva.

Verificación automatizada después de la fase:

- Backend: `npm test` — 535/535 pasan.
- Frontend: `npm test -- --reporter=dot --maxWorkers=2 --silent` — 640/640 pasan.
- Lint: `npm run lint:errors` — pasa.
- Build: `npm run build` — pasa; permanecen los avisos existentes de chunk mayor de 500 kB e importación mixta de `offlineLibrary.js`.
- Pruebas focalizadas cubren cada modo, cancelación de preparación obsoleta, descarte de respuesta tardía, reutilización de la preparación anticipada y conservación/liberación de fuentes ocultas.

Resultado medido: ninguno todavía. Las pruebas verifican decisiones de montaje y cancelación, no bytes remotos ni latencia audible. No se ejecutaron en un dispositivo físico las transiciones de pantalla bloqueada, segundo plano o Media Session. Por la ausencia de `yt-dlp` en staging no se pudo comparar transferencia ni tiempo de inicio. Por tanto, el cambio está verificado por código y pruebas automatizadas, pero el beneficio de rendimiento y la aceptación de continuidad en dispositivo siguen pendientes.

## Fase 2 — Perfil de calidad inicial

El valor inicial para preferencias nuevas o ausentes ahora es `medium`; una preferencia `velocity.quality` ya persistida se sigue leyendo y prevalece. `high` continúa disponible y seleccionable. La negociación existente sigue solicitando AAC en navegadores que no reportan Opus/WebM y sí reportan AAC. La interfaz y la API describen los bitrates como objetivos y advierten que el resultado depende de la fuente y del navegador. Las URLs externas explícitas no se transcodifican ni se reescriben por el selector de calidad; el fallback Deezer opt-in sigue recibiendo el perfil configurado por el usuario.

Verificación automatizada y staging después de la fase:

- Backend: `npm test` — 536/536 pasan.
- Frontend: `npm test -- --reporter=dot --maxWorkers=2 --silent` — 641/641 pasan.
- Lint: `npm run lint:errors` — pasa.
- Build: `npm run build` — pasa; permanecen los avisos conocidos de chunk mayor de 500 kB e importación mixta de `offlineLibrary.js`.
- Staging aislado: `/api/qualities` anuncia `medium` y mantiene `high, medium, low`; `/api/status` informa `resolutionMode: degraded`, `extractor.ready: false`; los diagnósticos se limitan a staging.
- Las pruebas sintéticas cubren selección del perfil, preservación de un valor explícito, adaptación a AAC cuando el navegador declara compatibilidad, conservación de los tres perfiles y URL directa explícita.

No se midió el bitrate entregado ni el ahorro de bytes. La suite prueba la negociación declarada por `canPlayType()` con mocks; no sustituye reproducción de archivos Opus/AAC reales en los navegadores objetivo. Staging tampoco pudo resolver una fuente. La reducción teórica de 160 a 128 kbps es 20 % en bitrate, no una medición de transferencia total ni garantía del bitrate del origen.

## Fase 3 — Ruta directa experimental

`/api/playback/prepare` sigue siendo el punto central y conserva la URL firmada del proxy. Añade una URL directa solo cuando la resolución termina en HTTPS y el host pertenece a una lista confiable (`googlevideo.com` para YouTube; `dzcdn.net` para Deezer). La caché del frontend distingue ambas rutas y expiraciones; no persiste URLs directas. Los modos son `proxy`, `direct-experimental` y `auto`; `auto` solo usa directo después de que ese navegador haya observado un evento nativo `playing` compatible para el proveedor. El modo inicial ahora es `auto`.

Si falla la ruta directa, la recuperación vuelve una sola vez al proxy firmado si la pista sigue siendo actual, el usuario mantiene intención de reproducir y el foco no fue cedido. Conserva la posición cuando es válida y no reanuda una pausa del usuario. La política no cambia `audioMachine.js`, `runAudioEffects.js`, HMAC ni la prioridad de fuentes offline.

Validación funcional limitada en staging, con cuenta y datos aislados:

- El resolver quedó disponible (`resolutionMode: full`, `extractor.ready: true`). La preparación de prueba autorizada devolvió HTTP 200, candidato directo HTTPS de `googlevideo.com` y proxy firmado.
- En el reproductor integrado se buscó y reprodujo “Big Buck Bunny” de Blender con `direct-experimental`. El elemento de audio nativo quedó en `playing`, con `readyState: 4`; se pausó, se hizo seek a 30 s y se reanudó desde aproximadamente 30 s. La URL directa no se imprimió ni guardó en el informe.
- En la sesión integrada, el estado de staging acumuló cuatro preparaciones correctas (26,882 ms en total, 6,721 ms promedio; máximo 9,078 ms), cero errores de reproducción y cero solicitudes/bytes del proxy. Las cuatro preparaciones incluyen actividad de precarga/recomendación; no atribuyo ese tiempo a una sola canción.
- En una comparación puntual del mismo ID, con un elemento nativo de prueba en el mismo navegador, la ruta directa registró aproximadamente 272 ms del clic a `playing`; el proxy registró aproximadamente 134 ms. Son una muestra por ruta y el orden no fue aleatorizado: no prueban igualdad ni superioridad de latencia.
- La reproducción por proxy registró siete rangos `206` y 3,670,016 bytes aceptados por `ServerResponse.write`; el contador de repetición exacta, reintentos y duplicados concurrentes quedó en cero. Es una muestra breve con buffering del navegador, no una tasa por minuto ni una medida de bytes recibidos exactamente por el cliente.
- Una petición firmada explícita `Range: bytes=0-65535` devolvió `206`, `Content-Range: bytes 0-65535/10202210`, longitud 65,536, `Cache-Control: private, no-store, no-transform` y SHA-256 `181217e2725fe4461eb57407f19af750d617f86c5ba507bce5ff815a8231aad2`. La misma respuesta produjo el mismo hash al repetirla después del reinicio de staging.
- La fuente de prueba pertenece a la película abierta de Blender, publicada bajo CC BY 3.0 según [la licencia oficial de Big Buck Bunny](https://peach.blender.org/about/). Se usó para pruebas funcionales breves, no para carga.
- Prueba offline integrada adicional: desde «Descargar (offline)» se descargó esa misma pista a IndexedDB (`velocity-offline/tracks`), con metadata `Big Buck Bunny` / `Blender` y un blob `audio/mp4` de 2,858,537 bytes. Con la red del navegador forzada a offline (`navigator.onLine === false`), al elegir la pista en el buscador el `<audio>` nativo reprodujo desde `blob:`, `readyState: 4`, y avanzó de 0 a 3.1 s. Se pausó a 7.3 s; `Anterior` reinició la pista a 0 sin reanudarla. Con solo esa pista en cola, `Siguiente` dejó el reproductor pausado en 0: es evidencia del límite de cola vacía, no de transición entre dos pistas.
- La búsqueda de «Sintel» en el catálogo devolvió resultados atribuidos a un artista llamado Sintel sin vínculo verificable con la película de Blender. No se usaron como audio de prueba. La licencia oficial de Sintel cubre el proyecto Durian, pero no identifica por sí sola qué resultados del catálogo corresponden a esos recursos.

Verificación automatizada de la fase antes de comenzar Fase 4: backend 540/540, frontend 652/652, lint y build correctos. Los tests cubren dominios directos permitidos, vencimiento, preferencia de modos, compatibilidad recordada solo tras reproducción nativa, fallback único con posición e intención/foco y conservación de fuentes offline.

Límite: la reproducción integrada prueba el inicio y controles de una pista, pero no un cambio natural entre dos pistas autorizadas. La cola de staging contenía otras canciones sin licencia verificada y no las reproduje para forzar `next`/`previous`. El test de audio nativo aislado confirma compatibilidad del navegador con el host directo; por sí solo no verifica el flujo de React.

Incidencia excluida de la evidencia: durante una sesión exploratoria anterior, la pista autorizada terminó mientras una cola previa de staging seguía cargada y la app avanzó automáticamente a «Sunday Service» de Jaz Donell, cuyo permiso no se verificó. Se detectó cuando el contador mostraba 5.89 s y se pausó a 13.33 s. Esa transición no se usa como resultado ni como prueba de `next`; después la prueba offline se realizó con una cola de un solo elemento. Al cerrar esa sesión, el log del proxy registró un bloque upstream incompleto (`expectedBytes=524288`, `receivedBytes=32768`); el audio offline ya estaba guardado y reproducible. Sin correlación de solicitud no se atribuye la causa ni se cuenta como éxito de transferencia.

## Fase 4 — Proxy existente

Se mantuvo `RANGE_CHUNK_BYTES = 512 KiB`, la validación estricta de `Content-Range`, el backpressure, la caché y las resoluciones compartidas. No se ajustó concurrencia: la lectura de carga de staging fue 0 procesos activos y 0 en cola, con límites configurados de 4 y 32; no hubo saturación que justificara un cambio. En la prueba breve real, hubo 0 reintentos y 0 duplicados; no son suficientes observaciones para estimar una tasa en producción.

La prueba nueva de desconexión encontró y corrigió dos casos: el cliente podía cerrar mientras el proxy aún leía el body upstream, y también podía abandonarlo durante la espera de reintento `403`. El proxy ahora aborta la señal del upstream al cerrar el cliente, cancela el backoff por esa misma señal y no vuelve a resolver si la respuesta ya fue destruida. La regresión verificó abort upstream, una sola resolución y contador de respuesta abortada; el caso de backoff verificó que no se envía un tercer `fetch`. Ambas pruebas pasaban en menos de un segundo. La reproducción real por proxy y el rango explícito `206` se repitieron después del primer cambio; el cambio del backoff se valida con su prueba de integración de desconexión.

Verificación final tras los cambios de Fase 4:

- Backend: `npm test` — 542/542 pasan.
- Frontend: `npm test -- --reporter=dot --maxWorkers=2 --silent` — 653/653 pasan, incluida la regresión del fundido.
- Lint: `npm run lint:errors` — pasa.
- Build: `npm run build` — pasa. Se mantienen el aviso de chunk JavaScript de 571.52 kB (166.93 kB gzip) y la importación estática/dinámica de `offlineLibrary.js`.
- `git diff --check` — pasa.

La muestra de CPU y RAM sigue siendo demasiado breve para atribuir costo por reproducción o hacer una comparación antes/después controlada.

### Comparación exploratoria contra la referencia

Se realizó una comparación con dos checkouts y servidores de staging aislados: la referencia limpia `5b19839` en `http://localhost:3002` y esta rama en `http://127.0.0.1:3001`. Se usaron el mismo navegador, perfil de prueba, modo `proxy` y la pista autorizada Big Buck Bunny. Antes de cada ensayo se reinició el proceso y se retiró su caché de resolución para empezar en frío. El orden se alternó entre los dos pares completos.

| Par | Referencia (`5b19839`) | Rama optimizada | Diferencia observada (optimizada − referencia) |
|---|---:|---:|---:|
| 1 | 5,999.3 ms | 6,961.7 ms | +962.4 ms |
| 2 | 7,179.4 ms | 7,131.9 ms | −47.5 ms |

La mediana descriptiva fue 6,589.4 ms en la referencia y 7,046.8 ms en la rama (diferencia +457.5 ms). No es evidencia estadística de una regresión ni de una mejora: `n=2`, hubo variación del resolvedor, los hosts/puertos locales difieren y el tiempo base se capturó con evento CDP mientras el de la rama usó `performance.measure()` de la app. Un tercer intento de la referencia dio 5,752 ms; su par optimizado llegó a reproducir, pero no produjo una lectura válida del cronómetro y quedó excluido. La medición puntual anterior de 272 ms directa frente a 134 ms proxy también queda separada por ser `n=1` por modo y sin orden aleatorio.

Por tanto, el criterio de aceptación «no aumenta el tiempo de inicio» sigue sin demostrarse. Se necesitan más pares con medición idéntica, host/protocolo igualados, orden aleatorio y el mismo entorno/dispositivo.

### Repetición de inicio con Monkoto en staging aislado

Se tomó otra muestra con dos checkouts aislados y el mismo navegador, pista autorizada, calidad `high`, transporte `proxy` y reproducción automática desactivada. La cola se limitó a Monkoto. Se registró el tiempo desde el clic de reproducción hasta el evento nativo `playing`; ambas rutas quedaron en `readyState=4`, sin error, y cada sesión registró un rango `206` con 524,288 bytes de cuerpo aceptados por el proxy (524,588 bytes transferidos según el navegador).

| Condición | Referencia `5b19839` | Rama optimizada | Diferencia observada |
|---|---:|---:|---:|
| Inicio en frío | 7,229 ms | 9,575 ms | +2,346 ms |
| Inicio con resolución ya preparada | 575 ms | 1,142 ms | +567 ms |

Es `n=1` por celda; se usaron orígenes loopback distintos y no hubo aleatorización. La rama optimizada fue más lenta en ambas observaciones, pero esta muestra no permite atribuir la diferencia al código ni estimar su distribución. No cumple como prueba de «sin aumento de inicio» y no debe presentarse como igualdad o mejora. La medición comparable requiere más pares alternados en el mismo origen, proceso y navegador, con idéntica fuente de tiempo.

La inyección de fallo directo sí produjo evidencia parcial en una sesión limpia de staging, con `Directo Experimental`, calidad alta, `Solo URL`, reproducción automática desactivada y solo Sneaky Snitch en la cola. El navegador registró `ERR_BLOCKED_BY_CLIENT.Inspector` para la solicitud externa bloqueada. En una lectura acumulada del staging, el backend registró un evento `DIRECT_FALLBACK_PROXY_MOUNTED`, diez respuestas proxy `206`, 4,369,864 bytes de cuerpo escritos, cero reintentos y cero respuestas fallidas. Una lectura posterior añadió una respuesta `200` y una respuesta abortada sin aumentar los bytes; las métricas son agregadas y no incluyen correlación por pista. Esto prueba que el manejador seleccionó el proxy firmado y que se transfirió audio por rangos durante la sesión, pero no permite atribuir todos esos bytes exclusivamente a esa pista. La automatización se quedó esperando y no devolvió el estado final del elemento nativo; por eso no afirmo que haya llegado a `playing` ni que se haya oído la misma pista. Un reintento posterior se atascó antes de emitir solicitudes de preparación. La reproducción nativa tras el fallback sigue sin verificarse.

### Corrección detectada durante la verificación funcional

La consola del navegador había registrado dos `IndexSizeError` al asignar `HTMLMediaElement.volume` con −0.0250277 y −0.00655104. El fundido de `usePlaybackController.js` podía calcular un progreso negativo si el timestamp de animación antecedía a `performance.now()`. Se limitó ese progreso al intervalo `[0, 1]` y se añadió una regresión que reproduce un timestamp temprano. No se modificaron `audioMachine.js` ni `runAudioEffects.js`.

Tras la corrección, la prueba focalizada pasó 13/13; la suite completa pasó 653/653; `npm run verify` pasó (542/542 backend y build) y `npm run lint:errors` pasó. En una sesión posterior de staging, Big Buck Bunny llegó a `readyState=4` y 12.51 s, quedó pausada y la consola no registró errores. Esto verifica el recorrido funcional breve posterior al ajuste, pero no reproduce de forma determinista el timestamp temprano; esa condición queda cubierta por la regresión automatizada.

Desviación durante esa revisión: staging restauró una cola previa y creó dos elementos de precarga ocultos para fuentes cuya autorización no se verificó; no seleccioné ni escuché esas pistas. Los elementos alcanzaron `readyState=4`. Al apagar staging se registraron cuatro cuerpos de rango upstream incompletos. Sin correlación por solicitud no puede determinarse a cuáles elementos pertenecían ni cuántos bytes llegaron al navegador; se excluyen de la evidencia de rendimiento y transferencia. La cola persistida en staging no se borró.

### Reintento controlado excluido por contaminación de la cola

Se repitió la comparación con la referencia `5b19839` en un origen y puerto únicos (`127.0.0.1:3003`), una base de staging nueva, navegador, calidad `high` y transporte `proxy`. Al seleccionar Big Buck Bunny en los resultados, la cola recibió 46 pistas adicionales. No seleccioné ni reproduje esas pistas; sin embargo, dos fuentes no verificadas aparecieron en los elementos de audio ocultos mientras sonaba Big Buck Bunny. Al quitar las 46 pistas desde la interfaz de la cola, una fuente oculta de «Sunday Morning» aún conservaba `readyState=4`.

El cronómetro del evento nativo registró 10,045 ms entre seleccionar Big Buck Bunny y `playing`, pero se excluye de toda comparación: se observó precarga de fuentes ajenas a la pista autorizada. No permite estimar la latencia de una sesión de una sola pista ni bytes recibidos por el navegador. Big Buck Bunny quedó pausada; se cerró la pestaña y se detuvo staging sin iniciar otra pista. El cierre produjo dos logs de rangos incompletos (`expectedBytes=524288`, `receivedBytes=81920`); sin correlación por solicitud no se atribuye su causa ni su pista. Este intento confirma que seleccionar un resultado de búsqueda no aísla la pista en la cola. Toda repetición válida requiere establecer y verificar la cola antes de reproducir.

## Fase 5 — Evaluación de Cloudflare

`cloudflare-worker/wrangler.toml` asigna actualmente `velocitymusic.uk/*` al Worker. `router.js` envía `/api/*`, `/img` y `/img/*` al túnel; reescribe las demás rutas a `velocity-music.pages.dev`, con fallback SPA para 404. Así Pages es el origen de los recursos estáticos, pero las peticiones del dominio personalizado todavía atraviesan el Worker. `docs/RELEASE.md` documenta esa arquitectura; este checkout no contiene una configuración de dominio personalizado de Pages que permita retirar el Worker globalmente sin cambiar DNS/configuración externa.

No estreché la ruta del Worker: sin confirmar el dominio personalizado de Pages y su DNS en Cloudflare, el cambio podría dejar el frontend sin origen. La ruta directa observada en el navegador apunta a `googlevideo.com`, por lo que el audio directo no pasa por el Worker ni el túnel local. El proxy conserva `Range`, HMAC y `no-store`; los tests de Cloudflare confirman que el Worker no reintenta streams firmados y que los assets estáticos siguen resolviéndose en Pages. No se modificó ni desplegó configuración de Cloudflare.

## Aceptación todavía pendiente

El plan se implementó localmente en cinco fases; la Fase 5 concluyó en evaluación sin cambio de ruta. Este es el estado de cada criterio final:

| # | Criterio | Estado según evidencia |
|---|---|---|
| 1 | Modo proxy conserva su comportamiento | Verificado en staging para reproducción de una pista, pausa, seek, `Range 206`, firma y hash estable; no incluye transición natural a otra pista autorizada. |
| 2 | Directo funciona en fuentes compatibles probadas | Verificado para Big Buck Bunny en un navegador y una fuente `googlevideo`; no generalizable a otros navegadores/proveedores. |
| 3 | El fallo directo recupera por proxy | Verificado en staging con un fallo DNS sintético del origen directo: el elemento nativo siguió reproduciendo desde `localhost` después del fallback. La inyección cambió la posición al cargar la URL inválida, así que no acredita continuidad de posición. |
| 4 | El directo no consume subida local de audio | En la muestra directa no hubo solicitudes ni bytes del proxy; no hay medición de bytes de red de extremo a extremo. |
| 5 | Sin aumento de fallos, interrupciones o inicio | No demostrado. Los dos pares fríos de Big Buck Bunny tuvieron una mediana descriptiva de +457.5 ms con cronómetros no idénticos; la repetición de Monkoto midió +2,346 ms en frío y +567 ms con resolución preparada, una muestra por celda. No permite atribución, pero tampoco acredita el criterio. |
| 6 | Se preservan reproducción, biblioteca y descargas | Suites completas pasan; una descarga nueva reprodujo offline. No se probó toda la biblioteca ni un archivo offline preexistente de un usuario. |
| 7 | Cada mejora queda justificada por medición antes/después | Incompleto: falta transferencia real por modo de precarga, bitrate efectivo por navegador y CPU/RAM durante reproducción; el inicio solo tiene la comparación exploratoria descrita. |

Las pruebas automatizadas se ejecutaron después de cada fase. Resultado final tras la corrección adicional: backend 542/542, frontend 653/653, lint y build pasan. No sustituyen los requisitos de ejecución real que siguen sin evidencia:

- No se verificaron pantalla apagada, segundo plano ni Media Session en un dispositivo Android. `adb` no está instalado en este entorno.
- No se completó un `next`/`previous` natural entre dos pistas autorizadas distintas. `Anterior` solo reinició la pista actual; `Siguiente` se ejercitó con una cola de un elemento.
- No hubo cambio de pista real mientras una resolución estaba pendiente ni inyección de 403/502/503, expiración o desconexión en un teléfono; esos casos solo tienen tests automatizados.
- No se midieron bytes recibidos por cliente, reducción de transferencia por precarga, bitrate Opus/AAC real en varios navegadores ni recursos de proceso durante reproducción.

### Revalidación del objetivo de descarga local

El 2026-10-20 se repitió una reproducción directa en un staging nuevo, con almacén `data-staging-capacity`, resolución `full`, cuenta invitada aislada, transporte `direct-experimental`, calidad alta, precarga `url-only` y reproducción automática desactivada. Se usó la pista autorizada Big Buck Bunny de Blender.

- El elemento nativo estuvo reproduciendo desde un host `googlevideo.com`, con `readyState=4`, `currentTime=6.41 s` y sin error.
- El backend registró 2 preparaciones correctas, 0 preparaciones fallidas, 0 solicitudes de proxy, 0 rangos, 0 bytes de cuerpo escritos por el proxy, 0 reintentos y 0 respuestas fallidas. El resolvedor quedó inactivo y sin cola al consultar.
- Esto verifica que en esta sesión el audio llegó desde el origen directo y no atravesó `/api/stream-proxy`. El navegador restringió `transferSize`/`encodedBodySize` de la respuesta multimedia entre orígenes; no se midió el total de bytes recibidos por cliente ni el contador de subida de la interfaz de red.
- Es una sesión de un cliente y no demuestra cuántos usuarios simultáneos soporta el sistema. Tampoco mide el costo del resolvedor bajo concurrencia.

La prueba corrige la evidencia anterior sobre el arranque directo: ahora hay una reproducción integrada confirmada en esta rama. No cubre la reproducción nativa después de un fallo directo, la carga de múltiples clientes ni el dispositivo Android conectado.

### Perfil nuevo en modo Auto y recuperación integrada (medición anterior)

En otra sesión aislada se usó un origen de navegador nuevo, por lo que no existía `velocity.directPlaybackCompatibility`. Con `Auto`, calidad alta, precarga `url-only` y reproducción automática desactivada, Big Buck Bunny llegó a `playing` desde `localhost` (`readyState=4`, sin error). El contador de staging registró 2 preparaciones correctas, 6 rangos `206` y 2,870,521 bytes enviados por el proxy. Así, un perfil nuevo en `Auto` sí usa el proxy y sí consume subida local de audio; no recibe el ahorro directo sin una activación previa del modo experimental.

Después se verificó el fallback integrado desde `Directo Experimental`. Se hizo fallar el origen multimedia con un host DNS sintético bajo `googlevideo.com`, sin imprimir ni guardar la URL del origen. La app registró `DIRECT_FALLBACK_PROXY_MOUNTED`; el elemento nativo cambió a `localhost`, quedó reproduciendo con `readyState=4` y sin error. El staging agregó seis rangos y 2,870,521 bytes de proxy durante la recuperación. La posición se reinició al sustituir manualmente el `src` para inyectar el fallo; por tanto, la continuidad de posición no queda verificada por esta prueba.

En esa medición, `Auto` aún esperaba compatibilidad previa. Esa decisión se resolvió después: Auto debe intentar el directo desde el primer uso y pasar al proxy firmado si falla. La implementación y su revalidación aparecen en la adenda siguiente. No se ejecutó una carga de múltiples clientes y no se infiere un número máximo de usuarios.

La validación se mantuvo en staging. No hubo commit, push, PR, despliegue ni verificación de producción. Los servidores en puertos 3001, 3002, 3003 y 3004 quedaron apagados. No se usaron cuentas ni datos de producción. Los datos efímeros de la nueva sesión de benchmark no se preservaron al archivar su worktree.

## Adenda — Auto intenta directo en el primer uso

Se cambió la regla de Auto: ahora selecciona una URL directa válida en el primer intento. Si el navegador informa un fallo del origen directo mientras la pista sigue en reproducción, registra solo el proveedor en `sessionStorage` y monta una vez la URL firmada del proxy. Las pistas posteriores de ese proveedor usan el proxy durante la sesión de la pestaña. Un inicio directo exitoso borra ese bloqueo; `Directo Experimental` permite volver a probarlo manualmente. La URL del origen no se guarda. El proxy, la firma HMAC y los modos `proxy` y `direct-experimental` se conservan.

En staging nuevo (`data-staging-auto-clean`, puerto 3006), se inició sesión invitada desde un origen de navegador limpio, con `Auto`, calidad alta, `url-only` y reproducción automática desactivada. Big Buck Bunny llegó a reproducirse desde `googlevideo.com`, con `readyState=4`, `currentTime=26.24 s` y sin error. Al tomar la muestra había 2 preparaciones correctas, 0 fallidas, 0 solicitudes/rangos del proxy y 0 bytes escritos por el proxy; yt-dlp estaba en 0 procesos activos y 0 en cola (límites 4/32). Esto confirma que Auto en un perfil nuevo evita la transferencia del cuerpo multimedia por el proxy local en esta sesión.

Después se inyectó un fallo DNS sintético sobre el elemento directo. La aplicación registró el bloqueo del proveedor `youtube`; la fuente nativa cambió al origen local y siguió reproduciendo con `readyState=4`, `currentTime=6.74 s` y sin error. El contador agregado de staging quedó en 3 preparaciones correctas, 12 rangos `206`, 5,741,042 bytes escritos por el proxy, 0 reintentos y 0 respuestas fallidas. El agregado no permite atribuir cada byte a una pista concreta. La sustitución sintética reinició la posición, por lo que esta sesión no verifica conservar el segundo exacto durante la recuperación.

Verificación posterior a esta modificación: las pruebas focalizadas pasaron 48/48; `npm run verify` pasó con 542/542 pruebas backend y build; `frontend/npm test` pasó con 654/654; `npm run lint:errors` y `git diff --check` pasaron. El build mantiene los avisos ya existentes sobre el chunk de 571.67 kB y la importación mixta de `offlineLibrary.js`. El navegador de staging registró fallos de red de miniaturas; no afectan la observación del elemento de audio, pero invalidan cualquier lectura de rendimiento general de esa sesión.

La evidencia confirma el objetivo funcional principal: reproducción directa observada sin bytes de audio del proxy, con fallback funcional. No estima usuarios simultáneos ni prueba el límite de capacidad del host. Siguen pendientes una carga controlada con varios clientes y una comparación suficiente de tiempos de inicio contra la referencia; tampoco se probó el dispositivo Android porque `adb` no está disponible en este entorno. No se hizo commit, push, PR, despliegue ni verificación de producción.

### Prueba concurrente limitada

En staging se crearon cuatro sesiones invitadas y se enviaron cuatro solicitudes concurrentes de preparación para la pista autorizada Big Buck Bunny. Las cuatro obtuvieron URLs directas y preparaciones correctas en ~4.69 s cada una. Se iniciaron cuatro elementos de audio silenciados en el mismo navegador: todos llegaron a `readyState=4`, avanzaron aproximadamente 6 s, y no registraron errores. Durante esa muestra el backend contabilizó 4 preparaciones correctas y 0 solicitudes, rangos o bytes de proxy; el resolvedor terminó en 0 procesos activos y 0 en cola.

Es una prueba concurrente pequeña de cuatro sesiones lógicas, no cuatro dispositivos o redes independientes. Los elementos usaron la misma pista y el mismo navegador; la medición no establece el máximo de clientes, el uso externo exacto del CDN ni el comportamiento bajo saturación. Para estimar capacidad del host aún hace falta una prueba progresiva con varios clientes independientes, pistas autorizadas y límites de carga definidos.
