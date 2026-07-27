// ═══════════════════════════════════════════════════════════════
// Política de destinos permitidos para el parámetro `stream`.
//
// `stream` es el ÚNICO parámetro de audio cuyo valor lo elige el cliente:
// el resto (artist/title/id) se resuelve server-side con los extractores.
// El Audio_Resolver lo devolvía como URL final con la sola validación de que
// fuera http(s) (`isUsableUrl`), y el Stream_Proxy hace `fetch` sobre esa URL
// desde el propio servidor. Eso convertía tres endpoints en un SSRF:
//
//   GET /api/stream-proxy?...&stream=http://169.254.169.254/latest/meta-data/
//   GET /api/resolve?...&stream=http://127.0.0.1:5432/      → 302 (open redirect)
//   GET /api/stream-sign?...&stream=<cualquiera>             → firma el destino
//
// Y además envenenaba el Stream_Cache: el resolver hace `cache.set(key, stream)`
// con clave `artist:title`, así que una URL arbitraria quedaba servida al RESTO
// de los usuarios que pidieran la misma canción.
//
// Único uso legítimo de `stream` en la app: pistas de SoundCloud. El catálogo
// (`createSoundCloudCatalog`) emite `streamUrl = j.url ?? j.webpage_url`, y el
// frontend solo lo reenvía cuando `source === 'soundcloud'`
// (frontend/src/catalog.js). Por eso la allowlist es exactamente SoundCloud.
//
// Al añadir un proveedor nuevo que entregue URLs directas al cliente, hay que
// añadir su host aquí; si no, el resolver lo ignorará y caerá a los extractores.
// ═══════════════════════════════════════════════════════════════

/**
 * Hosts permitidos como destino de `stream`. Ancla ambos extremos y exige que
 * el sufijo vaya precedido de un punto, para que `soundcloud.com.evil.tld` o
 * `notsoundcloud.com` no pasen.
 */
const ALLOWED_STREAM_HOSTS = /^(?:[a-z0-9-]+\.)*(?:soundcloud\.com|sndcdn\.com)$/i;

/**
 * ¿Es `value` una URL que el servidor puede buscar por cuenta del cliente?
 *
 * Exige https (los CDNs permitidos lo soportan; http permitiría además
 * alcanzar servicios internos en claro) y un host de la allowlist.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAllowedStreamUrl(value) {
  if (!value || typeof value !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_STREAM_HOSTS.test(parsed.hostname);
}
