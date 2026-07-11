/**
 * useLibrarySync — sincronización de biblioteca entre store y backend.
 *
 * Responsabilidades:
 *   1. Hidratar el libraryStore desde localStorage al montar (offline-first).
 *   2. Cuando authed=true, hacer fetch inicial de favs/playlists/recent/saved.
 *   3. Re-persistir cache cuando el store cambia.
 *
 * NO maneja:
 *   - SSE now-playing (eso queda en App.jsx, es del dominio player)
 *   - Feed personalizado (depende de too many inputs, queda en App.jsx)
 *   - Upload de pendingFavs offline (sigue en App.jsx, requiere refs)
 *
 * Uso:
 *   useLibrarySync({ authed });
 */
import { useEffect, useRef } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';
import { api } from '../api.js';
import { allCached, saveMeta, trackById, normalizeTrack } from '../catalog.js';
import { slimTrack } from '../helpers.js';

const LIB_CACHE_KEY = 'velocity.libcache.v1';

function readLibCache() {
  try {
    const raw = localStorage.getItem(LIB_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeLibCache(favIds, pls, albums, savedPls, recentIds) {
  try {
    const libIds = new Set([...(favIds || []), ...(recentIds || [])]);
    (pls || []).forEach(p => (p.trackIds || []).forEach(id => libIds.add(id)));
    const tracks = [...libIds].map(trackById).filter(Boolean).map(slimTrack);
    localStorage.setItem(LIB_CACHE_KEY, JSON.stringify({
      favs: favIds || [],
      playlists: pls || [],
      savedAlbums: albums || [],
      savedPlaylists: savedPls || [],
      recent: recentIds || [],
      tracks,
    }));
  } catch { /* quota excedido */ }
}

export function useLibrarySync({ authed } = {}) {
  const didInitRef = useRef(false);

  // ─── 1. Hidratar desde localStorage al montar (una sola vez) ─────
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const c = readLibCache();
    if (!c) return;
    const store = useLibraryStore.getState();
    if (Array.isArray(c.favs))          store.setFavs(c.favs);
    if (Array.isArray(c.playlists))     store.setPlaylists(c.playlists);
    if (Array.isArray(c.savedAlbums))   store.setSavedAlbums(c.savedAlbums);
    if (Array.isArray(c.savedPlaylists)) store.setSavedPlaylists(c.savedPlaylists);
    if (Array.isArray(c.recent))        store.setRecent(c.recent);
  }, []);

  // ─── 2. Fetch inicial cuando authed ───────────────────────────────
  useEffect(() => {
    if (!authed) return;
    let cancel = false;
    (async () => {
      try {
        const [fav, pls, hist, albums, savedPls] = await Promise.all([
          api.favorites().catch(() => null),
          api.playlists().catch(() => null),
          api.history().catch(() => null),
          api.savedAlbums().catch(() => null),
          api.savedPlaylists().catch(() => null),
        ]);
        if (cancel) return;
        const store = useLibraryStore.getState();
        if (fav !== null)      store.setFavs(fav);
        if (hist !== null)     store.setRecent(hist.map(h => h.trackId));
        if (albums !== null)   store.setSavedAlbums(albums);
        if (savedPls !== null) store.setSavedPlaylists(savedPls);
        if (pls !== null) {
          const withTracks = await Promise.all(pls.map(async p => {
            const ids = await api.playlistTracks(p.id).catch(() => []);
            return { id: p.id, name: p.name, trackIds: ids };
          }));
          if (!cancel) store.setPlaylists(withTracks);
        }
        // Subir metadatos locales al backend (sync cross-device)
        const local = allCached().map(slimTrack).filter(Boolean);
        if (local.length) api.saveTracks(local).catch(() => {});
        // Hidratar metadatos faltantes
        if (fav !== null) {
          const recentIds = (hist || []).map(h => h.trackId);
          const allIds = new Set([...fav, ...recentIds]);
          const currentPls = useLibraryStore.getState().playlists;
          currentPls.forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          const missing = [...allIds].filter(id => id && !trackById(id));
          for (let i = 0; i < missing.length && !cancel; i += 300) {
            const metas = await api.getTracks(missing.slice(i, i + 300)).catch(() => []);
            if (!cancel && metas.length) metas.forEach(normalizeTrack);
          }
          if (!cancel) {
            saveMeta();
            writeLibCache(fav, useLibraryStore.getState().playlists, albums || [], savedPls || [], recentIds);
          }
        }
      } catch { /* silent — offline o backend caído */ }
    })();
    return () => { cancel = true; };
  }, [authed]);

  // ─── 3. Re-persistir cache cuando el store cambia ────────────────
  const favs = useLibraryStore((s) => s.favs);
  const playlists = useLibraryStore((s) => s.playlists);
  const savedAlbums = useLibraryStore((s) => s.savedAlbums);
  const savedPlaylists = useLibraryStore((s) => s.savedPlaylists);
  const recent = useLibraryStore((s) => s.recent);

  useEffect(() => {
    if (!authed) return;
    writeLibCache(favs, playlists, savedAlbums, savedPlaylists, recent);
  }, [authed, favs, playlists, savedAlbums, savedPlaylists, recent]);
}

export default useLibrarySync;
