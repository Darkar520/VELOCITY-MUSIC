/**
 * sessionRepo.js — Repositorio PostgreSQL para sesiones activas de usuario.
 *
 * Funciones exportadas:
 *   startSession  — registra el inicio de una sesión
 *   endSession    — cierra la sesión activa más reciente y calcula duración
 *   listActive    — lista usuarios con sesión abierta en los últimos 15 minutos
 */

/** Registra el inicio de una sesión. Retorna el id del registro insertado. */
export async function startSession(query, { userId, userAgent }) {
  const { rows } = await query(
    `INSERT INTO session_events (user_id, user_agent)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, String(userAgent || '').slice(0, 300)],
  );
  return rows[0]?.id ?? null;
}

/**
 * Cierra la sesión activa más reciente del usuario.
 * Calcula duration_seconds como diferencia con started_at.
 * Retorna el registro actualizado, o null si no había sesión abierta (→ 409).
 */
export async function endSession(query, userId) {
  const { rows } = await query(
    `UPDATE session_events
     SET
       ended_at         = now(),
       status           = 'closed',
       duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
     WHERE id = (
       SELECT id FROM session_events
       WHERE user_id = $1
         AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1
     )
     RETURNING id, duration_seconds`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Lista usuarios con sesión abierta en los últimos 15 minutos.
 * Usada para la sección "Conectados ahora" del panel de administración.
 * Máximo `limit` resultados, ordenados por la sesión más reciente.
 */
export async function listActive(query, limit = 500) {
  const { rows } = await query(
    `SELECT
       s.id             AS session_id,
       s.user_id,
       u.email,
       u.display_name,
       s.started_at     AS session_started_at,
       s.user_agent
     FROM session_events s
     JOIN users u ON u.id = s.user_id
     WHERE s.ended_at IS NULL
       AND s.started_at >= now() - INTERVAL '15 minutes'
     ORDER BY s.started_at DESC
     LIMIT $1`,
    [Math.min(limit, 500)],
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name || '',
    sessionStartedAt: r.session_started_at,
    userAgent: r.user_agent || '',
  }));
}
