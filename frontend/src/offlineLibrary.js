/**
 * Offline de biblioteca: letra + audio solo al añadir a Me gusta / playlist / mezcla.
 *
 * Regla de producto:
 *   - Reproducir cualquier canción → letra ONLINE (ExpandedPlayer).
 *   - Offline (IDB letra + blob audio) → SOLO si el usuario la guarda en biblioteca.
 */
import { api } from './api.js';
import * as offline from './offline.js';
import { trackById } from './catalog.js';

/** ¿Está en Me gusta, playlist propia o mezcla guardada? */
export function isTrackInLibrary(trackId, { favs = [], playlists = [], savedPlaylists = [] } = {}) {
  if (!trackId) return false;
  if (favs.includes(trackId)) return true;
  if (playlists.some((p) => (p.trackIds || []).includes(trackId))) return true;
  if ((savedPlaylists || []).some((p) => (p.trackIds || []).includes(trackId))) return true;
  return false;
}

/**
 * Descarga letra (sync preferido) y la guarda en IndexedDB.
 * No-op si ya hay LRC cacheado.
 * @returns {Promise<boolean>} true si se guardó o ya existía usable
 */
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
      // Si había plain sin sync, conservarlo
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
 * Tras añadir a biblioteca: cachear letra y encolar descarga de audio.
 * Fire-and-forget seguro (no bloquea la UI).
 *
 * @param {string|string[]} trackIds
 * @param {{ download?: (t: object) => Promise<void>, downloadMany?: (ids: string[]) => Promise<void> }} opts
 */
export function scheduleLibraryOfflineSync(trackIds, opts = {}) {
  const ids = [...new Set((Array.isArray(trackIds) ? trackIds : [trackIds]).filter(Boolean))];
  if (!ids.length) return;

  // Letras en paralelo suave (máx 3 a la vez)
  const lyricQueue = [...ids];
  const lyricWorkers = Array.from({ length: Math.min(3, lyricQueue.length) }, async () => {
    while (lyricQueue.length) {
      const id = lyricQueue.shift();
      const tk = trackById(id);
      if (tk) await ensureLyricsOffline(tk);
    }
  });
  Promise.all(lyricWorkers).catch(() => {});

  // Audio offline: batch si hay varios; uno a uno si hay download unitario
  const { download, downloadMany } = opts;
  if (downloadMany && ids.length > 1) {
    downloadMany(ids).catch(() => {});
  } else if (download) {
    ids.forEach((id) => {
      const tk = trackById(id);
      if (tk) download(tk).catch(() => {});
    });
  } else if (downloadMany) {
    downloadMany(ids).catch(() => {});
  }
}
