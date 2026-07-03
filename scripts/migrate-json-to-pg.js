// ═══════════════════════════════════════════════════════════════
// Migración de datos: archivo JSON  →  PostgreSQL.
//
// Copia usuarios, playlists, favoritos, historial, álbumes guardados,
// metadatos de pistas y estadísticas desde data/velocity-db.json a Postgres.
//
// Uso (con Postgres corriendo y variables PG*/DATABASE_URL configuradas):
//   node scripts/migrate-json-to-pg.js
//
// Es re-ejecutable: usa ON CONFLICT DO NOTHING para no duplicar. Las playlists
// se reinsertan con IDs nuevos (UUID) preservando su contenido y orden.
// ═══════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, query, closePool } from '../src/db/pool.js';
import { initSchema } from '../src/db/init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '..', 'data', 'velocity-db.json');

async function main() {
  if (!existsSync(DB_FILE)) {
    console.error(`No se encontró ${DB_FILE}. Nada que migrar.`);
    return;
  }
  const store = JSON.parse(readFileSync(DB_FILE, 'utf8'));
  await initSchema();
  const client = await getPool().connect();
  let users = 0, playlists = 0, favs = 0, hist = 0, albums = 0, tracks = 0;
  try {
    await client.query('BEGIN');

    // Usuarios (preservando id para mantener las referencias).
    for (const u of Object.values(store.users || {})) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, avatar, is_guest, created_at, last_login, last_active, login_count, play_count)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()), $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email, u.passwordHash, u.displayName || '', u.avatar || '', !!u.isGuest,
         u.createdAt || null, tsOrNull(u.lastLogin), tsOrNull(u.lastActive), u.loginCount || 0, u.playCount || 0],
      );
      users++;
    }

    // Playlists (+ sus pistas) con IDs nuevos.
    for (const p of Object.values(store.playlists || {})) {
      if (!store.users?.[p.userId]) continue; // huérfana
      const { rows } = await client.query(
        'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
        [p.userId, (p.name || 'Playlist').slice(0, 100)],
      );
      const pid = rows[0].id;
      const list = Array.isArray(p.tracks) ? p.tracks : [];
      for (let i = 0; i < list.length; i++) {
        await client.query('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1,$2,$3)', [pid, list[i], i]);
      }
      playlists++;
    }

    // Favoritos.
    for (const [userId, map] of Object.entries(store.favorites || {})) {
      if (!store.users?.[userId]) continue;
      for (const [trackId, at] of Object.entries(map || {})) {
        await client.query(
          `INSERT INTO favorites (user_id, track_id, favorited_at) VALUES ($1,$2, to_timestamp($3/1000.0))
           ON CONFLICT (user_id, track_id) DO NOTHING`,
          [userId, trackId, Number(at) || Date.now()],
        );
        favs++;
      }
    }

    // Historial.
    for (const h of store.history || []) {
      if (!store.users?.[h.userId]) continue;
      await client.query(
        'INSERT INTO listening_history (user_id, track_id, played_at) VALUES ($1,$2, to_timestamp($3/1000.0))',
        [h.userId, h.trackId, Number(h.playedAt) || Date.now()],
      );
      hist++;
    }

    // Álbumes guardados.
    for (const [userId, arr] of Object.entries(store.savedAlbums || {})) {
      if (!store.users?.[userId]) continue;
      for (const a of arr || []) {
        await client.query(
          `INSERT INTO saved_albums (user_id, album_id, name, artist, cover, year)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, album_id) DO NOTHING`,
          [userId, a.albumId, a.name || '', a.artist || '', a.cover || '', a.year || null],
        );
        albums++;
      }
    }

    // Metadatos de pistas.
    for (const t of Object.values(store.tracks || {})) {
      if (!t || !t.id) continue;
      await client.query(
        `INSERT INTO track_meta (id, title, artist, artist_id, album, album_id, genre, cover, duration_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.title || '', t.artist || '', t.artistId || null, t.album || '', t.albumId || null, t.genre || '', t.cover || '', t.durationSeconds || 0],
      );
      tracks++;
    }

    // Estadísticas globales.
    for (const [metric, value] of Object.entries(store.stats || {})) {
      await client.query(
        `INSERT INTO app_stats (metric, value) VALUES ($1,$2)
         ON CONFLICT (metric) DO UPDATE SET value = EXCLUDED.value`,
        [metric, Number(value) || 0],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log('✅ Migración completada:');
  console.log(`   usuarios=${users} playlists=${playlists} favoritos=${favs} historial=${hist} álbumes=${albums} pistas=${tracks}`);
}

function tsOrNull(ms) { return ms ? new Date(Number(ms)).toISOString() : null; }

main()
  .then(() => closePool())
  .catch((err) => { console.error('❌ Error en la migración:', err.message); process.exitCode = 1; return closePool(); });
