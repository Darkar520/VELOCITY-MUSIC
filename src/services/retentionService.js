/**
 * retentionService.js — Job periódico de retención e integridad de datos.
 *
 * Ejecuta una vez al arrancar y cada 24 horas:
 *  1. Elimina registros con más de 365 días en 4 tablas.
 *  2. Limita listening_history a 10 000 entradas por usuario.
 *  3. Marca sesiones expiradas (abiertas hace más de 12 h).
 *  4. Verifica huérfanos (user_id sin usuario en users) y los loguea.
 *
 * Solo debe llamarse desde el worker con WORKER_ID=0 para evitar
 * ejecuciones duplicadas en modo cluster.
 */

const INTERVAL_MS    = 24 * 60 * 60 * 1000; // 24 horas
const RETENTION_DAYS = 365;
const MAX_HISTORY    = 10_000;

/**
 * Inicia el job. Se ejecuta una vez de inmediato y luego cada 24 h.
 * @param {Function} query — función query del pool de PG
 */
export function start(query) {
  // Primer ciclo con un pequeño delay para no bloquear el arranque.
  setTimeout(() => run(query), 60_000);
  setInterval(() => run(query), INTERVAL_MS);
}

/**
 * Ejecuta todas las operaciones de retención.
 * Cada operación captura su propio error para no detener las demás.
 */
export async function run(query) {
  console.log('[retention] Iniciando ciclo de retención…');

  // ── 1. Eliminar datos de más de 365 días ────────────────────────
  await safeRun('listening_history (>365d)', () => query(
    `DELETE FROM listening_history WHERE played_at < now() - INTERVAL '${RETENTION_DAYS} days'`,
  ));

  await safeRun('search_log (>365d)', () => query(
    `DELETE FROM search_log WHERE created_at < now() - INTERVAL '${RETENTION_DAYS} days'`,
  ));

  await safeRun('playback_errors (>365d)', () => query(
    `DELETE FROM playback_errors WHERE occurred_at < now() - INTERVAL '${RETENTION_DAYS} days'`,
  ));

  await safeRun('session_events (>365d)', () => query(
    `DELETE FROM session_events WHERE started_at < now() - INTERVAL '${RETENTION_DAYS} days'`,
  ));

  // ── 2. Limitar historial a MAX_HISTORY entradas por usuario ────
  await safeRun(`listening_history (límite ${MAX_HISTORY}/usuario)`, async () => {
    // Identificar usuarios que superan el límite.
    const { rows: overLimit } = await query(
      `SELECT user_id, COUNT(*)::int AS total
       FROM listening_history
       GROUP BY user_id
       HAVING COUNT(*) > $1`,
      [MAX_HISTORY],
    );

    for (const { user_id, total } of overLimit) {
      const excess = total - MAX_HISTORY;
      const { rowCount } = await query(
        `DELETE FROM listening_history
         WHERE id IN (
           SELECT id FROM listening_history
           WHERE user_id = $1
           ORDER BY played_at ASC
           LIMIT $2
         )`,
        [user_id, excess],
      );
      console.log(`[retention] Usuario ${user_id}: eliminados ${rowCount} registros de historial (excedente).`);
    }
  });

  // ── 3. Marcar sesiones expiradas (abiertas hace más de 12 h) ───
  await safeRun('session_events (expiradas)', () => query(
    `UPDATE session_events
     SET
       status           = 'expired',
       ended_at         = started_at + INTERVAL '12 hours',
       duration_seconds = 43200
     WHERE ended_at IS NULL
       AND started_at < now() - INTERVAL '12 hours'`,
  ));

  // ── 4. Verificar huérfanos (user_id sin match en users) ────────
  await safeRun('integridad referencial (huérfanos)', async () => {
    const tables = [
      { table: 'listening_history', col: 'user_id' },
      { table: 'search_log',        col: 'user_id' },
      { table: 'playback_errors',   col: 'user_id' },
      { table: 'session_events',    col: 'user_id' },
    ];
    for (const { table, col } of tables) {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS orphans
         FROM ${table} t
         WHERE t.${col} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.${col})`,
      );
      const orphans = rows[0]?.orphans ?? 0;
      if (orphans > 0) {
        console.warn(`[retention] ⚠ Huérfanos en ${table}: ${orphans} registros con user_id inexistente.`);
      }
    }
  });

  console.log('[retention] Ciclo completado.');
}

/** Envuelve una operación de BD; loguea el error y continúa si falla. */
async function safeRun(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[retention] ERROR en "${label}": ${err.message}`);
  }
}
