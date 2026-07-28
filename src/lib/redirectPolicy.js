// ═══════════════════════════════════════════════════════════════
// Política de saltos de redirect del Stream_Proxy.
//
// `streamUrlPolicy.js` valida el destino INICIAL cuando lo elige el cliente
// (allowlist de SoundCloud). Este módulo cubre lo otro: los saltos que elige el
// servidor de destino. Son controles distintos y no se pueden intercambiar:
//
//   destino inicial → lo elige el cliente        → allowlist (hosts conocidos)
//   saltos 3xx      → los elige un CDN legítimo  → denylist (redes internas)
//
// Una allowlist sobre los saltos rompería la reproducción: googlevideo y sndcdn
// redirigen de forma rutinaria a hosts que cambian. Una denylist no, porque esos
// saltos siempre apuntan a direcciones públicas.
//
// Importa porque la allowlist inicial incluye `soundcloud.com`, una plataforma de
// contenido de terceros: un open-redirect allí bastaría para que el servidor
// hiciera la petición a una dirección interna en nombre del cliente.
//
// LÍMITE CONOCIDO (no se vende como cierre total): esto valida el HOSTNAME del
// salto. Un hostname público que resuelva por DNS a una dirección interna
// (DNS rebinding) no se detecta aquí, porque la resolución la hace `fetch`
// después de esta comprobación (TOCTOU). Cerrarlo requiere fijar la IP resuelta
// con un `lookup`/`connect` propio de undici, o controles de egress en la red.
// ═══════════════════════════════════════════════════════════════

import { BlockList, isIPv4, isIPv6 } from 'node:net';

/** Número máximo de saltos que se siguen antes de abandonar. */
export const MAX_REDIRECTS = 5;

// Rangos que nunca son un CDN de audio y sí son objetivos típicos de SSRF.
const internalRanges = new BlockList();
internalRanges.addSubnet('0.0.0.0', 8, 'ipv4');       // "este host"
internalRanges.addSubnet('127.0.0.0', 8, 'ipv4');     // loopback
internalRanges.addSubnet('10.0.0.0', 8, 'ipv4');      // RFC1918
internalRanges.addSubnet('172.16.0.0', 12, 'ipv4');   // RFC1918
internalRanges.addSubnet('192.168.0.0', 16, 'ipv4');  // RFC1918
internalRanges.addSubnet('169.254.0.0', 16, 'ipv4');  // link-local (metadata cloud)
internalRanges.addSubnet('100.64.0.0', 10, 'ipv4');   // CGNAT
internalRanges.addAddress('::1', 'ipv6');             // loopback
internalRanges.addSubnet('fc00::', 7, 'ipv6');        // unique local
internalRanges.addSubnet('fe80::', 10, 'ipv6');       // link-local

/** Quita corchetes de IPv6 (`[::1]`) y desenvuelve IPv4 mapeada en IPv6. */
function normalizeHost(hostname) {
  const host = String(hostname ?? '').trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  return mapped ? mapped[1] : host;
}

/**
 * ¿El host es una IP literal de una red interna?
 *
 * Solo decide sobre IPs literales: un nombre de dominio devuelve `false` porque
 * su resolución no se conoce aquí (ver LÍMITE CONOCIDO arriba).
 *
 * @param {unknown} hostname
 * @returns {boolean}
 */
export function isInternalAddress(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (isIPv4(host)) return internalRanges.check(host, 'ipv4');
  if (isIPv6(host)) return internalRanges.check(host, 'ipv6');
  return false;
}

/**
 * ¿Se puede seguir este salto de redirect?
 *
 * Exige http(s) — descarta `file:`, `gopher:`, `data:` — y que el host no sea
 * una IP interna literal.
 *
 * @param {unknown} value URL absoluta del salto.
 * @returns {boolean}
 */
export function isSafeRedirectTarget(value) {
  if (!value || typeof value !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return !isInternalAddress(parsed.hostname);
}

/** ¿El estado HTTP es un redirect con `Location`? */
export function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Resuelve el `Location` de un salto contra la URL actual y decide si seguirlo.
 * `Location` puede ser relativo (RFC 7231), así que se resuelve antes de validar.
 *
 * @param {string} currentUrl
 * @param {string|null|undefined} location
 * @returns {{ ok: true, url: string } | { ok: false, reason: 'no_location'|'invalid'|'blocked' }}
 */
export function resolveRedirect(currentUrl, location) {
  if (!location) return { ok: false, reason: 'no_location' };
  let next;
  try {
    next = new URL(location, currentUrl).toString();
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!isSafeRedirectTarget(next)) return { ok: false, reason: 'blocked' };
  return { ok: true, url: next };
}
