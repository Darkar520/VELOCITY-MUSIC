/**
 * useLibrarySync — sincronización de biblioteca entre store y backend.
 *
 * Responsabilidades:
 *   1. Hidratar el libraryStore desde localStorage al montar (offline-first).
 *      Clave: 'velocity.lib.<email>' (per-usuario, evita mezclar cuentas).
 *      Antes había duplicación con App.jsx — este hook es ahora la ÚNICA fuente.
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
import { allCached, saveMeta, trackById, normalizeTrack, cacheTrack } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import { backfillLibraryLyrics } from '../offlineLibrary.js';
import * as offline from '../offline.js';

function libCacheKey() {
  return 'velocity.lib.' + (localStorage.getItem('velocity.email') || 'u');
}

function readLibCache() {
  try {
    const raw = localStorage.getItem(libCacheKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeLibCache(favIds, pls, albums, savedPls, recentIds) {
  try {
    const libIds = new Set([...(favIds || []), ...(recentIds || [])]);
    (pls || []).forEach(p => (p.trackIds || []).forEach(id => libIds.add(id)));
    (albums || []).forEach(a => (a.trackIds || []).forEach(id => libIds.add(id)));
    (savedPls || []).forEach(p => (p.trackIds || []).forEach(id => libIds.add(id)));
    // Filtrar covers data:/blob: para no exceder quota de localStorage.
    const tracks = [...libIds].map(trackById).filter(Boolean).map(t =>
      (typeof t.cover === 'string' && (t.cover.startsWith('data:') || t.cover.startsWith('blob:')))
        ? { ...t, cover: '' } : t
    );
    localStorage.setItem(libCacheKey(), JSON.stringify({
      favs: favIds || [],
      playlists: pls || [],
      savedAlbums: albums || [],
      savedPlaylists: savedPls || [],
      recent: recentIds || [],
      tracks,
    }));
  } catch { /* quota excedido */ }
}

async function hydrateSavedAlbums(albums) {
  const result = (Array.isArray(albums) ? albums : []).map((album) => ({ ...album }));
  const queue = result
    .map((album, index) => ({ album, index }))
    .filter(({ album }) => album?.albumId && (!Array.isArray(album.trackIds) || !album.trackIds.length || album.trackIds.some((id) => !trackById(id))));

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      try {
        const detail = await api.album(item.album.albumId);
        const tracks = Array.isArray(detail?.tracks) ? detail.tracks : [];
        tracks.forEach(normalizeTrack);
        if (tracks.length) {
          result[item.index] = {
            ...item.album,
            trackIds: tracks.map((track) => track.id).filter(Boolean),
          };
        }
      } catch { /* se reintentará en el siguiente arranque */ }
    }
  };

  await Promise.all([worker(), worker()]);
  return result;
}

export function useLibrarySync({ authed } = {}) {
  const didInitRef = useRef(false);

  // ─── 1. Hidratar desde localStorage al montar (una sola vez) ─────
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const c = readLibCache();
    if (!c) return;
    // Poblar catálogo primero (los tracks cacheados) — restoreLibCache original hacía esto
    if (Array.isArray(c.tracks)) c.tracks.forEach(cacheTrack);
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
        if (savedPls !== null) store.setSavedPlaylists(savedPls);
        if (pls !== null) {
          const withTracks = await Promise.all(pls.map(async p => {
            const ids = await api.playlistTracks(p.id).catch(() => []);
            return { id: p.id, name: p.name, trackIds: ids };
          }));
          if (!cancel) store.setPlaylists(withTracks);
        }

        // Los álbumes antiguos solo guardan metadata en backend. Expandirlos a
        // trackIds permite que el backfill alcance sus canciones y que el
        // resultado quede cacheado localmente para el siguiente arranque.
        let hydratedAlbums = null;
        if (albums !== null) {
          const cachedAlbums = store.savedAlbums || [];
          const mergedAlbums = albums.map((album) => ({
            ...(cachedAlbums.find((cached) => cached.albumId === album.albumId) || {}),
            ...album,
          }));
          hydratedAlbums = await hydrateSavedAlbums(mergedAlbums);
          if (!cancel) store.setSavedAlbums(hydratedAlbums);
        }
        if (cancel) return;

        // Las descargas son otra fuente de verdad: sus metadatos deben entrar
        // al catálogo antes de programar letras, aunque nunca hayan sido parte
        // de favoritos o playlists.
        const [downloadedIds, downloadedMetas] = await Promise.all([
          offline.listIds().catch(() => []),
          offline.listMetas().catch(() => []),
        ]);
        downloadedMetas.forEach(cacheTrack);

        // Subir metadatos locales al backend (sync cross-device).
        const local = allCached().map(slimTrack).filter(Boolean);
        if (local.length) api.saveTracks(local).catch(() => {});

        // Hidratar metadatos de todas las colecciones que alimentan el
        // backfill: favoritos, playlists propias/guardadas, álbumes guardados
        // y descargas. Antes solo se cubrían favoritos y playlists propias.
        if (fav !== null || pls !== null || albums !== null || savedPls !== null || downloadedIds.length) {
          const libraryState = useLibraryStore.getState();
          const finalFavs = fav !== null ? fav : (libraryState.favs || []);
          const recentIds = hist !== null ? hist.map(h => h.trackId) : (libraryState.recent || []);
          const currentPls = libraryState.playlists;
          const currentAlbums = libraryState.savedAlbums;
          const allIds = new Set([...finalFavs, ...recentIds, ...(downloadedIds || [])]);
          currentPls.forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          (savedPls || []).forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          (currentAlbums || []).forEach(a => (a.trackIds || []).forEach(id => allIds.add(id)));
          const missing = [...allIds].filter(id => id && !trackById(id));
          for (let i = 0; i < missing.length && !cancel; i += 300) {
            const metas = await api.getTracks(missing.slice(i, i + 300)).catch(() => []);
            if (!cancel && metas.length) metas.forEach(normalizeTrack);
          }
          if (!cancel) {
            saveMeta();
            const finalPlaylists = useLibraryStore.getState().playlists;
            const finalAlbums = useLibraryStore.getState().savedAlbums;
            writeLibCache(finalFavs, finalPlaylists, finalAlbums, savedPls || [], recentIds);
            // Sincronización silenciosa por cuenta y por pista. Las fallidas
            // permanecen pendientes y se reintentan en el siguiente arranque.
            backfillLibraryLyrics({
              scope: localStorage.getItem('velocity.email') || 'anonymous',
              favs: finalFavs,
              playlists: finalPlaylists,
              savedAlbums: finalAlbums,
              savedPlaylists: savedPls || [],
              downloadedIds: downloadedIds || [],
            });
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
