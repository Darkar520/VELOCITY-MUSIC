# Runtime de reproducción en Windows

El backend conserva un único deadline de 18 s para resolver audio, incluida
la cola, la búsqueda alternativa y la extracción. El proxy mantiene su límite
de inactividad y su tratamiento de Range. No reducir los plazos para mejorar
una medición de velocidad: primero medir el trabajo que consume el plazo.

## Instalación rápida, Windows x64

```powershell
npm run setup:extractor:fast
```

Instala `yt-dlp_win.zip` desde la release oficial de
[yt-dlp](https://github.com/yt-dlp/yt-dlp#release-files). Es la distribución
descomprimida, con Python y dependencias incluidas; evita descomprimir el
ejecutable en TEMP en cada resolución. No requiere instalar Python aparte.

El instalador comprueba el SHA-256 publicado por la misma release y ejecuta
`--version` antes de activar una generación. `bin/yt-dlp-win/active.json`
selecciona el runtime; el directorio completo permanece excluido de Git.
Se conserva la generación anterior y se limpian las anteriores a ella, solo
dentro del directorio administrado. Una descarga o sonda fallida conserva la
generación activa.
La limpieza de generaciones se omite si hay otra instalación en curso; nunca
se elimina la generación seleccionada por el manifiesto activo.

`YT_DLP_BIN` conserva prioridad como override explícito. Sin runtime administrado,
se sigue usando `bin/yt-dlp.exe` o el ejecutable del PATH. Otros sistemas
operativos conservan su instalación actual.

Después de actualizar el código del backend, reiniciarlo con el procedimiento
habitual del proyecto. La selección de la generación se evalúa en cada spawn.
El actualizador periódico reconoce el runtime administrado y actualiza el
paquete completo con checksum y sonda; no usa `-U`, que esa distribución no
soporta. El binario standalone conserva su ruta histórica de actualización.

## Comprobación reproducible

Arrancar staging con un directorio de datos nuevo permite probar sin URLs de
audio persistidas de una ejecución anterior:

```powershell
$env:VELOCITY_DATA_DIR = 'data-staging/cold-playback-check'
npm run start:staging
```

En otra terminal:

```powershell
node scripts/probe-playback.js --guest --refresh --artist 'Adele' --title 'Rolling in the Deep' --id x9Qv47HpEqw
```

La sonda verifica preparación, cuerpo completo, reconstrucción por rangos,
seek y rechazo de firmas inválidas/caducadas. El avance temporal y el paso a la
siguiente pista se verifican además en el reproductor: no sustituir esa prueba
por un estado `operational` o un HTTP 206.

Resultados y límites de la intervención:
[auditoría inicial](audits/2026-10-17-playback.md) y
[pruebas de canciones nuevas](audits/2026-10-17-cold-playback.md).
