/**
 * Repositorios respaldados por PostgreSQL. Implementan la misma interfaz que los
 * repositorios en memoria. Reciben una función `query(text, params)`.
 */

export function createPgUserRepo(query) {
  return {
    async findByEmail(email) {
      const { rows } = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
      return rows[0] ? { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash } : null;
    },
    async findById(id) {
      const { rows } = await query('SELECT id, email, password_hash FROM users WHERE id = $1', [id]);
      return rows[0] ? { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash } : null;
    },
    async insert({ email, passwordHash }) {
      const { rows } = await query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash],
      );
      return { id: rows[0].id, email: rows[0].email };
    },
  };
}

export function createPgPlaylistRepo(query) {
  return {
    async create(userId, name) {
      const { rows } = await query(
        'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
        [userId, name],
      );
      return { id: rows[0].id, userId, name };
    },
    async get(playlistId) {
      const { rows } = await query('SELECT id, user_id FROM playlists WHERE id = $1', [playlistId]);
      return rows[0] ? { id: rows[0].id, userId: rows[0].user_id } : null;
    },
    async listByUser(userId) {
      const { rows } = await query(
        'SELECT id, user_id, name FROM playlists WHERE user_id = $1 ORDER BY created_at',
        [userId],
      );
      return rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name }));
    },
    async addTrack(playlistId, trackId) {
      await query(
        `INSERT INTO playlist_tracks (playlist_id, track_id, position)
         VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM playlist_tracks WHERE playlist_id = $1), 0))`,
        [playlistId, trackId],
      );
    },
    async trackCount(playlistId) {
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM playlist_tracks WHERE playlist_id = $1', [playlistId]);
      return rows[0].n;
    },
    async getTracks(playlistId) {
      const { rows } = await query(
        'SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position',
        [playlistId],
      );
      return rows.map((r) => r.track_id);
    },
    async removeTrackOccurrence(playlistId, trackId) {
      await query(
        `DELETE FROM playlist_tracks WHERE id = (
           SELECT id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2
           ORDER BY position LIMIT 1)`,
        [playlistId, trackId],
      );
    },
    async delete(playlistId) {
      await query('DELETE FROM playlists WHERE id = $1', [playlistId]);
    },
  };
}

export function createPgFavoritesRepo(query) {
  return {
    async has(userId, trackId) {
      const { rows } = await query(
        'SELECT 1 FROM favorites WHERE user_id = $1 AND track_id = $2',
        [userId, trackId],
      );
      return rows.length > 0;
    },
    async add(userId, trackId) {
      await query(
        'INSERT INTO favorites (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, trackId],
      );
    },
    async remove(userId, trackId) {
      await query('DELETE FROM favorites WHERE user_id = $1 AND track_id = $2', [userId, trackId]);
    },
    async list(userId) {
      const { rows } = await query(
        'SELECT track_id FROM favorites WHERE user_id = $1 ORDER BY favorited_at DESC',
        [userId],
      );
      return rows.map((r) => r.track_id);
    },
  };
}

export function createPgHistoryRepo(query) {
  return {
    async record(userId, trackId, playedAt = Date.now()) {
      await query(
        'INSERT INTO listening_history (user_id, track_id, played_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))',
        [userId, trackId, playedAt],
      );
    },
    async list(userId, limit = 100) {
      const { rows } = await query(
        `SELECT track_id, user_id, (EXTRACT(EPOCH FROM played_at) * 1000)::bigint AS played_at
         FROM listening_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT $2`,
        [userId, limit],
      );
      return rows.map((r) => ({ trackId: r.track_id, userId: r.user_id, playedAt: Number(r.played_at) }));
    },
  };
}
