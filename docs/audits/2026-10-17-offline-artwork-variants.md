# Carátulas de lista disponibles y reproductor vacío sin conexión

## Evidencia y diagnóstico

Las cuatro capturas del Samsung muestran una regresión real dentro de la app:
People Are Strange aparece con el placeholder en el reproductor ampliado y
mini; Time tiene imagen en la lista y no en el mini. Hay dos condiciones
distintas: navegador sin conexión y servidor no disponible con datos móviles.
Las capturas no muestran la versión de la app ni el contenido de IndexedDB;
no permiten atribuir todos los casos del teléfono a una sola causa.

Se reprodujo una causa suficiente en Brave con el worker v91: una portada
real cacheada a 512px carga, mientras sus variantes de 96, 900 y 1200px fallan
con el servidor de staging apagado. Esos tamaños corresponden a lista, mini,
vista ampliada y metadata original. La emulación de red del documento por sí
sola no bastaba: el worker todavía podía consultar al servidor. El control
válido apagó el proceso de staging, sin tocar producción.

Otros dos defectos confirmados por código: la activación del worker eliminaba
la caché de imágenes anterior junto con el shell; la reparación de metadata
se omitía cuando navigator.onLine era false, aunque la portada ya estuviera
en CacheStorage con otro tamaño.

## Implementación 3.21 / worker v92

- El helper compartido recupera variantes locales del mismo recurso de imagen
  antes de consultar la red. Normaliza únicamente tamaños conocidos de Google
  e iTunes; conserva host, ruta y demás parámetros. Si ambos proxies tienen id
  explícito, deben coincidir. No empareja imágenes por título ni por artista.
- Las peticiones /img del worker pueden usar la misma variante cacheada en las
  distintas vistas. Una petición sin copia local tiene un plazo de 8 segundos
  para recibir respuesta; los errores no se guardan como imágenes.
- Las portadas HTTP pasan a velocity-artwork-v1, independiente de la versión
  del shell. Al actualizar se trasladan las imágenes válidas de cachés antiguas
  antes de borrarlas. Si falla la copia, se retiene la caché anterior. Cachés
  ajenas a Velocity no se eliminan.
- La reparación de descargas antiguas funciona también sin red: puede copiar
  una imagen local de CacheStorage a la metadata de IndexedDB. Sin copia local
  y sin conexión devuelve pendiente sin iniciar una petición remota.
- Se conserva la escritura transaccional existente y la protección contra
  resucitar descargas borradas. No cambia la política de reproducción ni los
  archivos de audio. El helper público de artwork se sirve con no-cache en Pages.

## Pruebas

- La regresión de metadata con variante 512 falló antes del cambio: conservaba
  la URL remota y artworkStatus=pending. Después guarda la imagen data sin red.
- Node: 460 pruebas, cero fallos; compilación correcta. Frontend: 544 pruebas
  en 47 archivos, cero fallos, usando threads con dos workers en esta máquina.
  Los intentos locales completos con el pool de procesos no terminaron y se
  cancelaron; no se cuentan como verificación exitosa.
- Controles negativos: otra imagen del mismo id y la misma imagen con otro id
  explícito no se sustituyen; HTML no se migra como portada; una imagen ausente
  devuelve un error controlado. Un fallo de copia conserva el original.
- Biblioteca de 354 registros: una descarga antigua se repara desde su imagen
  512 cacheada con navigator.onLine=false; ninguna llamada a fetch y todas las
  referencias de blobs permanecen iguales en ese test.
- Brave con CacheStorage e IndexedDB nativas, staging apagado: 512, 96, 900 y
  1200 cargan desde la copia 512 tras la actualización. También se guardan
  localmente portadas antiguas de VCR e Intro; el SHA-256 y tamaño del audio se
  mantienen: VCR 2.733.714 bytes; Intro 2.226.441 bytes. Un registro sintético
  adicional con audio real de VCR, URL remota y únicamente imagen 512 cacheada
  pasa de pending a ready. Es un control de reparación, no otra canción.
- La app reproduce VCR y después Intro desde blob sin red. Intro supera 60 s
  reproduciendo; mini y vista ampliada muestran la portada local de 512px.
  Media Session publica /offline-artwork/xMV6l2y67rk con image/jpeg; otra
  reapertura sin red conserva esa portada y la URL local de Media Session.

Artefactos: test-results/offline-artwork-variants/{before.json,after.json,
expanded-offline.png}. La captura usa una ventana de Brave de tamaño móvil en
Windows; no demuestra la notificación física de Android. La primera sesión
restaurada de VCR publicó iconos de app, aunque la ruta local respondió imagen;
al seleccionar Intro y al reabrir Intro se publicó la portada correcta. No se
atribuye esa observación inicial al sistema operativo ni se declara resuelta
para toda secuencia de arranque.

## Límites y pendiente

No se puede reconstruir una portada nunca guardada mientras todas sus fuentes
sean inaccesibles. El navegador también puede desalojar almacenamiento. Falta
confirmar en el Samsung del usuario las pistas reportadas, la portada al abrir
sin conexión y su representación en notificación/pantalla bloqueada. El feed
queda fuera de esta corrección.
