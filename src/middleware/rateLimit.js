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
import { clientIpKey } from '../lib/clientIp.js';

/**
 * @param {object} opts
 * @param {number} opts.windowMs Tamaño de la ventana en ms.
 * @param {number} opts.max Máximo de peticiones por IP en la ventana.
 * @param {string} [opts.message] Mensaje de error 429.
 */
export function createRateLimiter({ windowMs = 60_000, max = 120, message = 'Demasiadas peticiones. Intenta de nuevo en un momento.' } = {}) {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    // Headers estándar RateLimit-* + legacy X-RateLimit-*.
    standardHeaders: true,
    legacyHeaders: true,
    // Clave por IP real del cliente (ver src/lib/clientIp.js) para no mezclar
    // usuarios detrás del túnel de Cloudflare, sin fiarse de cabeceras que el
    // cliente puede falsificar.
    keyGenerator: clientIpKey,
    // Desactiva los avisos de express-rate-limit sobre `trust proxy` y el
    // fallback a req.ip: apuntan a su keyGenerator por defecto, y aquí la
    // confianza en las cabeceras la decide clientIpKey a partir del socket.
    validate: { keyGeneratorIpFallback: false, trustProxy: false },
    // No fallar si no hay socket ni req.ip (p.ej. requests sintéticos de test).
    skip: (req) => !req.ip && !req.socket,
  });
}
