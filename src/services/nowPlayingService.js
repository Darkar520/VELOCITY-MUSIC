/**
 * nowPlayingService.js — Sincronización en tiempo real entre dispositivos.
 *
 * Mantiene el estado "now playing" por usuario en memoria (efímero, no se
 * persiste en BD). Cuando un dispositivo reproduce/pausa/salta una pista,
 * lo notifica via POST /api/now-playing y el servicio lo retransmite a todos
 * los demás dispositivos del mismo usuario via SSE (Server-Sent Events).
 *
 * Endpoints:
 *   POST /api/now-playing        — actualizar estado de reproducción
 *   GET  /api/now-playing/events — stream SSE (una conexión por dispositivo)
 *   GET  /api/now-playing        — estado actual (sin SSE)
 */

// Map<userId, { state, clients: Set<res> }>
const sessions = new Map();

/**
 * Actualiza el estado "now playing" de un usuario y lo retransmite via SSE.
 * @param {string} userId
 * @param {object} payload — { trackId, title, artist, cover, position, duration, playing, deviceName, quality }
 */
export function updateNowPlaying(userId, payload) {
  if (!userId) return;
  const session = sessions.get(userId) || { state: null, clients: new Set() };
  session.state = {
    ...payload,
    userId,
    updatedAt: Date.now(),
  };
  sessions.set(userId, session);
  broadcast(userId);
}

/**
 * Obtiene el estado actual de reproducción de un usuario.
 */
export function getNowPlaying(userId) {
  const session = sessions.get(userId);
  if (!session || !session.state) return null;
  // Expirar si no se ha actualizado en 5 minutos.
  if (Date.now() - session.state.updatedAt > 5 * 60 * 1000) return null;
  return session.state;
}

/**
 * Registra un cliente SSE para recibir actualizaciones en tiempo real.
 * @param {string} userId
 * @param {import('express').Response} res
 * @returns {Function} cleanup function para remover el cliente
 */
export function subscribeNowPlaying(userId, res) {
  if (!userId) return () => {};
  const session = sessions.get(userId) || { state: null, clients: new Set() };
  session.clients.add(res);
  sessions.set(userId, session);

  // Enviar estado actual inmediatamente si existe.
  if (session.state) {
    sendSSE(res, session.state);
  }

  return () => {
    const s = sessions.get(userId);
    if (s) s.clients.delete(res);
  };
}

/**
 * Envía un evento SSE a un cliente.
 */
function sendSSE(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

/**
 * Retransmite el estado actual a todos los clientes SSE de un usuario.
 */
function broadcast(userId) {
  const session = sessions.get(userId);
  if (!session || !session.state) return;
  const msg = JSON.stringify(session.state);
  for (const client of session.clients) {
    try {
      client.write(`data: ${msg}\n\n`);
    } catch {
      session.clients.delete(client);
    }
  }
}

/**
 * Limpia sesiones expiradas (state sin actualizar en 10 min).
 * Llamar periódicamente.
 */
export function cleanupExpired() {
  const now = Date.now();
  for (const [userId, session] of sessions) {
    if (session.state && now - session.state.updatedAt > 10 * 60 * 1000) {
      session.state = null;
      // Notificar a los clientes que ya no hay reproducción.
      for (const client of session.clients) {
        try { client.write(`data: ${JSON.stringify({ stopped: true })}\n\n`); } catch {}
      }
    }
    // Remover sesiones sin clientes ni estado.
    if (!session.state && session.clients.size === 0) {
      sessions.delete(userId);
    }
  }
}

// Ejecutar limpieza cada 5 minutos.
setInterval(cleanupExpired, 5 * 60 * 1000).unref?.();
