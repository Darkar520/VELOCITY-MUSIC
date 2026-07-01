/**
 * Normalización de texto compartida.
 *
 * Se usa tanto para construir claves del Stream_Cache como para emparejar
 * candidatos del catálogo de YouTube Music, garantizando consistencia.
 *
 * Reglas (Requisitos 2.10, 3.5):
 *  - recorta espacios iniciales/finales
 *  - pasa a minúsculas
 *  - elimina diacríticos (acentos)
 *  - colapsa secuencias internas de espacios a un único espacio
 */
export function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Valida que un valor sea una URL http(s) sintácticamente válida.
 */
export function isUsableUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
