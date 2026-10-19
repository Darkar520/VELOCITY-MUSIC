# Validación 3.35

## Cambios y evidencia

- Letras: modo de traducción EN↔ES por línea con alineación guardada en IndexedDB.
  En staging, Azul de Zoé produjo 32 filas de traducción (27 no vacías), que
  siguieron visibles tras cortar la red y recargar la PWA.
- Portadas: caché v2 distingue resoluciones. No guarda una miniatura offline
  bajo el URL de una imagen grande. Azul cargó 900×900 para una vista de 340 px;
  Another Brick in the Wall, Pt. 2 cargó 900×900 para una vista de 312 px.
  La portada 900×900 de Azul también sobrevivió al recargar sin red. Las nuevas
  copias offline solicitan al menos 900 px en los CDN compatibles y conservan
  los bytes originales; la resolución nativa del proveedor sigue siendo un límite.
- Brillo ambiental: CSS ya no sobrescribe el deslizador. En viewport móvil,
  la opacidad calculada pasó de 0 a >0,7 en pausa; el valor 100 quedó persistido.
- Reproducción automática: se revisó el flujo existente de fin de pista. El
  interruptor desactivado detiene la continuación y el activo consume una cola
  ya preparada. No se modificó la máquina de audio. Audio real de Azul avanzó
  en staging hasta más de 45 segundos.
- Búsqueda: Graduation devolvió Good Morning, Champion, Stronger e I Wonder
  con el mismo albumId solicitado. Flashing Lights devolvió su canción, el
  álbum Graduation y Kanye West, con artistas/álbumes relacionados por IDs del
  catálogo. El extractor confundía playlists VLR con artistas similares: ahora
  recupera tarjetas UC reales. No se fijaron artistas manualmente por consulta.
- DJ: ranking explícito por recencia, favoritos, afinidad de artista y gustos
  elegidos, con penalización de la estación anterior y de repeticiones contiguas.
  La selección sigue limitada al conjunto relacionado construido por la radio.
  El historial local es deduplicado: no permite inferir frecuencia, skips o
  porcentajes de escucha. No se afirma aprendizaje automático ni mejora causal
  de satisfacción sin un experimento con usuarios.

## Límites

Las traducciones son automáticas y se generan inicialmente con conexión. No
hay una evaluación humana de calidad sobre letras, y las líneas aisladas pueden
perder contexto. Los modelos locales y su protocolo de verificación se describen
en LYRICS-TRANSLATION.md. Una portada antigua ya reducida a data URL no permite
recuperar sus píxeles perdidos sin obtener una fuente original de nuevo.

Los resultados de catálogo y artistas relacionados cambian entre consultas.
El enriquecimiento tiene un plazo de cinco segundos y conserva la búsqueda
directa cuando falla. La verificación con navegador es de staging en esta
máquina; no constituye una medición en el teléfono físico del usuario.
