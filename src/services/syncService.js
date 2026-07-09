/**
 * syncService.js — Sincronización completa de biblioteca entre dispositivos.
 *
 * getLibrary  — devuelve el estado completo desde PostgreSQL (5 secciones).
 * pushLibrary — persiste el estado enviado por el cliente (upserts idempotentes).
 *
 * Cada sección se procesa de forma independiente con Promise.allSettled,
 * de modo que el fallo de una no impide la persistencia de las demás.
 */

const MAX_FAVORITES = 5_000;
const MAX_HISTORY   = 10_000;

// ═══════════════════════════════════════════════════════════════
// GET — leer toda la biblioteca del usuario
// ═══════════════════════════════════════════════════════════════

export async function getLibrary(query, userId) {
  const [
    favsR, playlistsR, savedAlbumsR, savedPlaylistsR, historyR,
  ] = await Promise.allSettled([
    getFavorites(query, userId),
    getPlaylists(query, userId),
    getSavedAlbums(query, userId),
    getSavedPlaylists(query, userId),
    getHistory(query, userId),
  ]);

  return {
    favorites:      favsR.status      === 'fulfilled' ? favsR.value      : [],
    playlists:      playlistsR.status === 'fulfilled' ? playlistsR.value : [],
    savedAlbums:    savedAlbumsR.status   === 'fulfilled' ? savedAlbumsR.value   : [],
    savedPlaylists: savedPlaylistsR.status === 'fulfilled' ? savedPlaylistsR.value : [],
    history:        historyR.status   === 'fulfilled' ? historyR.value   : [],
  };
}

async function getFavorites(query, userId) {
  const { rows } = await query(
    `SELECT track_id FROM favorites WHERE user_id = $1 ORDER BY favorited_at DESC LIMIT ${MAX_FAVORITES}`,
    [userId],
  );
  return rows.map((r) => r.track_id);
}

async function getPlaylists(query, userId) {
  const { rows: pls } = await query(
    `SELECT id, name FROM playlists WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  const result = [];
  for (const pl of pls) {
    const { rows: tracks } = await query(
      `SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position`,
      [pl.id],
    );
    result.push({ id: pl.id, name: pl.name, trackIds: tracks.map((t) => t.track_id) });
  }
  return result;
}

async function getSavedAlbums(query, userId) {
  const { rows } = await query(
    `SELECT album_id, name, artist, cover, year FROM saved_albums WHERE user_id = $1 ORDER BY saved_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ albumId: r.album_id, name: r.name, artist: r.artist, cover: r.cover, year: r.year }));
}

async function getSavedPlaylists(query, userId) {
  const { rows } = await query(
    `SELECT playlist_id, name, cover, track_ids FROM saved_playlists WHERE user_id = $1 ORDER BY saved_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ playlistId: r.playlist_id, name: r.name, cover: r.cover, trackIds: r.track_ids || [] }));
}

async function getHistory(query, userId) {
  const { rows } = await query(
    `SELECT track_id, (EXTRACT(EPOCH FROM played_at) * 1000)::bigint AS played_at, user_agent
     FROM listening_history
     WHERE user_id = $1
     ORDER BY played_at DESC
     LIMIT 200`,
    [userId],
  );
  return rows.map((r) => ({ trackId: r.track_id, playedAt: Number(r.played_at), userAgent: r.user_agent || '' }));
}

// ═══════════════════════════════════════════════════════════════
// POST — persistir la biblioteca del cliente
// ═══════════════════════════════════════════════════════════════

/**
 * @param {Function} query
 * @param {string} userId
 * @param {object} payload — { favorites, playlists, savedAlbums, savedPlaylists, history }
 * @returns {{ sections: object, errors: object }} — resultado por sección
 */
export async function pushLibrary(query, userId, payload = {}) {
  // Validaciones de límite antes de procesar.
  if (Array.isArray(payload.favorites) && payload.favorites.length > MAX_FAVORITES) {
    const err = new Error(`El número de favoritos supera el límite permitido (${MAX_FAVORITES})`);
    err.status = 422;
    throw err;
  }

  // Recortar historial si supera el máximo.
  if (Array.isArray(payload.history) && payload.history.length > MAX_HISTORY) {
    payload.history = [...payload.history]
      .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))
      .slice(0, MAX_HISTORY);
  }

  const results = await Promise.allSettled([
    pushFavorites(query, userId, payload.favorites || []),
    pushPlaylists(query, userId, payload.playlists || []),
    pushSavedAlbums(query, userId, payload.savedAlbums || []),
    pushSavedPlaylists(query, userId, payload.savedPlaylists || []),
    pushHistory(query, userId, payload.history || []),
  ]);

  const labels = ['favorites', 'playlists', 'savedAlbums', 'savedPlaylists', 'history'];
  const sections = {}, errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') sections[labels[i]] = r.value;
    else errors[labels[i]] = r.reason?.message || 'Error desconocido';
  });

  return { sections, errors };
}

async function pushFavorites(query, userId, trackIds) {
  // Insertar solo los que no existen. Idempotente gracias a ON CONFLICT DO NOTHING.
  for (const trackId of trackIds.slice(0, MAX_FAVORITES)) {
    if (!trackId) continue;
    await query(
      `INSERT INTO favorites (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, trackId],
    );
  }
  return { upserted: trackIds.length };
}

async function pushPlaylists(query, userId, playlists) {
  let upserted = 0;
  for (const pl of playlists) {
    if (!pl || !pl.id || !pl.name) continue;
    // Crear la playlist si no existe (no sobreescribir nombre si ya existe).
    await query(
      `INSERT INTO playlists (id, user_id, name) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [pl.id, userId, String(pl.name).slice(0, 100)],
    );
    // Sincronizar pistas: upsert por posición.
    for (let i = 0; i < (pl.trackIds || []).length; i++) {
      const trackId = pl.trackIds[i];
      if (!trackId) continue;
      await query(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [pl.id, trackId, i],
      );
    }
    upserted++;
  }
  return { upserted };
}

async function pushSavedAlbums(query, userId, albums) {
  for (const a of albums) {
    if (!a || !a.albumId) continue;
    await query(
      `INSERT INTO saved_albums (user_id, album_id, name, artist, cover, year)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, album_id) DO NOTHING`,
      [userId, a.albumId, a.name || '', a.artist || '', a.cover || '', a.year || null],
    );
  }
  return { upserted: albums.length };
}

async function pushSavedPlaylists(query, userId, playlists) {
  for (const p of playlists) {
    if (!p || !p.playlistId) continue;
    await query(
      `INSERT INTO saved_playlists (user_id, playlist_id, name, cover, track_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, playlist_id) DO UPDATE
         SET name = EXCLUDED.name, cover = EXCLUDED.cover, track_ids = EXCLUDED.track_ids`,
      [userId, p.playlistId, p.name || '', p.cover || '', p.trackIds || []],
    );
  }
  return { upserted: playlists.length };
}

async function pushHistory(query, userId, history) {
  for (const h of history.slice(0, MAX_HISTORY)) {
    if (!h || !h.trackId) continue;
    const playedAt = h.playedAt || Date.now();
    await query(
      `INSERT INTO listening_history (user_id, track_id, played_at, user_agent)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4)`,
      [userId, h.trackId, playedAt, String(h.userAgent || '').slice(0, 300)],
    );
  }
  return { upserted: history.length };
}
