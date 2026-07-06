/**
 * healthService.js — Verificación de salud de la conexión a PostgreSQL.
 *
 * check(pool, startTime) ejecuta SELECT 1 con timeout de 3 segundos y
 * retorna un objeto estructurado { status, db, latencyMs, uptime }.
 * La ruta GET /api/health lo consume y responde 200 (verde) o 503 (rojo).
 */

const DB_TIMEOUT_MS = 3000;

/**
 * @param {import('pg').Pool} pool  — pool de conexiones PG (o null en modo JSON)
 * @param {number} startTime        — Date.now() del arranque del proceso
 * @returns {Promise<{status: string, db: string, latencyMs: number|null, uptime: number, error?: string}>}
 */
export async function check(pool, startTime) {
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  if (!pool) {
    // Modo JSON: la BD no aplica.
    return { status: 'ok', db: 'n/a', latencyMs: null, uptime };
  }

  const t0 = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout después de ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS),
      ),
    ]);
    return { status: 'ok', db: 'green', latencyMs: Date.now() - t0, uptime };
  } catch (err) {
    return {
      status: 'error',
      db: 'red',
      latencyMs: Date.now() - t0,
      uptime,
      error: err.message || 'Error desconocido',
    };
  }
}
