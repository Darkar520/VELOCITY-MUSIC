# Continuidad y selección de formato — continuación de la auditoría móvil

## Alcance

Seguimiento de la versión 3.17. El objetivo móvil sigue abierto: Samsung/Brave,
iPhone/Safari, Chrome, Firefox, Opera Mini y consumo térmico requieren evidencia
física. Esta intervención prepara 3.18 / worker v89 y reduce dos operaciones
redundantes demostradas; también añade una fuente compatible para un navegador
que declare AAC pero rechace WebM. No certifica esos navegadores desde Windows.

## Defectos y controles

- App sincronizaba fuente/volumen con otro play() aunque el elemento ya estuviera
  activo. Una prueba de shell con el comportamiento nativo paused=false detectó
  dos llamadas donde se esperaba una. selectPlaySync recibe ahora audioPaused:
  el elemento activo no requiere play; el watchdog conserva su efecto explícito
  para recuperar un bloqueo confirmado.
- El regreso de foco comparaba dos muestras casi iguales sin duración mínima.
  La prueba de una sola muestra produjo DOC_VISIBLE antes de corregir. Se exige
  la observación sostenida de la fuente actual; un elemento realmente pausado
  sigue reanudándose en el control negativo.
- El servidor priorizaba Opus/WebM sin conocer capacidades del navegador.
  WebKit documenta WebM en iOS desde Safari 17.4. Se comprueban canPlayType de
  WebM/Opus y MP4/AAC una sola vez por página. Solo una afirmación de soporte
  AAC y ausencia de WebM activa high/medium/low-aac. Capacidad desconocida conserva
  el comportamiento anterior; no se deduce soporte de la marca del navegador.
- Los perfiles seleccionan m4a HTTPS original y conservan el tier de calidad:
  alta usa el mejor m4a disponible, media/baja conservan sus preferencias. No
  implican igualdad de bytes/bitrate frente a Opus, ni recodificación. No vuelven
  a WebM como fallback. Si el proveedor carece de m4a se devuelve su fallo.
- Preparación, prefetch, caché de firmas y descargas utilizan el mismo perfil.
  El ensamblador de URLs ya firmadas NO cambia sus parámetros. La prueba HMAC
  comprueba que cambiar high-aac a high/low-aac invalida la firma.
- Un WebM offline positivamente incompatible no se borra ni se convierte: se
  usa la fuente compatible online. Sin red no puede convertirse en reproducible
  por una promesa del código; requiere descargar un formato compatible. La
  misma comprobación se aplica a la hidratación y a la selección de pista.

## Verificación

Gate local: 448 pruebas Node, cero fallos y build correcto. Frontend completo:
526 pruebas / 46 archivos, cero fallos. Lints y diff-check correctos. Los dos
casos de replay/foco y la integración de perfil fallaron antes de corregirse;
la nueva selección m4a también falló antes de implementarse en el backend.

Sonda real en staging aislado (3001), Intro / The xx, high-aac:

- preparación 200 en 6732 ms;
- archivo completo: 2.073.497 bytes, 1377 ms;
- SHA-256: 1673d740670b82a8915a4e6394b32af8a05928405735cdf53b986ca5905648a5;
- cuatro rangos reconstruyen los mismos bytes/hash; seek final correcto;
- firmas alteradas y vencidas responden 401;
- sonda completa: ok=true, 9866 ms.

La interfaz se prueba en Brave con una simulación temporal que hace que
canPlayType niegue WebM y conserve su afirmación de AAC. Esa intervención no
convierte Brave en Safari ni prueba ahorro de energía o audio físico móvil.
Los resultados de navegador se guardan en test-results/mobile-audio/.

## Referencias primarias

https://webkit.org/blog/15063/webkit-features-in-safari-17-4/
https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
