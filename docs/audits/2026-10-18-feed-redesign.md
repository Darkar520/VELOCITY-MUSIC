# Renovación de Inicio y primer acceso — 3.25

## Requisitos y evidencia

| Requisito | Implementación y comprobación |
|---|---|
| Más artistas según los géneros, incluidos conocidos | Roster editorial para los 50 géneros ofrecidos, al menos ocho nombres por género. EDM/Rock/Metal ofrecen 48 artistas únicos e intercalados. Test Node recorre todos los géneros; hook probado con catálogo fallido y recopilaciones falsas. |
| Feed desde el registro, sin historial | Registro normal real en staging, géneros Rock/Metal/EDM y Deftones. Aparecen colecciones de artistas/géneros/descubrimiento sin favoritos ni historial previos. También se probó invitado. |
| Gustos separados entre cuentas | Preferencias locales por cacheIdentity; caché por cuenta y firma de géneros/artistas. Test de cambio de cuenta y retorno, y rechazo de otra cuenta u otros gustos. |
| Canciones, recomendaciones y playlists | Destacado con portadas reales, seis canciones variadas, mixes por género/artista, descubrimiento, playlists guardadas y continuaciones desde historial real. Abrir mezcla, guardar y comprobar Guardado después de recargar: verificado en navegador. |
| Diseño renovado y móvil | HomeDiscovery, CSS responsive, vista desktop 1440 px y móvil 390 px; ancho del documento coincide con viewport. Portadas del destacado cargadas, navegación y cancelar ajuste de gustos probados. |
| Controles conectados al reproductor | Play desde feed: Minus Blindfold avanzó de 0.345603 a 38.307567 s, duración 244.301 s, readyState 4, paused false y sin MediaError; luego pausa explícita correcta. Tests de play, mix, favoritos y menú. |
| Carga, fallos parciales y recarga | Publicación incremental, petición lenta no bloquea otra rápida, seguridad 30 s, reintento visible, caché contextual, cancelación de respuestas antiguas, continuidad local offline. |
| Poder ajustar los gustos | Botón Ajustar gustos en destacado; precarga elecciones; cancelar no modifica preferencias. Prueba de edición/confirmación/cancelación y navegación real. |

## Causas confirmadas y correcciones

1. App marcaba libReady solo con favoritos/playlists/historial no vacíos. La
   cuenta nueva quedaba esperando permanentemente. Se eliminó la dependencia:
   la biblioteca hidrata aparte y el feed reacciona a contenido real posterior.
2. El constructor exigía dos secciones antes de usar preferencias: dependencia
   circular en cold-start. Se reemplazó por un constructor de 136 líneas frente
   a más de 600, con búsquedas directas por preferencias y publicación progresiva.
3. La firma omitía artistas y las preferencias/caché eran globales al
   dispositivo. Ahora la identidad y todos los gustos forman parte del contexto.
4. Descargas del dispositivo se usaban para inferir gustos iniciales. La prueba
   real añadió Bad Bunny/Norah Jones a un perfil Rock/Metal/EDM. Se retiró esa
   inferencia: solo historial/favoritos reales generan continuaciones de radio;
   descargas se publican como disponibilidad local en modo offline.
5. Búsquedas amplias EDM devolvían recopilaciones de uploaders. Se consultan
   artistas editoriales concretos y se filtra por identidad normalizada o
   colaboración explícita. Canciones de un uploader parecido se rechazan.
6. Recientes se rellenaba con recomendaciones sin escuchar. Ahora contiene
   únicamente historial real. La franja de continuar es compacta.
7. El preview no enrutaba /img al backend; las portadas parecían fallar. Se
   añadió ese proxy de desarrollo; las imágenes reales cargan en el navegador.

## Modelo e invariantes

La personalización es editorial y determinista; no se presenta como aprendizaje
automático ni como superioridad medida frente a otros servicios. Los textos
«En tu frecuencia» y «Un mundo por escuchar» son lenguaje de interfaz metafórico.

- Perfil = identidad de cuenta + géneros + nombres normalizados de artistas.
- Hasta 24 consultas iniciales, intercaladas por género; hasta seis artistas de
  descubrimiento y tres radios desde historial real. Consultas repetidas comparten
  promesa dentro de la regeneración; búsquedas concurrentes <=3, radios <=2.
- Cada petición recibe AbortSignal y deadline 10 s (artistas de bienvenida 8 s).
  El estado de carga se libera a los 30 s; esto no promete contenido si no hay red.
- Una respuesta solo publica mientras su efecto siga vigente. Cambio de cuenta
  o gustos cancela peticiones y descarta publicaciones de la generación anterior.
- La UI solo recomienda canciones con ID/título reales del catálogo. No se
  inventan escuchas, IDs, retratos ni cifras de popularidad.
- Los primeros seis temas alternan colecciones y admiten como máximo dos del
  mismo artista. El artista elegido tiene prioridad en el destacado.
- Preferencias almacenadas por cuenta en este dispositivo; no se implementó
  sincronización de gustos entre dispositivos. El dato legacy global se conserva
  en disco y no se adjudica a otra cuenta de propietario desconocido.

## Validación y límites

Suite completa local: 465 Node y 569 frontend aprobadas antes de añadir la
regresión adicional de caché por contexto y el test de edición. Tests adicionales
y suites específicas aprobados; CI del PR verificará el commit final completo.
Build Pages aislado y lint de errores aprobados. La validación visual móvil usa
emulación Brave/Windows, no hardware iPhone/Samsung. No se afirma una mejora
cuantificada de batería, retención ni superioridad subjetiva de diseño.

Artefactos locales: test-results/feed-redesign-20261018/; capturas desktop-325.png
y mobile-325.png, y evidencia de primer recorrido. Preview de producción aislado
4173 contra backend staging 3001 / data-staging, sin pruebas sobre cuentas reales.

Publicación y CI: pendientes al preparar este documento; deben verificarse antes
de marcar el objetivo terminado. Caché de shell v96 y versión 3.25 preparadas.
