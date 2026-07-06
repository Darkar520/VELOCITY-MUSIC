/**
 * errorRepo.js — Repositorio PostgreSQL para errores de reproducción y alertas.
 *
 * Funciones exportadas:
 *   recordError      — inserta un error en playback_errors
 *   checkAndFlagUser — evalúa umbral de alerta (5 errores / 60 min)
 *   listActiveAlerts — lista alertas sin resolver para el panel admin
 *   resolveAlert     — marca una alerta como resuelta
 */

/** Inserta un error de reproducción. userId es opcional (invitados sin JWT). */
export async function recordError(query, { userId, trackId, errorCode, errorMessage, userAgent }) {
  await query(
    `INSERT INTO playback_errors (user_id, track_id, error_code, error_message, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId || null,
      String(trackId || '').slice(0, 200),
      String(errorCode || '').slice(0, 100),
      String(errorMessage || '').slice(0, 500),
      String(userAgent || '').slice(0, 300),
    ],
  );
}

/**
 * Cuenta los errores del usuario en los últimos 60 minutos.
 * Si llega a 5 o más, inserta una alerta en user_alert_flags.
 * Usa ON CONFLICT DO NOTHING para no duplicar alertas activas del mismo tipo.
 */
export async function checkAndFlagUser(query, userId) {
  if (!userId) return; // invitados anónimos no generan alertas nominales

  const { rows } = await query(
    `SELECT
       COUNT(*)::int                                    AS total,
       MAX(track_id)                                    AS sample_track,
       MODE() WITHIN GROUP (ORDER BY track_id)          AS top_track,
       MIN(occurred_at)                                 AS first_at
     FROM playback_errors
     WHERE user_id = $1
       AND occurred_at >= now() - INTERVAL '60 minutes'`,
    [userId],
  );

  const { total, top_track, first_at } = rows[0] || {};
  if (!total || total < 5) return;

  const detail = JSON.stringify({
    errorsInLastHour: total,
    topTrackId: top_track || null,
    firstErrorAt: first_at || null,
  });

  // Insertar solo si no existe ya una alerta activa (sin resolver) del mismo tipo.
  await query(
    `INSERT INTO user_alert_flags (user_id, type, detail)
     SELECT $1, 'repeated_playback_errors', $2::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM user_alert_flags
       WHERE user_id = $1
         AND type = 'repeated_playback_errors'
         AND resolved_at IS NULL
     )`,
    [userId, detail],
  );
}

/**
 * Lista todas las alertas activas (sin resolver) con datos del usuario.
 * Usada por el panel de administración.
 */
export async function listActiveAlerts(query) {
  const { rows } = await query(
    `SELECT
       f.id,
       f.user_id,
       u.email,
       u.display_name,
       f.type,
       f.detail,
       f.created_at
     FROM user_alert_flags f
     JOIN users u ON u.id = f.user_id
     WHERE f.resolved_at IS NULL
     ORDER BY f.created_at DESC
     LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name || '',
    type: r.type,
    detail: r.detail || {},
    createdAt: r.created_at,
  }));
}

/** Marca una alerta como resuelta. */
export async function resolveAlert(query, alertId) {
  const { rowCount } = await query(
    `UPDATE user_alert_flags SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL`,
    [Number(alertId)],
  );
  return rowCount > 0;
}
