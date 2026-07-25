# Integración Deezer en Velocity Music

> **Propósito:** educativo y de testing no comercial. Esta integración es opcional, no oficial y debe usarse respetando los términos de Deezer, los límites de sus servicios y las leyes aplicables.

## Alcance y límites importantes

Deezer es un **fallback de audio** para casos en los que YouTube Music no consigue resolver una pista. No sustituye al proveedor primario ni cambia su prioridad. La integración:

- Está pensada para pruebas controladas con una cuenta Deezer dedicada.
- No incluye credenciales reales ni recomienda compartirlas, registrarlas o versionarlas.
- No enseña a evadir DRM, descifrar contenido protegido, saltarse controles de acceso ni obtener material de forma no autorizada.
- **No hay descargas masivas ni procesamiento por lotes de descargas.** El flujo resuelve una pista bajo demanda para reproducción y puede conservar temporalmente su URL en caché.
- No garantiza disponibilidad, permanencia ni una calidad concreta de un servicio de terceros.

Antes de cambiar el pipeline, revisa las [guardas de regresión](GUARDRAILS.md), especialmente las reglas de continuidad y proxy de audio.

## Arquitectura

### Resolución de audio

La ruta de audio mantiene este orden:

1. `StreamCache` busca primero una URL válida ya resuelta.
2. Una URL `stream` explícita y válida se usa directamente.
3. En modo `full`, el extractor de **YouTube Music** intenta resolver la pista.
4. Solo si YouTube Music falla y se inyectó un extractor Deezer, se intenta **Deezer**.
5. Si no queda una fuente reproducible, el resolver devuelve estado degradado o `404`, según el contexto.

El resultado Deezer lleva `provider: "deezer"`; su clave de caché se separa como `deezer:<clave-normalizada>` para no reemplazar una entrada de YouTube Music. `forceRefresh` omite las cachés y permite una resolución nueva cuando una URL almacenada dejó de funcionar.

Implementación de referencia: [`audioResolver.js`](../src/services/audioResolver.js), [`deezer.js`](../src/extractors/deezer.js) y [`streamCache.js`](../src/services/streamCache.js).

### Catálogo y SoundCloud

La búsqueda de catálogo puede combinar YouTube Music con Deezer: los resultados de YouTube Music conservan prioridad y los de Deezer se normalizan, deduplican y añaden después. Deezer no inserta `streamUrl` en los metadatos de catálogo; la resolución ocurre bajo demanda.

**SoundCloud permanece como expansión de catálogo solamente.** Sus resultados pueden ayudar a descubrir pistas o conservar una URL explícita ya materializada, pero SoundCloud no se añade como fallback automático de audio en la cadena YouTube Music → Deezer. Una pista de SoundCloud sin URL reproducible no debe interpretarse como autorización para descargarla.

Consulta [`metadataService.js`](../src/services/metadataService.js) para el mapeo de metadatos y la deduplicación.

## Modos de operación

El proveedor expone tres modos seguros:

| Modo | Significado | Comportamiento |
|---|---|---|
| `full` | Deezer habilitado y con autenticación utilizable | Puede buscar, consultar metadatos y participar como fallback de audio después de YouTube Music. |
| `degraded` | Autenticación ausente/rechazada o fallo temporal | No bloquea YouTube Music. Puede intentar endpoints públicos permitidos; las operaciones que requieran sesión pueden devolver `null`. |
| `disabled` | Deshabilitado explícitamente o fallo crítico de contrato/API | Se retira del fallback. El resto de proveedores continúa funcionando. |

El estado es recuperable: los fallos temporales llevan a `degraded` y los cambios críticos de API pueden llevar a `disabled`; se realizan sondeos de recuperación acotados tras el cooldown configurado. Un estado Deezer nunca debe tumbar la resolución primaria.

## Configuración

La configuración se carga desde el entorno. La plantilla segura está en [`.env.example`](../.env.example). Recomendación para una instalación nueva:

```dotenv
# Desactivado hasta disponer de una prueba autorizada
DEEZER_ENABLED=0

# Placeholder deliberadamente no funcional; nunca lo sustituyas en el repositorio
DEEZER_ARL_TOKEN=replace-with-a-nonfunctional-test-arl-token
DEEZER_QUALITY=MP3_320
DEEZER_TIMEOUT_MS=5000
```

Variables admitidas:

| Variable | Valores / defecto | Uso |
|---|---|---|
| `DEEZER_ENABLED` | Desactivado por defecto; solo `1`, `true`, `on` o `yes` lo habilitan | Interruptor operativo. Cualquier otro valor, incluido vacío o ausente, mantiene Deezer desactivado. |
| `DEEZER_ARL_TOKEN` | Un ARL propio | Credencial de sesión; se mantiene fuera del código y de los logs. |
| `DEEZER_ARL_TOKENS` | Lista separada por coma, `;` o saltos de línea | Lista de rotación. También admite una lista JSON gestionada por un secret manager. |
| `DEEZER_ARL_TOKEN_2`, `_3`, … | Ranuras numeradas | Alternativa a la lista; se ordenan por número y se eliminan duplicados. |
| `DEEZER_QUALITY` | `MP3_128`, `MP3_320` o `FLAC`; defecto `MP3_320` | Calidad solicitada; puede degradarse si no está disponible. |
| `DEEZER_TIMEOUT_MS` | Entero positivo; defecto `5000` | Tiempo máximo de una operación Deezer. |

Si Deezer está habilitado sin un ARL válido, debe operar de forma degradada y no impedir el arranque ni la reproducción por YouTube Music. Las clases de configuración y token son [`deezerConfig.js`](../src/extractors/deezerConfig.js) y [`deezerToken.js`](../src/extractors/deezerToken.js).

## ARL: obtención autorizada y rotación segura

Un ARL es una credencial sensible de sesión. Para pruebas:

1. Usa una cuenta Deezer gratuita **propia y dedicada a testing**, nunca una cuenta de un tercero.
2. Obtén el valor únicamente mediante un proceso autorizado por el propietario de la cuenta y compatible con los términos de Deezer. Esta guía no documenta extracción de cookies, ingeniería inversa ni técnicas para esquivar controles.
3. Colócalo solo en el entorno de ejecución o en un gestor de secretos aprobado. Usa un placeholder no funcional en ejemplos y documentación.
4. Comprueba la configuración sin imprimir el valor: el diagnóstico debe indicar solo presencia/ausencia y el modo (`full`, `degraded` o `disabled`).
5. Para rotar, crea un ARL nuevo, añádelo a una ranura temporal de rotación, valida una operación de prueba, revoca/elimina el anterior y retira su valor del entorno. No lo pegues en issues, PRs, chat, capturas, fixtures ni logs.
6. Recarga la configuración del proceso o del servicio según el despliegue. La carga de configuración se realiza en tiempo de ejecución; no guardes tokens persistentes en disco.

El gestor mantiene credenciales y tokens en memoria, rota al fallar una credencial, comparte la renovación concurrente dentro del proceso y refresca de forma preventiva antes de la expiración. Los errores y métricas deben usar categorías y huellas no reversibles, nunca el ARL o el token de sesión. Para un runbook general de secretos, consulta [SECURITY-P0-ROTATION.md](SECURITY-P0-ROTATION.md).

## Resolución, calidad y caché

### Búsqueda y selección

`searchTracks(query, limit)` devuelve metadatos normalizados, nunca credenciales ni una URL de audio dentro del registro de catálogo. Para resolver audio, el adaptador puede buscar por artista y título y después consultar el identificador Deezer encontrado.

Las calidades estándar son:

- `MP3_128`: 128 kbps.
- `MP3_320`: 320 kbps.
- `FLAC`: lossless, cuando el servicio y la cuenta lo ofrecen.

Se intenta primero la calidad solicitada. Si no existe, se usa una alternativa disponible siguiendo la política de fallback del proveedor; por tanto, solicitar una calidad no garantiza que el resultado final tenga exactamente ese formato. La respuesta se normaliza a los identificadores de Velocity Music y una respuesta sin URL utilizable se trata como fallo, no como éxito parcial.

### Caché

- Las URLs Deezer se guardan con proveedor explícito y TTL de **24 horas** (`DEEZER_CACHE_TTL_SECONDS`).
- La caché separa las claves de Deezer de las de YouTube Music.
- Un hit devuelve `provider: "deezer"`; un fallo de la URL almacenada debe invalidarla y hacer una resolución fresca con `forceRefresh`.
- No se debe tratar una URL cacheada como permanente: puede expirar o ser revocada por el servicio upstream.
- La caché es para reducir latencia y llamadas repetidas durante reproducción normal; no es un mecanismo para recopilar contenido.

## Errores, reintentos y límites

El cliente clasifica los fallos como autenticación, rate limit, red/timeout, cambio de API, pista no encontrada u otros. Los `429` y fallos de red deben respetar backoff con jitter y un número acotado de intentos; no se deben convertir en un bucle agresivo. Una pista no encontrada es un resultado normal de búsqueda y no debe registrarse como error crítico.

El timeout de referencia del proveedor es 5 segundos. El timeout del resolver puede ser distinto, pero Deezer nunca debe bloquear indefinidamente la ruta primaria. Los logs pueden incluir operación, categoría, duración y estado; deben excluir ARL, tokens, cookies, URLs con credenciales embebidas y cuerpos de respuesta sensibles.

## Métricas y observabilidad

Registra métricas agregadas por proveedor y categoría, no datos de pistas que permitan reconstruir secretos:

| Métrica | Qué indica |
|---|---|
| `deezer_resolution_success_total` | Resoluciones Deezer exitosas, separadas de intentos y fallos. |
| `deezer_resolution_duration_seconds` | Duración de búsqueda/resolución para comparar con YouTube Music. |
| `deezer_cache_hit_ratio` | Efectividad de la caché Deezer; informa también hits, misses y expiraciones. |
| `deezer_auth_token_expiry_seconds` | Tiempo restante aproximado del token, sin exponer el token. |
| `deezer_api_error_by_type` | Conteo por `auth`, `rate_limit`, `network`, `api_change`, `not_found` y `unknown`. |
| contador de fallback | Veces que YouTube Music falló y Deezer fue intentado, con éxito o no. |

En el panel o endpoint de estado muestra como mínimo `mode`, disponibilidad y si la autenticación está configurada. No muestres el número de ARL, su longitud, su contenido ni una respuesta completa del gateway. La métrica de caché debe poder consultarse por proveedor para no mezclarla con YouTube Music.

## Troubleshooting

| Síntoma | Comprobaciones seguras | Acción |
|---|---|---|
| `mode=disabled` | Revisa `DEEZER_ENABLED`, la última categoría de fallo y si hubo cambio de API. | Mantén Deezer desactivado mientras se valida el contrato; YouTube Music debe seguir disponible. |
| `mode=degraded` o errores de autenticación | Confirma que el secret manager inyectó el ARL de la cuenta de testing y que no tiene espacios accidentales. No imprimas el valor. | Rota/revoca el ARL mediante el procedimiento autorizado y recarga la configuración. |
| YouTube Music funciona, pero nunca aparece Deezer | Verifica que la operación está en modo `full`, que el extractor Deezer está inyectado y que la petición de YouTube Music realmente falló. | Recuerda que Deezer es opt-in y no se prueba antes del proveedor primario. |
| La búsqueda muestra Deezer, pero no reproduce | Es normal si solo se conectó el catálogo; la búsqueda no materializa `streamUrl`. | Conecta el extractor de resolución y conserva el orden YouTube Music → Deezer. |
| Una URL cacheada devuelve error upstream | Revisa el hit/miss por proveedor y la expiración. | Invalida la entrada Deezer y reintenta una vez con `forceRefresh`; no aumentes indefinidamente los reintentos. |
| Timeout o muchos `429` | Revisa `DEEZER_TIMEOUT_MS`, latencia, concurrencia y métricas de rate limit. | Respeta backoff, reduce la presión y espera al cooldown; no paralelices resoluciones masivas. |
| Calidad inferior a la solicitada | Comprueba la calidad realmente devuelta y la política de fallback. | Acepta solo una calidad disponible y explícitala al usuario; no fuerces una URL inexistente. |
| Diferencias de artista, álbum o portada | Compara metadatos normalizados, duración e ISRC si existe. | Registra un mismatch sin datos sensibles y conserva prioridad de YouTube Music cuando corresponda. |

Para la continuidad del streaming y el proxy firmado, sigue [AUDIO-REGRESSIONS.md](AUDIO-REGRESSIONS.md) y no introduzcas una ruta de reproducción paralela.

## Prueba controlada recomendada

1. En un entorno aislado, deja `DEEZER_ENABLED=0` y confirma que el flujo de YouTube Music no cambia.
2. Activa Deezer solo con un ARL propio de testing inyectado por el secret manager y un timeout de 5000 ms.
3. Prueba una búsqueda de catálogo, una resolución donde YouTube Music falle y un caso donde ambos proveedores fallen.
4. Verifica que el resultado Deezer incluye `provider: "deezer"`, que la clave/TTL de caché son independientes y que `forceRefresh` evita la URL fallida.
5. Prueba la expiración/rotación con valores ficticios o dobles inyectados; no uses una credencial real en tests automatizados.
6. Revisa logs y métricas: deben mostrar categorías, tiempos y contadores, pero ningún secreto.
7. Desactiva Deezer al finalizar las pruebas si no existe una necesidad operativa justificada.

La validación de producción debe pasar por el flujo de staging y las puertas descritas en [RELEASE.md](RELEASE.md). Esta integración no cambia las reglas de autenticación del proxy de streaming ni autoriza descargas locales.

## Limitaciones y responsabilidad

Deezer es un servicio externo y su API, formatos, permisos, límites y URLs pueden cambiar sin aviso. El proveedor no controla disponibilidad regional, licencias, duración de URLs ni correspondencia perfecta de metadatos. Usa el mínimo alcance necesario, una cuenta de prueba separada y datos sintéticos en automatización.

Velocity Music no debe usarse para evadir DRM, capturar sesiones ajenas, redistribuir streams, almacenar contenido protegido fuera de las reglas del servicio ni hacer descargas masivas. **No hay descargas masivas en esta integración**: cualquier resolución es puntual, bajo demanda y orientada a reproducción educativa/testing.

## Referencias de implementación

- [`.env.example`](../.env.example): variables y placeholders no funcionales.
- [`audioResolver.js`](../src/services/audioResolver.js): orden de resolución y `forceRefresh`.
- [`metadataService.js`](../src/services/metadataService.js): catálogo, deduplicación y SoundCloud catalog-only.
- [`deezerConfig.js`](../src/extractors/deezerConfig.js): parseo/validación de entorno.
- [`deezerToken.js`](../src/extractors/deezerToken.js): ciclo de vida y rotación en memoria.
- [`deezer.js`](../src/extractors/deezer.js): modos, calidad y manejo seguro de errores.
- [`streamCache.js`](../src/services/streamCache.js): TTL, proveedor, invalidación y estadísticas.
- [`GUARDRAILS.md`](GUARDRAILS.md): invariantes generales del sistema.
- [`SECURITY-P0-ROTATION.md`](SECURITY-P0-ROTATION.md): runbook de rotación de secretos.
