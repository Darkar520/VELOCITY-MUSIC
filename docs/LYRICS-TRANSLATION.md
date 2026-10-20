# Traducción local de letras

El backend conserva los paquetes locales Argos EN→ES 1.0 y ES→EN 1.9. No envía
letras a un servicio de traducción externo. Es traducción automática, no una
traducción editorial oficial.

Antes de inferir, agrupa hasta tres líneas contiguas (máximo 96 tokens) y no cruza
estrofas vacías ni finales de oración. Una lista explícita de equivalencias
reformula algunos modismos frecuentes en inglés y español; después el modelo
traduce el grupo con contexto. La atención del decodificador distribuye la
salida entre las líneas originales, respetando límites de palabra y evitando
cortar ciertas expresiones adverbiales o conectivas registradas. El decodificador
usa parámetros distintos por dirección. Esta adaptación es una lista acotada,
no una comprensión general de metáforas o contexto poético.

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
traducción guardada sin solicitarla a la red. `scripts/evaluate-argos-context.py`
compara ambos sentidos con `test/fixtures/translation-naturalness.json`, incluidos
modismos, continuaciones y controles negativos. El conjunto es pequeño y
determinista; cero fallos de alineación solo confirma que no se perdió ni
reordenó ninguna fila, no que la traducción sea natural.

En la revisión 2026-10-19 se ejecutaron 17 ejemplos sintéticos en las dos
direcciones: Argos tuvo cero fallos de alineación. Se comprobó que normalizar
«Give it a shot», «Estoy hasta las narices de tus mentiras» y «Me quedé de piedra
cuando lo vi» produce respectivamente «Pruébalo», «I can't stand your lies» e
«I was very surprised when I saw him». Estos son casos medidos, no una garantía
para expresiones no incluidas.

También se probó localmente un candidato OPUS-MT big fijado a revisiones
concretas. En este fixture tradujo literalmente varios de esos modismos (por
ejemplo, “I'm up to the noses of your lies” y “I was stoned when I saw him”), por
lo que no reemplaza al Argos actualmente instalado. No hay todavía una evaluación
ciega realizada por hablantes nativos ni un corpus amplio de letras; no se afirma
calidad equivalente a una traducción editorial o a Spotify. Una evaluación de
calidad más amplia requiere ejemplos con permiso de uso y revisión humana por
dirección e idioma.
