// ═══════════════════════════════════════════════════════════════
// Registro de errores del servidor.
//
// `wrap()` mapeaba toda excepción no tipada a `{ error: 'Error interno.' }` y
// descartaba el objeto de error: en producción un 500 no dejaba NINGÚN rastro,
// así que depurar consistía en adivinar. Esto añade la traza sin cambiar la
// respuesta al cliente (que sigue sin filtrar detalles internos).
//
// El formateo se separa del efecto (escribir en consola) para poder probarlo,
// igual que en streamProxy.js / clientIp.js.
// ═══════════════════════════════════════════════════════════════

/**
 * Rutas cuyo query string NUNCA debe registrarse: llevan material sensible
 * (firma HMAC del stream, clave de admin). Se registra solo el path.
 */
const SENSITIVE_QUERY_PATHS = /^\/api\/(stream-proxy|stream-sign|admin|setup)/;

/**
 * Construye la línea de log de un error inesperado.
 *
 * No incluye el query string en rutas sensibles (exp/sig, ADMIN_KEY) para no
 * dejar credenciales en los logs — el mismo motivo por el que `checkAdminKey`
 * avisa cuando la clave llega por query param.
 *
 * @param {object} ctx
 * @param {string} [ctx.method]
 * @param {string} [ctx.path]
 * @param {number} [ctx.status]
 * @param {unknown} [ctx.err]
 * @param {Date}   [ctx.now]
 * @returns {string}
 */
export function formatErrorLog({ method, path, status = 500, err, now = new Date() } = {}) {
  const when = now.toISOString();
  const verb = String(method || '-').toUpperCase();
  const route = String(path || '-');
  const safeRoute = SENSITIVE_QUERY_PATHS.test(route) ? route.split('?')[0] : route;
  const message = err instanceof Error
    ? err.message
    : (err === undefined ? 'error desconocido' : String(err));
  return `[error] ${when} ${verb} ${safeRoute} → ${status}: ${message}`;
}

/**
 * Registra un error inesperado: una línea con el contexto y, si existe, el stack.
 *
 * @param {object} ctx Igual que formatErrorLog, más `logger` inyectable.
 * @param {{ error: Function }} [ctx.logger=console]
 */
export function logServerError({ logger = console, ...ctx } = {}) {
  const line = formatErrorLog(ctx);
  logger.error(line);
  if (ctx.err instanceof Error && ctx.err.stack) logger.error(ctx.err.stack);
}
