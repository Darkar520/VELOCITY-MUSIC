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
export function scheduleLibraryOfflineSync(trackIds) {
  const ids = [...new Set((Array.isArray(trackIds) ? trackIds : [trackIds]).filter(Boolean))];
  if (!ids.length) return;

  const lyricQueue = [...ids];
  const workers = Array.from({ length: Math.min(2, lyricQueue.length) }, async () => {
    while (lyricQueue.length) {
      const id = lyricQueue.shift();
      const tk = trackById(id);
      if (tk) await ensureLyricsOffline(tk);
    }
  });
  Promise.all(workers).catch(() => {});
}

const BACKFILL_DONE_KEY = 'velocity.lyricsBackfillDone';

/**
 * Backfill de letras offline para TODA la biblioteca ya existente
 * (favoritos + pistas de playlists propias + playlists/mezclas guardadas +
 * descargas de audio). Pensado para correr una sola vez por dispositivo tras
 * desplegar esta feature, y de ahí en adelante los triggers puntuales
 * (like/descargar/guardar) mantienen todo al día de forma incremental.
 *
 * No bloquea la UI: reusa el mismo scheduler de 2 workers que ya limita la
 * tasa de peticiones a /api/lyrics. Silencioso ante fallos individuales.
 *
 * @param {{ favs: string[], playlists: {trackIds:string[]}[], savedPlaylists: {trackIds:string[]}[], downloadedIds: string[] }} lib
 */
export function backfillLibraryLyrics(lib) {
  try {
    if (localStorage.getItem(BACKFILL_DONE_KEY) === '1') return;
  } catch { /* localStorage inaccesible: seguir sin marca, no bloquear */ }

  const ids = new Set();
  (lib?.favs || []).forEach((id) => id && ids.add(id));
  (lib?.playlists || []).forEach((p) => (p.trackIds || []).forEach((id) => id && ids.add(id)));
  (lib?.savedPlaylists || []).forEach((p) => (p.trackIds || []).forEach((id) => id && ids.add(id)));
  (lib?.downloadedIds || []).forEach((id) => id && ids.add(id));

  if (!ids.size) return;
  scheduleLibraryOfflineSync([...ids]);

  try { localStorage.setItem(BACKFILL_DONE_KEY, '1'); } catch { /* best-effort */ }
}
