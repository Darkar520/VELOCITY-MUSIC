// ═══════════════════════════════════════════════════════════════
// Rate limiting por IP — ventana fija en memoria, sin dependencias.
//
// Diseñado para proteger endpoints costosos o sensibles (auth, búsqueda,
// resolución) frente a abuso, SIN limitar el streaming de audio (que hace
// muchísimas peticiones Range legítimas por canción).
//
// Nota: en modo cluster el conteo es por proceso; sirve igual como válvula
// de seguridad. Para límites estrictos compartidos se usaría Redis.
// ═══════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {number} opts.windowMs Tamaño de la ventana en ms.
 * @param {number} opts.max Máximo de peticiones por IP en la ventana.
 * @param {string} [opts.message] Mensaje de error 429.
 */
export function createRateLimiter({ windowMs = 60_000, max = 120, message = 'Demasiadas peticiones. Intenta de nuevo en un momento.' } = {}) {
  /** @type {Map<string, { count: number, reset: number }>} */
  const hits = new Map();

  // Limpieza periódica de entradas vencidas (evita fuga de memoria).
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  if (cleanup.unref) cleanup.unref();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let e = hits.get(ip);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(ip, e); }
    e.count++;
    const remaining = Math.max(0, max - e.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (e.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
