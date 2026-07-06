/**
 * Repositorios respaldados por PostgreSQL. Implementan la misma interfaz que los
 * repositorios en memoria. Reciben una función `query(text, params)`.
 */

const USER_COLS = 'id, email, password_hash, display_name, avatar, is_guest';
const mapUser = (r) => r ? {
  id: r.id, email: r.email, passwordHash: r.password_hash,
  displayName: r.display_name || '', avatar: r.avatar || '', isGuest: !!r.is_guest,
} : null;

export function createPgUserRepo(query) {
  return {
    async findByEmail(email) {
      const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email]);
      return mapUser(rows[0]);
    },
    async findById(id) {
      const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
      return mapUser(rows[0]);
    },
    async insert({ email, passwordHash, displayName = '', isGuest = false }) {
      const { rows } = await query(
        `INSERT INTO users (email, password_hash, display_name, is_guest)
         VALUES ($1, $2, $3, $4) RETURNING ${USER_COLS}`,
        [email, passwordHash, displayName || '', !!isGuest],
      );
      return mapUser(rows[0]);
    },
    async updateProfile(id, { displayName, avatar }) {
      const sets = []; const vals = []; let i = 1;
      if (typeof displayName === 'string') { sets.push(`display_name = $${i++}`); vals.push(displayName.trim().slice(0, 40)); }
      if (typeof avatar === 'string') { sets.push(`avatar = $${i++}`); vals.push(avatar.slice(0, 24)); }
      if (!sets.length) { const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]); return mapUser(rows[0]); }
      vals.push(id);
      const { rows } = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${USER_COLS}`, vals);
      return mapUser(rows[0]);
    },
    async recordLogin(id) {
      await query('UPDATE users SET last_login = now(), login_count = login_count + 1 WHERE id = $1', [id]);
    },
    async recordPlay(id) {
      await query('UPDATE users SET play_count = play_count + 1, last_active = now() WHERE id = $1', [id]);
    },
    async remove(id) {
      // FK ON DELETE CASCADE limpia playlists, favoritos, historial y álbumes.
      const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
      return rowCount > 0;
    },
  };
}

export function createPgSavedAlbumsRepo(query) {
  return {
    async list(userId) {
      const { rows } = await query(
        'SELECT album_id, name, artist, cover, year FROM saved_albums WHERE user_id = $1 ORDER BY saved_at DESC',
        [userId],
      );
      return rows.map((r) => ({ albumId: r.album_id, name: r.name, artist: r.artist, cover: r.cover, year: r.year }));
    },
    async add(userId, album) {
      if (!album || !album.albumId) return;
      await query(
        `INSERT INTO saved_albums (user_id, album_id, name, artist, cover, year)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, album_id) DO NOTHING`,
        [userId, album.albumId, album.name || '', album.artist || '', album.cover || '', album.year || null],
      );
    },
    async remove(userId, albumId) {
      await query('DELETE FROM saved_albums WHERE user_id = $1 AND album_id = $2', [userId, albumId]);
    },
  };
}

export function createPgTrackMetaRepo(query) {
  return {
    async upsertMany(tracks) {
      if (!Array.isArray(tracks)) return;
      for (const t of tracks.slice(0, 500)) {
        if (!t || !t.id) continue;
        await query(
          `INSERT INTO track_meta (id, title, artist, artist_id, album, album_id, genre, cover, duration_seconds, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (id) DO UPDATE SET
             title=EXCLUDED.title, artist=EXCLUDED.artist, artist_id=EXCLUDED.artist_id,
             album=EXCLUDED.album, album_id=EXCLUDED.album_id, genre=EXCLUDED.genre,
             cover=EXCLUDED.cover, duration_seconds=EXCLUDED.duration_seconds, updated_at=now()`,
          [t.id, t.title || '', t.artist || '', t.artistId || null, t.album || '', t.albumId || null, t.genre || '', t.cover || '', t.durationSeconds || t.duration || 0],
        );
      }
    },
    async getMany(ids) {
      if (!Array.isArray(ids) || !ids.length) return [];
      const { rows } = await query(
        `SELECT id, title, artist, artist_id, album, album_id, genre, cover, duration_seconds
         FROM track_meta WHERE id = ANY($1)`,
        [ids],
      );
      return rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist, artistId: r.artist_id, album: r.album, albumId: r.album_id, genre: r.genre, cover: r.cover, durationSeconds: r.duration_seconds }));
    },
    async has(id) {
      const { rows } = await query('SELECT 1 FROM track_meta WHERE id = $1', [id]);
      return rows.length > 0;
    },
  };
}

export function createPgStatsRepo(query) {
  return {
    async incr(metric, n = 1) {
      await query(
        `INSERT INTO app_stats (metric, value) VALUES ($1, $2)
         ON CONFLICT (metric) DO UPDATE SET value = app_stats.value + $2`,
        [metric, n],
      );
    },
    async recordSearch(userId, q) {
      if (!userId || !q) return;
      await query('INSERT INTO search_log (user_id, q) VALUES ($1, $2)', [userId, String(q).slice(0, 200)]);
    },
    async userActivity(idOrEmail, limit = 200) {
      // Resolver por id (UUID) o email.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(idOrEmail));
      const { rows: urows } = await query(
        `SELECT id, email, display_name, is_guest, created_at, last_login, last_active, login_count, play_count
         FROM users WHERE ${isUuid ? 'id = $1' : 'email = $1'}`,
        [isUuid ? idOrEmail : String(idOrEmail).toLowerCase()],
      );
      if (!urows[0]) return null;
      const u = urows[0];
      const uid = u.id;
      const [{ rows: plays }, { rows: searches }, { rows: top }] = await Promise.all([
        query(`SELECT h.track_id, (EXTRACT(EPOCH FROM h.played_at)*1000)::bigint AS at, t.title, t.artist
               FROM listening_history h LEFT JOIN track_meta t ON t.id = h.track_id
               WHERE h.user_id = $1 ORDER BY h.played_at DESC LIMIT $2`, [uid, limit]),
        query(`SELECT q, (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS at FROM search_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [uid, limit]),
        query(`SELECT h.track_id, COUNT(*)::int AS count, t.title, t.artist
               FROM listening_history h LEFT JOIN track_meta t ON t.id = h.track_id
               WHERE h.user_id = $1 GROUP BY h.track_id, t.title, t.artist ORDER BY count DESC LIMIT 15`, [uid]),
      ]);
      return {
        user: { id: uid, email: u.email, displayName: u.display_name || '', isGuest: !!u.is_guest, createdAt: u.created_at, lastLogin: u.last_login ? new Date(u.last_login).getTime() : null, lastActive: u.last_active ? new Date(u.last_active).getTime() : null, loginCount: u.login_count || 0, playCount: u.play_count || 0 },
        plays: plays.map((p) => ({ trackId: p.track_id, at: Number(p.at), title: p.title || '', artist: p.artist || '' })),
        searches: searches.map((s) => ({ q: s.q, at: Number(s.at) })),
        topTracks: top.map((t) => ({ trackId: t.track_id, count: t.count, title: t.title || '', artist: t.artist || '' })),
        totals: { plays: plays.length, searches: searches.length },
      };
    },
    async summary() {
      const [{ rows: statRows }, { rows: userRows }] = await Promise.all([
        query('SELECT metric, value FROM app_stats'),
        query(`SELECT email, created_at, last_login, last_active, login_count, play_count FROM users ORDER BY COALESCE(last_active, last_login, created_at) DESC`),
      ]);
      const s = Object.fromEntries(statRows.map((r) => [r.metric, Number(r.value)]));
      const users = userRows.map((u) => ({
        email: u.email, createdAt: u.created_at,
        lastLogin: u.last_login ? new Date(u.last_login).getTime() : null,
        lastActive: u.last_active ? new Date(u.last_active).getTime() : null,
        loginCount: u.login_count || 0, playCount: u.play_count || 0,
      }));
      return {
        totals: { registeredUsers: users.length, logins: s.logins || 0, plays: s.plays || 0, searches: s.searches || 0 },
        users,
      };
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
    async record(userId, trackId, playedAt = Date.now(), userAgent = '') {
      await query(
        `INSERT INTO listening_history (user_id, track_id, played_at, user_agent)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), $4)`,
        [userId, trackId, playedAt, String(userAgent || '').slice(0, 300)],
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

export function createPgSavedPlaylistsRepo(query) {
  return {
    async list(userId) {
      const { rows } = await query(
        'SELECT playlist_id, name, cover, track_ids FROM saved_playlists WHERE user_id = $1 ORDER BY saved_at DESC',
        [userId],
      );
      return rows.map((r) => ({ playlistId: r.playlist_id, name: r.name, cover: r.cover, trackIds: r.track_ids || [] }));
    },
    async add(userId, playlist) {
      if (!playlist || !playlist.playlistId) return;
      await query(
        `INSERT INTO saved_playlists (user_id, playlist_id, name, cover, track_ids)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, playlist_id) DO UPDATE
         SET name = EXCLUDED.name, cover = EXCLUDED.cover, track_ids = EXCLUDED.track_ids`,
        [userId, playlist.playlistId, playlist.name || '', playlist.cover || '', playlist.trackIds || []],
      );
    },
    async remove(userId, playlistId) {
      await query('DELETE FROM saved_playlists WHERE user_id = $1 AND playlist_id = $2', [userId, playlistId]);
    },
  };
}
