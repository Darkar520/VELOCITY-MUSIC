# Traducción local de letras

El backend usa los paquetes Argos EN→ES 1.0 y ES→EN 1.9. Es traducción
automática, no una traducción editorial oficial. Cada línea se traduce por
separado para conservar sincronización, repeticiones y separadores; esto limita
la interpretación del contexto poético y las frases que continúan en otra línea.

## Instalación Windows

Desde la raíz del proyecto con Python 3.12 y Node en PATH:

```powershell
python -m venv tools/lyrics-translation
& tools/lyrics-translation/Scripts/python.exe -m pip install -r scripts/lyrics-translation-requirements.txt
& tools/lyrics-translation/Scripts/python.exe scripts/setup-lyrics-translation.py
```

En otros sistemas crear el mismo entorno y usar `bin/python`. Puede configurarse
`LYRICS_TRANSLATION_PYTHON` con la ruta de otro intérprete equipado con estas
dependencias. Modelos y dependencias están excluidos de Git. Los modelos requieren
aproximadamente 373 MB de descarga y espacio adicional al extraerlos. Conservar
los README y licencias incluidos: ES→EN deriva de OPUS-MT, CC-BY 4.0.

El instalador valida SHA-256 antes de extraer y registra un manifiesto local.
La conversión ES→EN usa float32: la cuantización dinámica int8 produjo salida
degenerada en la máquina de validación. Se corrige el token de inicio del
decodificador Marian al token existente `</s>`.

## Contrato y límites

`POST /api/lyrics/translate` requiere JWT; acepta `{lines: string[]}`. Máximos:
300 líneas, 1.000 caracteres por línea y 24.000 caracteres en total. Dos procesos
simultáneos, plazo de 45 segundos y caché en memoria de 100 resultados. No se
envían las letras a terceros ni se registran en logs. Una detección de idioma
fuera de inglés/español o con confianza inferior a 0,8 devuelve `unsupported`.
Esa confianza del detector no es una medida de calidad de traducción.

La PWA conserva traducción, idioma, modelo y texto fuente alineado en IndexedDB.
Si cambia el texto, la traducción anterior no se muestra. El backfill v3 intenta
completar letras y traducciones de la biblioteca existente sin descargar audio.
Errores de red/modelo o almacenamiento quedan pendientes para un intento
posterior. La generación inicial necesita conexión con el servidor; la lectura
de una traducción ya guardada funciona sin conexión.

## Verificación

Las pruebas Node validan límites y correspondencia de filas; las pruebas React
validan el interruptor, la colocación bajo el original y la lectura de una
traducción guardada sin solicitarla a la red. Verificar además ambos modelos
con frases originales antes de desplegar un runtime nuevo. No hay una evaluación
humana de calidad sobre un corpus de letras: no se afirma equivalencia con Spotify.
