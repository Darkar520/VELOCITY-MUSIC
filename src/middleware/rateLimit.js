// ═══════════════════════════════════════════════════════════════
// Rate limiting por IP — wrapper sobre express-rate-limit.
//
// Diseñado para proteger endpoints costosos o sensibles (auth, búsqueda,
// resolución) frente a abuso, SIN limitar el streaming de audio (que hace
// muchísimas peticiones Range legítimas por canción).
//
// Usamos express-rate-limit (en vez de una implementación custom) porque:
//   1. Es la librería estándar de facto (20M+ descargas/semana en npm).
//   2. CodeQL la reconoce nativamente como rate limiter — una implementación
//      custom no la detecta y marca los handlers como "missing rate limiting".
//   3. Maneja correctamente req.ip con trust proxy, headers estándar
//      (X-RateLimit-*), y tiene opciones de saltar IPs/whitelist.
//
// Nota: en modo cluster el conteo es por proceso; sirve igual como válvula
// de seguridad. Para límites estrictos compartidos se usaría Redis
// (rate-limit-redis).
// ═══════════════════════════════════════════════════════════════

import rateLimit from 'express-rate-limit';

/**
 * @param {object} opts
 * @param {number} opts.windowMs Tamaño de la ventana en ms.
 * @param {number} opts.max Máximo de peticiones por IP en la ventana.
 * @param {string} [opts.message] Mensaje de error 429.
 */
/**
 * Clave de rate-limit = IP REAL del cliente.
 *
 * Detrás de Cloudflare, `req.ip` (con trust proxy=1) puede resolver a la IP del
 * túnel/edge y NO a la del usuario final, lo que haría que TODOS los usuarios
 * compartieran el mismo bucket y se bloquearan entre sí con 429 intermitentes.
 * Cloudflare envía la IP real en `CF-Connecting-IP`; si no está, caemos al
 * primer valor de `X-Forwarded-For` y por último a `req.ip`.
 */
export function clientIpKey(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || 'unknown';
}

export function createRateLimiter({ windowMs = 60_000, max = 120, message = 'Demasiadas peticiones. Intenta de nuevo en un momento.' } = {}) {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    // Headers estándar RateLimit-* + legacy X-RateLimit-*.
    standardHeaders: true,
    legacyHeaders: true,
    // Clave por IP real del cliente (ver clientIpKey) para no mezclar usuarios
    // detrás del túnel de Cloudflare.
    keyGenerator: clientIpKey,
    // Evita el warning de express-rate-limit por keyGenerator custom.
    validate: { keyGeneratorIpFallback: false, trustProxy: false },
    // No fallar si req.ip no se puede determinar (p.ej. sockets de test).
    skip: (req) => !req.ip && !req.socket && !req.headers['cf-connecting-ip'],
  });
}
