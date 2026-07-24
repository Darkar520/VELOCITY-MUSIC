/**
 * Offline de biblioteca: solo letra al guardar (Me gusta / playlist / mezcla).
 *
 * Audio blob: SOLO con el botón Descargar. Auto-descargar audio al dar like
 * saturaba red/CPU y lagueaba toda la app.
 */
import { api } from './api.js';
import * as offline from './offline.js';
import { trackById } from './catalog.js';

export function isTrackInLibrary(trackId, { favs = [], playlists = [], savedPlaylists = [] } = {}) {
  if (!trackId) return false;
  if (favs.includes(trackId)) return true;
  if (playlists.some((p) => (p.trackIds || []).includes(trackId))) return true;
  if ((savedPlaylists || []).some((p) => (p.trackIds || []).includes(trackId))) return true;
  return false;
}

export async function ensureLyricsOffline(track) {
  if (!track?.id) return false;
  try {
    const existing = await offline.getLyrics(track.id);
    if (existing?.synced) return true;

    const base = {
      artist: track.artist,
      title: track.title,
      album: track.album,
      duration: track.durationSeconds,
      id: track.id,
    };

    let d = await api.lyrics({ ...base, sync: true }).catch(() => null);
    if (!d?.synced) d = await api.lyrics(base).catch(() => null);
    if (!d || (!d.synced && !d.plain)) {
      if (existing?.plain) return true;
      return false;
    }

    await offline.saveLyrics(track.id, {
      synced: d.synced || existing?.synced || null,
      plain: d.plain || existing?.plain || null,
      source: d.source || existing?.source || null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Solo letras (ligero). No descarga audio.
 * @param {string|string[]} trackIds
 */
const activeSyncs = new Map();
const BACKFILL_STATE_PREFIX = 'velocity.lyricsBackfill.v2.';

function syncScope(scope) {
  const value = String(scope || (() => {
    try { return localStorage.getItem('velocity.email') || 'anonymous'; } catch { return 'anonymous'; }
  })()).trim().toLowerCase();
  return encodeURIComponent(value || 'anonymous');
}

function stateKey(scope) {
  return BACKFILL_STATE_PREFIX + syncScope(scope);
}

function readState(scope) {
  try {
    const parsed = JSON.parse(localStorage.getItem(stateKey(scope)) || '{}');
    return {
      completed: new Set(Array.isArray(parsed.completed) ? parsed.completed : []),
      pending: new Set(Array.isArray(parsed.pending) ? parsed.pending : []),
      failed: parsed.failed && typeof parsed.failed === 'object' ? parsed.failed : {},
    };
  } catch {
    return { completed: new Set(), pending: new Set(), failed: {} };
  }
}

function writeState(scope, state) {
  try {
    localStorage.setItem(stateKey(scope), JSON.stringify({
      completed: [...state.completed],
      pending: [...state.pending],
      failed: state.failed,
      updatedAt: Date.now(),
    }));
  } catch { /* best-effort: IndexedDB sigue siendo la fuente de letras */ }
}

/**
 * Descarga letras en segundo plano y conserva el resultado por pista y por
 * cuenta. Las fallidas no se marcan como completadas: una sincronización
 * posterior las vuelve a intentar, incluso tras cerrar el navegador.
 */
export function scheduleLibraryOfflineSync(trackIds, { scope } = {}) {
  const ids = [...new Set((Array.isArray(trackIds) ? trackIds : [trackIds]).filter(Boolean))];
  if (!ids.length) return Promise.resolve([]);
  const key = syncScope(scope);
  if (activeSyncs.has(key)) {
    return activeSyncs.get(key).then(() => scheduleLibraryOfflineSync(ids, { scope }));
  }

  const state = readState(scope);
  ids.forEach((id) => { if (!state.completed.has(id)) state.pending.add(id); });
  writeState(scope, state);
  const queue = [...state.pending];

  const run = Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const tk = trackById(id);
      const ok = !!tk && await ensureLyricsOffline(tk);
      state.pending.delete(id);
      if (ok) {
        state.completed.add(id);
        delete state.failed[id];
      } else {
        state.failed[id] = { attempts: Number(state.failed[id]?.attempts || 0) + 1, at: Date.now() };
      }
      writeState(scope, state);
    }
  })).then(() => [...state.completed]).finally(() => activeSyncs.delete(key));

  activeSyncs.set(key, run);
  return run;
}

/**
 * Backfill de letras offline para toda la biblioteca ya existente:
 * favoritos, playlists propias, playlists/mezclas guardadas, álbumes guardados
 * ya expandidos a trackIds y audios descargados.
 *
 * No utiliza un booleano global. El progreso queda por cuenta y por pista, por
 * lo que las letras fallidas/pendientes se reintentan en el siguiente arranque.
 *
 * @param {{ scope?: string, favs: string[], playlists: {trackIds:string[]}[], savedPlaylists: {trackIds:string[]}[], savedAlbums: {trackIds:string[]}[], downloadedIds: string[] }} lib
 */
export function backfillLibraryLyrics(lib) {
  const ids = new Set();
  (lib?.favs || []).forEach((id) => id && ids.add(id));
  (lib?.playlists || []).forEach((p) => (p.trackIds || []).forEach((id) => id && ids.add(id)));
  (lib?.savedPlaylists || []).forEach((p) => (p.trackIds || []).forEach((id) => id && ids.add(id)));
  (lib?.savedAlbums || []).forEach((a) => (a.trackIds || []).forEach((id) => id && ids.add(id)));
  (lib?.downloadedIds || []).forEach((id) => id && ids.add(id));

  if (!ids.size) return Promise.resolve([]);
  return scheduleLibraryOfflineSync([...ids], { scope: lib?.scope });
}
