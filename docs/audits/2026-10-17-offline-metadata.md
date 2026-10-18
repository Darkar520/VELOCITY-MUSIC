# Metadatos y carátulas sin conexión

## Alcance y causas confirmadas

El usuario confirma reproducción correcta en iPhone y Samsung/Brave. Esta
intervención prepara 3.19 / worker v90 para imágenes y metadatos offline; no
certifica que todos los sistemas operativos pinten siempre una notificación.

1. El foreground guardaba audio con cacheCover=false y dejaba imágenes para
   mantenimiento posterior. El worker guardaba solo la URL remota. Cerrar antes
   del mantenimiento dejaba descargas sin imagen local.
2. coverToDataUrl envolvía /img?u=... dentro de otro /img?u=..., invalidando
   imágenes normalizadas. Dos regresiones fallaron antes del cambio: nueva
   descarga y recuperación de una antigua.
3. Una reparación actualizaba el catálogo sin notificar al reproductor de la
   misma pista. Una portada nueva podía permanecer invisible hasta otro render.
4. El catálogo reemplazaba metadatos completos por objetos parciales; valores
   vacíos podían borrar texto o duración conocidos.

## Implementación

- Helper de imagen compartido entre página y worker. Conserva el proxy/id,
  guarda los bytes como data URL en los dos registros IndexedDB existentes y
  limita intentos a ocho segundos y dos imágenes simultáneas. Acepta imágenes
  de hasta 1 MiB; comparte peticiones simultáneas de una misma URL.
- Ambos caminos intentan guardar imagen antes de anunciar la canción completa.
  Si no se obtiene, el audio sigue disponible y artworkStatus queda pending,
  sin afirmar que la imagen está guardada. La recuperación al iniciar/volver
  online/foco reintenta pendientes, con una sola tarea compartida.
- El backfill lee primero el almacén ligero meta; reescribe únicamente los
  registros necesarios y solo anuncia una reparación tras commit. No vuelve a
  descargar ni recodifica audio. Conserva imágenes y texto ya guardados.
- Cambios del catálogo notifican al reproductor activo, con suscripción por id
  y limpieza al desmontar. Solo se actualizan campos de metadatos; la fuente
  nativa y la intención de reproducción no se reemplazan.
- Media Session valida /offline-artwork/:id, servida por el worker desde meta.
  Publica esa URL local cuando hay una imagen, sin depender de un blob efímero
  de documento. Un worker antiguo, no controlador o que devuelve HTML conserva
  el fallback local data/blob. No se modifica la política de audio.

## Evidencia

- npm run verify: 455 pruebas Node, cero fallos y build correcto.
- Frontend completo: 533 pruebas, 47 archivos, cero fallos.
- Lints backend/frontend y diff-check sin errores.
- Casos negativos: proveedor 404/HTML/imagen demasiado grande, metadatos
  parciales, worker antiguo con shell HTML, cancelación/cuota de descargas,
  desmontaje de suscripciones y conservación de playSrc.

Brave de escritorio, staging aislado localhost:3001:

- Descargas por la interfaz: Intro (2.226.441 bytes) y VCR (2.733.714 bytes).
  Ambos registros contienen imagen data local y artworkStatus=ready.
- Se desactiva la red con CDP y se recarga la PWA. navigator.onLine=false y
  /api/status falla como control negativo; VCR reproduce desde blob, con
  duración 176,541 s y avance confirmado más allá de 115 s. Su reanudación
  conserva título VCR, artista The xx y álbum xx.
- La imagen de Media Session responde 200 image/jpeg desde /offline-artwork,
  40.963 bytes; se decodifica a 1200x1200. SHA-256:
  700fc4dc9da9721c5fda6589ff6a9c1548e87a566f81ea969a7563e8890eb628.
- La barra y las imágenes data locales se decodifican sin red. La captura de
  escritorio muestra portada y progreso. La emulación de ventana móvil produjo
  capturas incompletas pese a imágenes decodificadas; no se usa como evidencia
  visual de hardware móvil ni se infiere que el SO haya pintado la notificación.
- Un registro de control antiguo con URL remota recupera su carátula al volver
  online. Su audio conserva 2.733.714 bytes y el mismo SHA-256 del original.

## Límites y validación pendiente

Una imagen que nunca se descargó no se puede obtener sin red. Las antiguas se
reparan al abrir con conexión cuando el proveedor responde. No se inventan
álbumes ni otros campos ausentes de la fuente. El almacenamiento del navegador
puede ser eliminado por el usuario/OS; no existe garantía absoluta de retención.

Falta comprobar el pintado real de notificación/pantalla bloqueada en Samsung
Brave e iPhone, después de actualizar, descargar y abrir en modo avión. Probar
minirreproductor, vista ampliada, dos canciones y reapertura. El feed principal
queda para el siguiente trabajo solicitado; no se modifica en esta intervención.
