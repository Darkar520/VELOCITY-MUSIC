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
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'velocity-db.json');

function emptyStore() {
  return { users: {}, emailIndex: {}, playlists: {}, favorites: {}, history: [], savedAlbums: {}, seq: 0 };
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
    async insert({ email, passwordHash }) {
      const user = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
      store.users[user.id] = user;
      store.emailIndex[email] = user.id;
      save();
      return user;
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
    async record(userId, trackId, playedAt = Date.now()) {
      store.history.push({ userId, trackId, playedAt });
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
