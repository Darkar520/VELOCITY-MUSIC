import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { writeFile, mkdir as mkdirAsync, copyFile as copyFileAsync, rename as renameAsync } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repositorios persistentes en un único archivo JSON.
 *
 * Misma interfaz asíncrona que los repos en memoria / PostgreSQL, pero los datos
 * (usuarios, playlists, favoritos, historial) sobreviven a los reinicios del
 * servidor. Ideal para uso personal / red local sin necesidad de instalar una
 * base de datos. Para producción multiusuario a gran escala, usar PostgreSQL
 * (USE_POSTGRES=1).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Directorio de datos configurable (VELOCITY_DATA_DIR) para aislar staging de
// producción: dos instancias no deben escribir el mismo velocity-db.json.
const DATA_DIR = process.env.VELOCITY_DATA_DIR
  ? path.resolve(process.env.VELOCITY_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'velocity-db.json');

function emptyStore() {
  return { users: {}, emailIndex: {}, playlists: {}, favorites: {}, history: [], savedAlbums: {}, savedPlaylists: {}, tracks: {}, searchLog: [], revokedTokens: {}, stats: { logins: 0, plays: 0, searches: 0 }, seq: 0 };
}

let store = emptyStore();
try {
  if (existsSync(DB_FILE)) {
    store = { ...emptyStore(), ...JSON.parse(readFileSync(DB_FILE, 'utf8')) };
  }
} catch (e) {
  // El archivo existe pero no se pudo leer/parsear. NUNCA lo sobrescribimos en
  // silencio: preservamos una copia para no perder datos y arrancamos vacío.
  try {
    if (existsSync(DB_FILE)) {
      const backup = `${DB_FILE}.corrupt-${Date.now()}`;
      copyFileSync(DB_FILE, backup);
      console.error(`Base de datos JSON ilegible (${e.message}). Copia preservada en ${backup}.`);
    }
  } catch {}
  store = emptyStore();
}

// Cola de escritura asíncrona: evita bloquear el event loop de Node.js.
// Las escrituras se fusionan (debounce) para que múltiples cambios rápidos
// resulten en una sola escritura a disco.
let _flushPending = false;
let _flushInProgress = false;

async function flushAsync() {
  if (_flushInProgress) { _flushPending = true; return; }
  _flushPending = false;
  _flushInProgress = true;
  try {
    const dir = DATA_DIR;
    if (!existsSync(dir)) await mkdirAsync(dir, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    // Serializar + escribir asíncronamente: no bloquea el event loop.
    await writeFile(tmp, JSON.stringify(store), 'utf8');
    try { if (existsSync(DB_FILE)) await copyFileAsync(DB_FILE, `${DB_FILE}.bak`); } catch {}
    await renameAsync(tmp, DB_FILE);
  } catch (e) {
    console.error('No se pudo guardar la base de datos JSON:', e.message);
  } finally {
    _flushInProgress = false;
    // Si llegó otra escritura mientras estábamos guardando, volver a guardar.
    if (_flushPending) { _flushPending = false; flushAsync(); }
  }
}

function flush() {
  // Usado solo en los handlers de señal de salida (SIGINT/SIGTERM/exit)
  // donde es aceptable bloquear porque el proceso está terminando.
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store), 'utf8');
    try { if (existsSync(DB_FILE)) copyFileSync(DB_FILE, `${DB_FILE}.bak`); } catch {}
    renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('No se pudo guardar la base de datos JSON (sync):', e.message);
  }
}

function save() {
  // Programar una escritura asíncrona fusionada. Si ya hay una pendiente
  // o en progreso, solo marcar el flag para repetir al terminar.
  if (_flushInProgress) { _flushPending = true; return; }
  if (!_flushPending) {
    _flushPending = true;
    // setImmediate cede el control al event loop antes de escribir.
    setImmediate(() => flushAsync());
  }
}
// Red de seguridad: volcar al salir.
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  try { process.on(sig, () => { flush(); if (sig !== 'exit') process.exit(0); }); } catch {}
}

export function createJsonUserRepo() {
  return {
    async findByEmail(email) {
      const id = store.emailIndex[email];
      return id ? store.users[id] || null : null;
    },
    async findById(id) {
      return store.users[id] || null;
    },
    async insert({ email, passwordHash, displayName = '', isGuest = false }) {
      const user = { id: randomUUID(), email, passwordHash, displayName: displayName || '', avatar: '', isGuest: !!isGuest, createdAt: new Date().toISOString() };
      store.users[user.id] = user;
      store.emailIndex[email] = user.id;
      save();
      return user;
    },
    // Actualiza el perfil editable (nombre visible y avatar).
    async updateProfile(id, { displayName, avatar }) {
      const u = store.users[id];
      if (!u) return null;
      if (typeof displayName === 'string') u.displayName = displayName.trim().slice(0, 40);
      if (typeof avatar === 'string') u.avatar = avatar.slice(0, 24);
      save();
      return u;
    },
    // Trazabilidad: registra el último inicio de sesión y cuenta acumulada.
    async recordLogin(id) {
      const u = store.users[id];
      if (u) { u.lastLogin = Date.now(); u.loginCount = (u.loginCount || 0) + 1; save(); }
    },
    // Trazabilidad: cuenta acumulada de reproducciones por usuario.
    async recordPlay(id) {
      const u = store.users[id];
      if (u) { u.playCount = (u.playCount || 0) + 1; u.lastActive = Date.now(); save(); }
    },
    // Elimina la cuenta y todos sus datos asociados (cascada).
    async remove(id) {
      const u = store.users[id];
      if (!u) return false;
      if (u.email && store.emailIndex[u.email] === id) delete store.emailIndex[u.email];
      delete store.users[id];
      if (store.favorites) delete store.favorites[id];
      if (store.savedAlbums) delete store.savedAlbums[id];
      if (store.playlists) for (const pid of Object.keys(store.playlists)) { if (store.playlists[pid]?.userId === id) delete store.playlists[pid]; }
      if (Array.isArray(store.history)) store.history = store.history.filter(h => h.userId !== id);
      save();
      return true;
    },
    // ── Token revocation (logout all) ──
    async getTokensInvalidBefore(id) {
      const u = store.users[id];
      return u?.tokensInvalidBefore ?? null;
    },
    async setTokensInvalidBefore(id, unixSeconds) {
      const u = store.users[id];
      if (u) { u.tokensInvalidBefore = unixSeconds; save(); }
    },
  };
}

/**
 * Repositorio de tokens revocados por `jti` (logout individual).
 * Persiste en el mismo archivo JSON. Auto-purga de expirados en cada consulta.
 */
export function createJsonRevokedTokensRepo() {
  const purge = () => {
    if (!store.revokedTokens || typeof store.revokedTokens !== 'object') return;
    const now = Math.floor(Date.now() / 1000);
    let changed = false;
    for (const [jti, exp] of Object.entries(store.revokedTokens)) {
      if (Number(exp) <= now) { delete store.revokedTokens[jti]; changed = true; }
    }
    if (changed) save();
  };
  return {
    async revoke(jti, expiresAt) {
      if (!store.revokedTokens || typeof store.revokedTokens !== 'object') store.revokedTokens = {};
      store.revokedTokens[String(jti)] = Number(expiresAt) || Math.floor(Date.now() / 1000) + 86400;
      save();
    },
    async isRevoked(jti) {
      purge();
      return !!store.revokedTokens?.[String(jti)];
    },
  };
}

/**
 * Métricas / trazabilidad de uso (contadores globales + resumen por usuario).
 */
export function createJsonStatsRepo() {
  return {
    async incr(metric, n = 1) {
      if (!store.stats) store.stats = {};
      store.stats[metric] = (store.stats[metric] || 0) + n;
      save();
    },
    // Registro de búsqueda por usuario (trazabilidad). Acotado para no crecer sin fin.
    async recordSearch(userId, q) {
      if (!userId || !q) return;
      if (!Array.isArray(store.searchLog)) store.searchLog = [];
      store.searchLog.push({ userId, q: String(q).slice(0, 200), at: Date.now() });
      if (store.searchLog.length > 20000) store.searchLog = store.searchLog.slice(-15000);
      save();
    },
    async summary() {
      const users = Object.values(store.users || {}).map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName || '',
        isGuest: !!u.isGuest,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin || null,
        lastActive: u.lastActive || null,
        loginCount: u.loginCount || 0,
        playCount: u.playCount || 0,
      })).sort((a, b) => (b.lastActive || b.lastLogin || 0) - (a.lastActive || a.lastLogin || 0));
      const s = store.stats || {};
      return {
        totals: {
          registeredUsers: users.length,
          logins: s.logins || 0,
          plays: s.plays || 0,
          searches: s.searches || 0,
        },
        users,
      };
    },
    // Detalle por usuario: reproducciones (con título/artista) y búsquedas recientes.
    async userActivity(idOrEmail, limit = 100) {
      const user = store.users[idOrEmail] || store.users[store.emailIndex[String(idOrEmail).toLowerCase()]];
      if (!user) return null;
      const uid = user.id;
      const plays = (store.history || [])
        .filter((h) => h.userId === uid)
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, limit)
        .map((h) => { const t = store.tracks[h.trackId] || {}; return { trackId: h.trackId, at: h.playedAt, title: t.title || '', artist: t.artist || '' }; });
      const searches = (store.searchLog || [])
        .filter((e) => e.userId === uid)
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((e) => ({ q: e.q, at: e.at }));
      // Top canciones del usuario por número de reproducciones.
      const counts = {};
      for (const h of (store.history || [])) if (h.userId === uid) counts[h.trackId] = (counts[h.trackId] || 0) + 1;
      const topTracks = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)
        .map(([tid, n]) => { const t = store.tracks[tid] || {}; return { trackId: tid, count: n, title: t.title || '', artist: t.artist || '' }; });
      return {
        user: { id: uid, email: user.email, displayName: user.displayName || '', isGuest: !!user.isGuest, createdAt: user.createdAt, lastLogin: user.lastLogin || null, lastActive: user.lastActive || null, loginCount: user.loginCount || 0, playCount: user.playCount || 0 },
        plays, searches, topTracks,
        totals: { plays: plays.length, searches: searches.length },
      };
    },
  };
}

export function createJsonPlaylistRepo() {
  return {
    async create(userId, name) {
      const id = `pl_${++store.seq}_${Date.now().toString(36)}`;
      store.playlists[id] = { id, userId, name, tracks: [] };
      save();
      return { id, userId, name };
    },
    async get(playlistId) {
      return store.playlists[playlistId] || null;
    },
    async listByUser(userId) {
      return Object.values(store.playlists)
        .filter((p) => p.userId === userId)
        .map((p) => ({ id: p.id, userId: p.userId, name: p.name }));
    },
    async addTrack(playlistId, trackId) {
      store.playlists[playlistId].tracks.push(trackId);
      save();
    },
    async trackCount(playlistId) {
      return store.playlists[playlistId].tracks.length;
    },
    async getTracks(playlistId) {
      return [...store.playlists[playlistId].tracks];
    },
    async removeTrackOccurrence(playlistId, trackId) {
      const list = store.playlists[playlistId].tracks;
      const idx = list.indexOf(trackId);
      if (idx !== -1) { list.splice(idx, 1); save(); }
    },
    async delete(playlistId) {
      delete store.playlists[playlistId];
      save();
    },
  };
}

export function createJsonFavoritesRepo() {
  const ensure = (u) => { if (!store.favorites[u]) store.favorites[u] = {}; return store.favorites[u]; };
  return {
    async has(userId, trackId) {
      return Object.prototype.hasOwnProperty.call(ensure(userId), trackId);
    },
    async add(userId, trackId, at = Date.now()) {
      ensure(userId)[trackId] = at; save();
    },
    async remove(userId, trackId) {
      delete ensure(userId)[trackId]; save();
    },
    async list(userId) {
      return Object.entries(ensure(userId))
        .sort((a, b) => b[1] - a[1])
        .map(([trackId]) => trackId);
    },
  };
}

export function createJsonHistoryRepo() {
  return {
    async record(userId, trackId, playedAt = Date.now(), userAgent = '') {
      store.history.push({ userId, trackId, playedAt, userAgent: String(userAgent || '').slice(0, 300) });
      // Acotar historial por usuario para que el archivo no crezca sin límite.
      const mine = store.history.filter((e) => e.userId === userId);
      if (mine.length > 200) {
        const cutoff = mine.sort((a, b) => b.playedAt - a.playedAt)[200].playedAt;
        store.history = store.history.filter((e) => e.userId !== userId || e.playedAt > cutoff);
      }
      save();
    },
    async list(userId, limit = 100) {
      return store.history
        .filter((e) => e.userId === userId)
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, limit)
        .map((e) => ({ trackId: e.trackId, userId: e.userId, playedAt: e.playedAt }));
    },
  };
}

export function createJsonSavedAlbumsRepo() {
  const ensure = (u) => { if (!store.savedAlbums[u]) store.savedAlbums[u] = []; return store.savedAlbums[u]; };
  return {
    async list(userId) {
      return [...ensure(userId)];
    },
    async add(userId, album) {
      const list = ensure(userId);
      if (!album || !album.albumId) return;
      if (!list.some((a) => a.albumId === album.albumId)) {
        list.unshift({ albumId: album.albumId, name: album.name || '', artist: album.artist || '', cover: album.cover || '', year: album.year || null, savedAt: Date.now() });
        save();
      }
    },
    async remove(userId, albumId) {
      store.savedAlbums[userId] = ensure(userId).filter((a) => a.albumId !== albumId);
      save();
    },
  };
}

/**
 * Metadatos de pistas, indexados por id (videoId de YouTube Music).
 *
 * El backend guarda solo IDs en favoritos/playlists/historial; este repositorio
 * conserva además los metadatos (título, artista, carátula...) para que
 * CUALQUIER dispositivo pueda renderizar la biblioteca del usuario sin depender
 * de su caché local. La `url` de streaming NO se guarda: es específica de cada
 * dispositivo/calidad y se reconstruye al hidratar.
 */
export function createJsonTrackMetaRepo() {
  const MAX_TRACKS = 5000; // tope para que el archivo no crezca sin límite
  const slim = (t) => ({
    id: t.id,
    title: t.title || '',
    artist: t.artist || '',
    artistId: t.artistId || null,
    album: t.album || '',
    albumId: t.albumId || null,
    genre: t.genre || '',
    cover: t.cover || '',
    durationSeconds: t.durationSeconds || t.duration || 0,
  });
  return {
    async upsertMany(tracks) {
      if (!Array.isArray(tracks)) return;
      let changed = false;
      for (const t of tracks.slice(0, 500)) {
        if (t && t.id) {
          const prev = store.tracks[t.id];
          const newCover = t.cover || '';
          const cover = newCover !== '' ? newCover : (prev && prev.cover) || '';
          store.tracks[t.id] = { ...prev, ...slim(t), cover };
          changed = true;
        }
      }
      // Evicción simple si se supera el tope (elimina las primeras claves).
      const keys = Object.keys(store.tracks);
      if (keys.length > MAX_TRACKS) {
        for (const k of keys.slice(0, keys.length - MAX_TRACKS)) delete store.tracks[k];
      }
      if (changed) save();
    },
    async getMany(ids) {
      if (!Array.isArray(ids)) return [];
      return ids.map((id) => store.tracks[id]).filter(Boolean);
    },
    async has(id) {
      return !!store.tracks[id];
    },
  };
}

export function createJsonSavedPlaylistsRepo() {
  const ensure = (u) => { if (!store.savedPlaylists[u]) store.savedPlaylists[u] = []; return store.savedPlaylists[u]; };
  return {
    async list(userId) {
      return [...ensure(userId)];
    },
    async add(userId, playlist) {
      if (!playlist || !playlist.playlistId) return;
      const list = ensure(userId);
      const idx = list.findIndex(p => p.playlistId === playlist.playlistId);
      const entry = { playlistId: playlist.playlistId, name: playlist.name || '', cover: playlist.cover || '', trackIds: playlist.trackIds || [], savedAt: Date.now() };
      if (idx !== -1) list[idx] = entry;
      else list.unshift(entry);
      save();
    },
    async remove(userId, playlistId) {
      store.savedPlaylists[userId] = ensure(userId).filter(p => p.playlistId !== playlistId);
      save();
    },
  };
}
