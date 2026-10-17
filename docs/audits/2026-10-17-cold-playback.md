# Canciones nuevas, continuidad y coste de arranque — 17 de octubre de 2026

Esta ronda amplía la auditoría anterior con IDs distintos, comprobación de
ausencia de descargas y de URLs vigentes en la caché persistida antes de
reproducir. No se borró la biblioteca ni la caché de producción. Una canción
precargada por la propia cola sigue siendo una prueba de reproducción continua,
pero no debe contarse como un nuevo arranque frío al llegar a ella.

## Primera cola pública, antes de la optimización adicional

El álbum `xx`, The xx (`MPREb_Q6bqk6BLU6O`), contenía once pistas. Ninguna estaba
en el store `tracks` de IndexedDB ni tenía una entrada vigente por ID en
`data/stream-cache.json` al comprobarlo antes de pulsar Reproducir. No se habían
usado esos IDs en las pruebas anteriores de esta auditoría. Esto no demuestra
que el propietario nunca haya escuchado la obra en otro navegador o servicio.

Se pulsó Reproducir una vez y se dejó avanzar sin seek ni pulsar siguiente:

| Pista | ID | Duración y fin natural | Primer `playing` | `ended` |
|---|---|---:|---:|---:|
| Intro | `xMV6l2y67rk` | 127,941 s, completo | 1792264292049 | 1792264420316 |
| VCR | `gI2eO_mNM88` | 176,541 s, completo | 1792264420891 | 1792264597542 |
| Crystalised | `Pib8eYDSFEI` | 201,081 s, completo | 1792264598355 | 1792264800218 |

Las transiciones fueron 575 ms y 813 ms. La primera reproducción necesitó unos
7,8 s desde la instrumentación inmediatamente anterior al clic. Intro y VCR
tuvieron una espera de 14/22 ms respectivamente en tiempo 0. Crystalised tuvo
esperas recuperadas de 8 y 14 ms a 36,24 y 46,95 s. Ninguna quedó detenida ni
emitió `error` o `stalled`. La siguiente, Islands, arrancó automáticamente y se
pausó para actualizar el backend. No se contabiliza como canción completa.

Artefacto local: `test-results/playback-audit/cold-baseline-events.json`.

## Intervención sobre el tiempo de arranque

Se comparó el ejecutable standalone con el paquete oficial descomprimido,
ambos versión 2026.08.19, usando la misma pista y argumentos, sin StreamCache.
Se alternó el orden de ejecución en la segunda ronda. Son dos muestras por
variante; no una estimación de percentiles de producción.

| Variante | `--version`, dos muestras | Extracción completa, dos muestras |
|---|---|---|
| Standalone one-file | 3.451 / 3.424 ms | 5.776 / 5.677 ms |
| Distribución descomprimida | 1.431 / 1.135 ms | 3.446 / 3.817 ms |

La intervención reduce el coste observado de iniciar Python y sus dependencias.
No se atribuye toda diferencia de red a ese coste. No cambia el deadline global
de 18 s, los filtros de coincidencia, el formato ni la calidad de audio.

El paquete `yt-dlp_win.zip`, 18.087.041 bytes, se verificó contra SHA-256 oficial
`30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf`.
El instalador reproducible, selección de runtime y mantenimiento están descritos
en [PLAYBACK-RUNTIME.md](../PLAYBACK-RUNTIME.md). No se versiona el binario.

## Descargas completas con IDs de otros artistas, staging

Se inició staging con `VELOCITY_DATA_DIR=data-staging/cold-audit-20261017`,
separado de producción, y se forzó cada resolución con `--refresh`.

| Pista | Preparación | Bytes completos | Rangos | SHA-256 del cuerpo y sus rangos |
|---|---:|---:|---:|---|
| Don't Know Why — Norah Jones (`GtOcxj3NDBI`) | 3.816 ms | 3.257.849 | 7 | `55edd2779ee2a1628ca0da3531522a95419017b6338628b05d92e2fc03944d4e` |
| Rolling in the Deep — Adele (`x9Qv47HpEqw`) | 3.696 ms | 3.635.310 | 7 | `1c3ff50f05a124db5c6f3c5119e38df5768a0d83548c85817fdfb6f5ee88a875` |
| NUEVAYoL — Bad Bunny (`WdSGEvDGZAo`) | 4.763 ms | 3.264.790 | 7 | `c432fce8c7483f9ea33986878addd37922cea64e6733ad2798b2efc27f8833cb` |

Las tres pasaron seek al final y firmas inválidas/caducadas → 401. Los tiempos
totales del protocolo fueron 6.987, 6.488 y 7.471 ms respectivamente. Estas
transferencias completas no se presentan como reproducción natural en UI.

Por el dominio público, NUEVAYoL también preparó audio sin caché en 3.633 ms.
Su cuerpo completo y los siete rangos terminaron; durante varias transferencias
diagnósticas concurrentes el cuerpo tardó 36.810 ms. Una sonda adicional con
límite total de 20 s expiró después de recibir 938.859 bytes: no demuestra un
atasco sin progreso. Al repetirla sin las descargas diagnósticas anteriores,
el cuerpo público de 3.264.790 bytes terminó en 10.324 ms, con el mismo SHA-256
que staging; se observaron incrementos de bytes durante toda la transferencia.
La misma descarga por localhost había tardado 1.600 ms. Esto separa el coste de
extracción del transporte público variable, sin atribuirlo a un único tramo
de red no instrumentado. La sonda permite ahora hasta 120 s al cuerpo completo;
la preparación mantiene su límite de 25 s en la sonda y 18 s en el backend.

## Listeners del proxy y prueba negativa

Se reprodujo el aviso secundario de la auditoría anterior: aplicar pipeline
repetidamente sobre la misma respuesta dejaba listeners por bloque. El nuevo
test falló antes del cambio (`4,4,2` listeners tras el primer bloque) y produjo
avisos MaxListenersExceeded. La corrección usa un Writable por bloque y conserva
solo listeners temporales de error/close/drain en la respuesta, retirados al
terminar el bloque. No se eleva el máximo ni se eliminan listeners ajenos.

Una primera variante de esta corrección pasó el mock, pero falló en staging:
la compresión envuelve `res.write` y no conserva el callback aunque su filtro
rechace comprimir audio. Norah Jones y Adele agotaron 25 s durante la descarga
completa. Esa variante nunca se desplegó en producción. Se añadió un test con
socket HTTP, Express y compression(filter=false), que reprodujo el timeout.

La versión final usa el retorno booleano de write y el evento drain para
preservar backpressure. El test HTTP y las transferencias reales anteriores
pasan con esa versión. El test de trece bloques comprueba que los listeners de
la respuesta se mantienen acotados; los cuerpos truncados siguen fallando.

## Segunda cola pública, con el runtime optimizado

El álbum/sencillo `Come Away With Me`, Norah Jones (`MPREb_aLfDDnwNOoB`),
contiene tres pistas en el catálogo consultado. Antes del clic se comprobaron
los IDs `lbjZPFBD6JU`, `wVMTcpX0K7E` y `gZIKzQGvm9I`: ninguno estaba descargado
ni tenía URL vigente en la caché persistida de producción.

Se pulsó Reproducir una vez; las tres terminaron de forma natural sin seek ni
intervención para cambiar de pista:

| Pista | ID | Duración completa | Primer `playing` | `ended` |
|---|---|---:|---:|---:|
| Come Away With Me | `lbjZPFBD6JU` | 194,561 s | 1792264910429 | 1792265105294 |
| Turn Me On (Live) | `wVMTcpX0K7E` | 308,681 s | 1792265106019 | 1792265423319 |
| Cold, Cold Heart (Live In Chicago) | `gZIKzQGvm9I` | 280,281 s | 1792265423943 | 1792265705509 |

Come Away With Me comenzó unos 7.916 ms después de la instrumentación previa
al clic. No se confunde ese tiempo de UI con la extracción comparativa de la
misma pista usada en el benchmark del runtime.

Turn Me On tuvo un primer `playing` 725 ms después del fin anterior, pero
volvió a `waiting` en tiempo 0 durante 8.523 ms, mientras se ejecutaban las
transferencias diagnósticas concurrentes. El arranque que se mantuvo ocurrió
a los 9.259 ms del fin anterior. No se atribuye causalidad exclusiva al túnel,
al navegador o al proveedor sin instrumentación adicional de esos tramos.

Cold, Cold Heart tuvo un primer `playing` a los 624 ms y una espera inicial
de 1.183 ms; el `playing` que se mantuvo llegó a los 1.832 ms del fin anterior.
Después del arranque, ninguna de estas tres pistas volvió a registrar
`waiting`, `stalled` o `error` durante su reproducción completa.

Al terminar la tercera, la cola continuó automáticamente con Don't Know Why
(`GtOcxj3NDBI`), primer `playing` a los 372 ms, estable a los 399 ms. Se pausó
manualmente en 62,157427 s. No se contabiliza como cuarta canción completa.
Se retiraron los listeners de diagnóstico y la pestaña quedó pausada.

Artefactos locales: `test-results/playback-audit/cold-optimized-events.json`,
`cold-norah-playing.jpg` y `cold-third-playing.jpg`. Las seis canciones completas
de ambas colas suman unos 21 min 29 s de contenido, además de los arranques y
las verificaciones parciales expresamente señaladas.

## Gate y límites

- `npm run verify` final: 436 pruebas de backend, 0 fallos; build correcto
  (12,68 s). Incluye la protección de generaciones durante otra instalación.
- Frontend: 468 pruebas en 38 archivos, 0 fallos; lint sin errores.
- Node 20 final: 70 pruebas específicas de extractor, instalación, proxy,
  concurrencia y adaptador, 0 fallos.
- Lint backend y `git diff --check`: correctos.
- Las regresiones de la máquina de audio A7–A14 siguen pasando; no se cambió
  su política ni se manipuló el store para conseguir las transiciones.
- Las muestras no permiten garantizar disponibilidad universal de YouTube,
  redes móviles no probadas o el funcionamiento de los altavoces físicos.

## Publicación

Se utiliza el PR #32 hacia main y se verifica CI antes de integrarlo. La API
de protección de main devolvió `Branch not protected` (404): la configuración
actual no confirma el gate obligatorio descrito en AGENTS.md. En esta
intervención se respeta el gate mediante comprobación explícita; configurar
la protección de rama evitaría que otros pushes omitan ese control.
