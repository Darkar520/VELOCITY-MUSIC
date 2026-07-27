// ═══════════════════════════════════════════════════════════════
// Identificación de la IP real del cliente.
//
// Lógica pura (sin Express ni express-rate-limit) para poder probarla aislada,
// igual que se hace en streamProxy.js con la validación y las cabeceras.
//
// `CF-Connecting-IP` y `X-Forwarded-For` son cabeceras: CUALQUIER cliente puede
// enviarlas. Solo son creíbles si quien abrió la conexión TCP es un proxy
// nuestro, y eso lo dice únicamente `req.socket.remoteAddress`, que no se puede
// falsificar. Leerlas sin comprobar el socket permitía anular todos los
// limitadores rotando su valor en cada petición — incluido el de `/api/auth`,
// que dejaba el login sin protección contra fuerza bruta.
// ═══════════════════════════════════════════════════════════════

import { BlockList, isIPv4, isIPv6 } from 'node:net';

// Se confía en loopback y en rangos privados porque ahí es donde vive un
// reverse proxy respecto a la app: `cloudflared` (el modo de despliegue de este
// proyecto) escucha en 127.0.0.1, y nginx/Docker en una red privada.
//
// Si algún día el origen se expone DIRECTAMENTE a los edges de Cloudflare (DNS
// proxied sin túnel), el socket será una IP pública de Cloudflare y habrá que
// añadir aquí sus rangos publicados en https://www.cloudflare.com/ips/.
const trustedProxies = new BlockList();
trustedProxies.addSubnet('127.0.0.0', 8, 'ipv4');    // loopback
trustedProxies.addSubnet('10.0.0.0', 8, 'ipv4');     // RFC1918
trustedProxies.addSubnet('172.16.0.0', 12, 'ipv4');  // RFC1918
trustedProxies.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918
trustedProxies.addAddress('::1', 'ipv6');            // loopback
trustedProxies.addSubnet('fc00::', 7, 'ipv6');       // unique local

/**
 * Normaliza una IP a su forma comparable: recorta y convierte las IPv4
 * mapeadas en IPv6 (`::ffff:127.0.0.1`, que es lo que devuelve Node en un
 * socket dual-stack) a su forma IPv4.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeIp(value) {
  const ip = String(value ?? '').trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

/**
 * ¿La conexión viene de un proxy nuestro y por tanto sus cabeceras son creíbles?
 *
 * @param {unknown} value Dirección del socket, no de una cabecera.
 * @returns {boolean}
 */
export function isTrustedProxy(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (isIPv4(ip)) return trustedProxies.check(ip, 'ipv4');
  if (isIPv6(ip)) return trustedProxies.check(ip, 'ipv6');
  return false;
}

/**
 * Clave de rate-limit = IP REAL del cliente.
 *
 * Detrás de Cloudflare, `req.ip` (con trust proxy=1) puede resolver a la IP del
 * túnel/edge y NO a la del usuario final, lo que haría que TODOS los usuarios
 * compartieran el mismo bucket y se bloquearan entre sí con 429 intermitentes.
 * Cloudflare envía la IP real en `CF-Connecting-IP`, que se lee SOLO si el
 * socket es un proxy de confianza.
 *
 * No se lee `X-Forwarded-For` en crudo: con un proxy de confianza, Express ya
 * calcula `req.ip` a partir de esa cabecera respetando `trust proxy`, lo que
 * evita quedarse con el primer valor de la lista (que sí es del cliente).
 *
 * @param {{ socket?: { remoteAddress?: string }, headers?: object, ip?: string }} req
 * @returns {string} Clave estable; `'unknown'` si no hay ninguna IP utilizable.
 */
export function clientIpKey(req) {
  const socketIp = normalizeIp(req.socket?.remoteAddress);
  if (!isTrustedProxy(socketIp)) {
    // Conexión directa (o proxy desconocido): la única IP creíble es la del socket.
    return socketIp || 'unknown';
  }
  const cf = normalizeIp(req.headers?.['cf-connecting-ip']);
  if (cf) return cf;
  return normalizeIp(req.ip) || socketIp || 'unknown';
}
