# Arranque de descargas y saltos falsos de cola

## Evidencia del usuario

Canciones marcadas como descargadas fallan desde Me gusta o la cola, mientras
Buscar permite reproducirlas. El usuario confirma el fallo con y sin internet;
sin red, la misma descarga puede sonar después de pulsar play varias veces.
Ese último dato impide concluir que los bytes estén dañados. No se han borrado,
invalidado ni sustituido automáticamente las descargas del usuario.

## Causas reproducidas

1. hardStopAudio retiraba src y luego asignaba src=''. Esa segunda operación
   inicia otra selección de recurso. En Brave/Windows, usando repetidamente un
   blob válido de IndexedDB, produjo 23 eventos MediaError 4 en 30 cargas, a
   menudo con atributo vacío y currentSrc apuntando al blob anterior. Las 30
   cargas posteriores decodificaron metadata correctamente. La intervención
   única de quitar la asignación vacía produjo cero errores en otras 30 cargas,
   con 30 decodificaciones. Es una prueba del mecanismo del navegador; no una
   medición estadística representativa de todos los dispositivos.
2. El manejador prefería currentSrc sobre el atributo actual y no exigía un
   MediaError vigente. La comparación del handler de main 2f75503 con el actual
   reproduce cuatro estados de evento tardío: atributo ausente, atributo vacío,
   recurso anterior distinto y error nativo ya reiniciado. El anterior pausaba
   y programaba next en los cuatro; el nuevo los ignora. La supresión temporal
   de errores no sustituye esa comprobación de identidad.
3. ensureStream solo leía IndexedDB si downloaded.has(id) era true y exigía
   título/artista antes de leer los bytes. Dos regresiones fallaron antes del
   cambio: archivo existente con índice visual sin hidratar y archivo local
   sin artista. Ahora ambos reproducen desde blob sin preparar streams remotos.
4. El presupuesto anti-cascada se reiniciaba también al avanzar automáticamente
   con keepMix. Se conserva entre avances; una selección explícita o audio
   sostenido mantienen los reinicios existentes.

## Implementación 3.22 / worker v93

El estado relevante es S=(trackId, epoch, srcAttr, currentSrc, MediaError,
intent). Un evento de error de media solo es elegible si srcAttr es no vacío,
MediaError existe, currentSrc coincide con la URL absoluta de srcAttr y el id
del handler coincide con el id de la máquina. Un timeout de progreso sigue
su vía explícita kind=stall, sin inventar un MediaError.

- Vaciar significa retirar el atributo, sin asignar URL vacía ni load vacío.
- Retirar/sustituir la fuente precede a revocar su object URL. La URL nueva se
  publica por STREAM_READY en la máquina de audio existente.
- IndexedDB decide disponibilidad antes de consultar red o validar artista.
  Una lectura tardía tras pausa, cambio de pista o desmontaje no monta audio.
- La restauración inicial comprueba id, intención, epoch y fuente existente
  antes de publicar su resultado asíncrono.
- Un fallo local actual puede reabrir el mismo archivo una vez. Duplicados del
  mismo evento/URL no consumen otro intento. Si falla otra vez, se detiene con
  un motivo concreto; no salta la cola ni trata el fallo como prueba de archivo
  dañado. No introduce dependencia de internet para recuperar audio local.
- No cambia el comportamiento de ceder foco a otras apps ni los formatos o
  firmas HMAC. Las pruebas A7-A31 siguen pasando.

## Verificación y alcance

- Gate local: 461 pruebas Node, cero fallos, compilación correcta. Frontend:
  553 pruebas en 48 archivos, cero fallos (threads, dos workers).
- Controles negativos: fuente anterior, src vacío, error ya reiniciado,
  pausa/desmontaje durante lectura, doble evento del mismo recurso y límite
  de recuperación local. La revocación verifica que la URL ya no está asignada.
- Brave con IndexedDB nativa: descarga real de i think about you all the time
  (OnGf-JgMaSU, 4.102.415 bytes, WebM) y No Me Destruyas (SDTCLbM9JdI,
  3.652.960 bytes, WebM), añadidas al Me gusta del usuario de staging.
- Con staging apagado y navigator.onLine=false, Deftones arranca desde Me
  gusta con un toque y supera 46 segundos usando blob, sin preparación remota.
  Quince cambios consecutivos alternando las dos pistas arrancan con un toque
  cada uno, reloj avanzando, paused=false y MediaError=null. Son quince cambios
  entre dos archivos, no quince canciones distintas.

Los registros de progreso sostenido, final natural y reapertura se conservan
por separado en test-results/downloaded-playback-20261018/. No se infiere que
metadata decodificada implique reproducción completa ni que Windows pruebe
la presentación física o todas las condiciones de Samsung/Brave. La causa
exacta de cada evento del teléfono requiere validar la versión nueva allí;
el mecanismo y los defectos anteriores sí están reproducidos localmente.
