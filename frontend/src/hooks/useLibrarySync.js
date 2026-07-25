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
 *   - Eventos remotos now-playing: no se consumen en el frontend; el backend conserva solo telemetría compatible.
 *   - Feed personalizado (depende de too many inputs, queda en App.jsx)
 *   - Upload de pendingFavs offline: lo maneja useLibraryActions con outbox por cuenta.
 *
 * Uso:
 *   useLibrarySync({ authed });
 */
import { useEffect, useRef } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';
import { api, getToken, getAuthGeneration } from '../api.js';
import { allCached, saveMeta, trackById, normalizeTrack, cacheTrack } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import {
  loadPendingFavs,
  mergeFavoriteIds,
  cacheIdentity,
  favoriteIntentVersion,
  loadFavoriteIntents,
  pruneAcknowledgedFavoriteIntents,
} from '../favoriteOutbox.js';
import { backfillLibraryLyrics } from '../offlineLibrary.js';
import * as offline from '../offline.js';

function libCacheKey(email) {
  return 'velocity.lib.' + cacheIdentity(email, getToken());
}

function readLibCache(email) {
  try {
    const raw = localStorage.getItem(libCacheKey(email));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeLibCache(favIds, pls, albums, savedPls, recentIds, email) {
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
    localStorage.setItem(libCacheKey(email), JSON.stringify({
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

export function useLibrarySync({ authed, email = '' } = {}) {
  const cacheKey = libCacheKey(email);
  const didInitRef = useRef(null);

  // ─── 1. Hidratar desde localStorage al montar/cambiar de cuenta ────
  useEffect(() => {
    const store = useLibraryStore.getState();
    if (!authed) {
      // La biblioteca es sensible a la cuenta: nunca conservamos el estado
      // anterior mientras la sesión está cerrada o cambia de identidad.
      if (didInitRef.current !== null || store.favs.length || store.playlists.length || store.recent.length || store.savedAlbums.length || store.savedPlaylists.length) store.reset();
      didInitRef.current = null;
      return;
    }
    if (didInitRef.current === cacheKey) return;
    didInitRef.current = cacheKey;
    store.reset();
    const c = readLibCache(email);
    if (!c) return;
    const scope = cacheIdentity(email, getToken());
    const pending = loadPendingFavs(globalThis.localStorage, scope);
    const localIntents = loadFavoriteIntents(scope);
    if (Array.isArray(c.tracks))        c.tracks.forEach(cacheTrack);
    if (Array.isArray(c.favs))          store.setFavs(mergeFavoriteIds(mergeFavoriteIds(c.favs, pending), localIntents));
    if (Array.isArray(c.playlists))     store.setPlaylists(c.playlists);
    if (Array.isArray(c.savedAlbums))   store.setSavedAlbums(c.savedAlbums);
    if (Array.isArray(c.savedPlaylists)) store.setSavedPlaylists(c.savedPlaylists);
    if (Array.isArray(c.recent))        store.setRecent(c.recent);
  }, [authed, cacheKey, email]);

  // ─── 2. Fetch inicial cuando authed ───────────────────────────────
  useEffect(() => {
    if (!authed) return;
    let cancel = false;
    const requestCacheKey = cacheKey;
    const requestAuthGeneration = getAuthGeneration();
    const requestScope = cacheIdentity(email, getToken());
    const requestIntentVersion = favoriteIntentVersion(requestScope);
    const isCurrent = () => (
      !cancel
      && didInitRef.current === requestCacheKey
      && getAuthGeneration() === requestAuthGeneration
    );
    (async () => {
      try {
        const [fav, pls, hist, albums, savedPls] = await Promise.all([
          api.favorites().catch(() => null),
          api.playlists().catch(() => null),
          api.history().catch(() => null),
          api.savedAlbums().catch(() => null),
          api.savedPlaylists().catch(() => null),
        ]);
        if (!isCurrent()) return;
        const store = useLibraryStore.getState();
        const pending = loadPendingFavs(globalThis.localStorage, requestScope);
        // Incluir intenciones posteriores al inicio de esta petición: el
        // response puede representar el estado remoto anterior al toggle.
        const recentIntents = loadFavoriteIntents(requestScope, requestIntentVersion);
        if (fav !== null) {
          // El backend confirma la cuenta, pero la outbox y la última intención
          // local conservan operaciones que todavía no aparecen en la respuesta.
          store.setFavs(mergeFavoriteIds(mergeFavoriteIds(fav, pending), recentIntents));
        } else {
          store.setFavs(mergeFavoriteIds(mergeFavoriteIds(store.favs, pending), recentIntents));
        }
        pruneAcknowledgedFavoriteIntents(requestScope, requestIntentVersion);
        if (hist !== null)     store.setRecent(hist.map(h => h.trackId));
        if (savedPls !== null) store.setSavedPlaylists(savedPls);
        if (pls !== null) {
          const withTracks = await Promise.all(pls.map(async p => {
            const ids = await api.playlistTracks(p.id).catch(() => []);
            return { id: p.id, name: p.name, trackIds: ids };
          }));
          if (isCurrent()) store.setPlaylists(withTracks);
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
          if (isCurrent()) store.setSavedAlbums(hydratedAlbums);
        }
        if (!isCurrent()) return;

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
          const finalFavs = libraryState.favs || [];
          const recentIds = hist !== null ? hist.map(h => h.trackId) : (libraryState.recent || []);
          const currentPls = libraryState.playlists;
          const currentAlbums = libraryState.savedAlbums;
          const finalSavedPlaylists = libraryState.savedPlaylists;
          const allIds = new Set([...finalFavs, ...recentIds, ...(downloadedIds || [])]);
          currentPls.forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          (savedPls || []).forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
          (currentAlbums || []).forEach(a => (a.trackIds || []).forEach(id => allIds.add(id)));
          const missing = [...allIds].filter(id => id && !trackById(id));
          for (let i = 0; i < missing.length && isCurrent(); i += 300) {
            const metas = await api.getTracks(missing.slice(i, i + 300)).catch(() => []);
            if (isCurrent() && metas.length) metas.forEach(normalizeTrack);
          }
          if (isCurrent()) {
            saveMeta();
            const finalPlaylists = useLibraryStore.getState().playlists;
            const finalAlbums = useLibraryStore.getState().savedAlbums;
            writeLibCache(finalFavs, finalPlaylists, finalAlbums, finalSavedPlaylists, recentIds, email);
            // Sincronización silenciosa por cuenta y por pista. Las fallidas
            // permanecen pendientes y se reintentan en el siguiente arranque.
            backfillLibraryLyrics({
              scope: cacheIdentity(email, getToken()),
              favs: finalFavs,
              playlists: finalPlaylists,
              savedAlbums: finalAlbums,
              savedPlaylists: finalSavedPlaylists,
              downloadedIds: downloadedIds || [],
            });
          }
        }
      } catch { /* silent — offline o backend caído */ }
    })();
    return () => { cancel = true; };
  }, [authed, email, cacheKey]);

  // ─── 3. Re-persistir cache cuando el store cambia ────────────────
  const favs = useLibraryStore((s) => s.favs);
  const playlists = useLibraryStore((s) => s.playlists);
  const savedAlbums = useLibraryStore((s) => s.savedAlbums);
  const savedPlaylists = useLibraryStore((s) => s.savedPlaylists);
  const recent = useLibraryStore((s) => s.recent);

  useEffect(() => {
    if (!authed || didInitRef.current !== cacheKey) return;
    writeLibCache(favs, playlists, savedAlbums, savedPlaylists, recent, email);
  }, [authed, cacheKey, email, favs, playlists, savedAlbums, savedPlaylists, recent]);
}

export default useLibrarySync;
