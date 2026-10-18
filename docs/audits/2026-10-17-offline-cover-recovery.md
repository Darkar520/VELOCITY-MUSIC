# Recuperación de carátulas vacías o descubiertas después de descargar

Continuación de 3.19. La revisión de código encontró dos casos reproducibles:
backfillCovers excluía registros con cover vacío y el enriquecimiento posterior
del catálogo no se guardaba automáticamente en una descarga ya completada.
Las dos regresiones fallaron antes del cambio; no se infiere que todas las
carátulas ausentes del teléfono tengan estas causas.

## Implementación 3.20 / worker v91

- La recuperación puede consultar la mejor portada conocida del catálogo,
  incluyendo descargas antiguas cuyo cover sea vacío. El placeholder de Velocity
  no se considera una portada real guardada.
- saveCover consulta solo los metadatos del id solicitado. Si la imagen ya
  existe, no descarga ni reescribe audio. Si falta, intenta guardar la imagen;
  actualiza audio/meta en una transacción y conserva los demás campos actuales.
- El reproductor solicita esa persistencia cuando cambia la portada conocida
  de su descarga activa. No hace barridos de biblioteca ni resuelve audio en
  ese efecto; veinte cambios de reloj no añaden llamadas en el test.
- La lectura definitiva y escritura comparten transacción para no recrear una
  descarga borrada mientras llegaba la imagen. Un commit fallido devuelve null;
  no anuncia una reparación. Promover una portada no revierte texto más reciente
  que ya estuviera en el catálogo.

## Verificación

- npm run verify: 455 pruebas Node, cero fallos y compilación correcta.
- Frontend completo: 541 pruebas en 47 archivos, cero fallos.
- Lints backend/frontend y diff-check sin errores.
- Casos: registro vacío con imagen conocida, portada posterior a la descarga,
  placeholder, borrado durante fetch, cuota/commit fallido, texto más reciente,
  reloj sin trabajo repetido y regresiones de fuentes/audio existentes.

Brave, staging aislado localhost:3001, con IndexedDB nativa:

1. Se crea un registro de control con cover vacío, copia de audio existente y
   una imagen de control conocida por el catálogo (/icon-512.png). Al reabrir,
   ambos almacenes contienen la misma imagen data y artworkStatus=ready. Los
   2.733.714 bytes de audio conservan el mismo SHA-256. Es un control de
   persistencia, no una afirmación de artwork musical ni de exactitud semántica.
2. Otra descarga temporal se borra después de recibir una imagen 200 (40.963
   bytes) y antes de permitir su commit. No se recrea ni audio ni metadata. El
   wrapper temporal de fetch se retira al terminar. No se prueba este caso
   provocando fallos de red; la respuesta de imagen fue exitosa.

Artefactos locales: test-results/offline-cover-recovery/. La prueba física de
carátulas en notificación/pantalla bloqueada de Samsung/Brave e iPhone continúa
pendiente de respuesta del usuario. Estos cambios no amplían las capacidades
del sistema operativo ni permiten recuperar desde cero una imagen sin fuente.
