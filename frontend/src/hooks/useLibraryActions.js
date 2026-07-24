/**
 * useLibraryActions — acciones asíncronas de biblioteca (fav, playlist, search).
 *
 * Responsabilidades:
 *   1. toggleFav con actualización optimista + cola offline (pendingFavs).
 *   2. createPlaylist / addToPlaylist / removeFromPlaylist / deletePlaylist.
 *   3. addSearch / removeSearch (búsquedas recientes).
 *   4. flushPendingFavs al recuperar conexión o al iniciar sesión.
 *
 * El store solo muta state; este hook orquesta store + api + persistencia.
 *
 * Uso:
 *   const { toggleFav, createPlaylist, ... } = useLibraryActions({ authed, showToast });
 */
import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { trackById } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { scheduleLibraryOfflineSync } from '../offlineLibrary.js';

const PENDING_FAVS_KEY = 'velocity.pendingFavs';

/**
 * @param {{ authed?: boolean, showToast?: function }} opts
 * Al añadir a biblioteca: solo letra offline (ligero). Audio = botón Descargar.
 */
export function useLibraryActions({ authed, showToast } = {}) {
  const pendingFavsRef = useRef(null);
  if (!pendingFavsRef.current) {
    pendingFavsRef.current = new Map(); // id → 'add' | 'remove'
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_FAVS_KEY) || '[]');
      saved.forEach(([id, op]) => pendingFavsRef.current.set(id, op));
    } catch {}
  }

  const savePendingFavs = () => {
    try {
      localStorage.setItem(PENDING_FAVS_KEY, JSON.stringify([...pendingFavsRef.current.entries()]));
    } catch {}
  };

  const flushPendingFavs = useCallback(async () => {
    if (!pendingFavsRef.current.size) return;
    const entries = [...pendingFavsRef.current.entries()];
    for (const [id, op] of entries) {
      try {
        if (op === 'add') await api.addFavorite(id);
        else await api.removeFavorite(id);
        pendingFavsRef.current.delete(id);
      } catch { break; }
    }
    savePendingFavs();
  }, []);

  // Sincronizar al recuperar conexión
  useEffect(() => {
    const onOnline = () => { if (authed) flushPendingFavs(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [authed, flushPendingFavs]);

  // Sincronizar al iniciar sesión
  useEffect(() => { if (authed) flushPendingFavs(); }, [authed, flushPendingFavs]);

  const offlinePack = useCallback((ids) => {
    scheduleLibraryOfflineSync(ids);
  }, []);

  const toggleFav = useCallback(async (id) => {
    const store = useLibraryStore.getState();
    const has = store.favs.includes(id);
    // Optimistic update via store wrapper
    store.toggleFav(id);
    if (!has) {
      const tk = trackById(id);
      if (tk) api.saveTracks([slimTrack(tk)]).catch(() => {});
      // Me gusta → offline (letra + audio). Quitar like no borra descargas.
      offlinePack([id]);
    }
    try {
      has ? await api.removeFavorite(id) : await api.addFavorite(id);
      pendingFavsRef.current.delete(id);
      savePendingFavs();
    } catch {
      pendingFavsRef.current.set(id, has ? 'remove' : 'add');
      savePendingFavs();
      if (navigator.onLine) {
        // Revertir solo con red
        store.toggleFav(id);
        showToast?.('No se pudo actualizar Me gusta');
      }
    }
  }, [showToast, offlinePack]);

  const createPlaylist = useCallback(async (name) => {
    const store = useLibraryStore.getState();
    try {
      const id = await api.createPlaylist(name);
      store.createPlaylistLocal(id, name);
      return id;
    } catch {
      showToast?.('No se pudo crear la playlist');
      return null;
    }
  }, [showToast]);

  const addToPlaylist = useCallback(async (pid, tid) => {
    const store = useLibraryStore.getState();
    store.addToPlaylist(pid, tid);
    const tk = trackById(tid);
    if (tk) api.saveTracks([slimTrack(tk)]).catch(() => {});
    offlinePack([tid]);
    try { await api.addToPlaylist(pid, tid); }
    catch { showToast?.('No se pudo añadir'); }
  }, [showToast, offlinePack]);

  const removeFromPlaylist = useCallback(async (pid, tid) => {
    const store = useLibraryStore.getState();
    store.removeFromPlaylist(pid, tid);
    try { await api.removeFromPlaylist(pid, tid); }
    catch { showToast?.('No se pudo quitar'); }
  }, [showToast]);

  const deletePlaylist = useCallback(async (pid) => {
    const store = useLibraryStore.getState();
    store.deletePlaylist(pid);
    try { await api.deletePlaylist(pid); }
    catch { showToast?.('No se pudo eliminar'); }
  }, [showToast]);

  // ─── Álbumes guardados ──────────────────────────────────────────
  const isAlbumSaved = useCallback((albumId) => {
    return useLibraryStore.getState().savedAlbums.some(a => a.albumId === albumId);
  }, []);

  // `trackIds` es opcional (best-effort): cuando el caller lo tiene a mano
  // (p.ej. DetailView ya cargó las canciones del álbum), se usa para
  // precargar letras offline sin bloquear el guardado del álbum en sí.
  const saveAlbum = useCallback(async (album, trackIds) => {
    if (!album || !album.albumId) return;
    const store = useLibraryStore.getState();
    if (store.savedAlbums.some(a => a.albumId === album.albumId)) return;
    const entry = {
      ...album,
      ...(trackIds?.length ? { trackIds: [...new Set(trackIds.filter(Boolean))] } : {}),
      savedAt: Date.now(),
    };
    store.saveAlbum(entry);
    if (trackIds?.length) offlinePack(trackIds);
    try { await api.saveAlbum(album); showToast?.('Álbum guardado en tu biblioteca'); }
    catch {
      store.unsaveAlbum(album.albumId);
      showToast?.('No se pudo guardar el álbum');
    }
  }, [showToast, offlinePack]);

  const unsaveAlbum = useCallback(async (albumId) => {
    const store = useLibraryStore.getState();
    store.unsaveAlbum(albumId);
    try { await api.unsaveAlbum(albumId); showToast?.('Álbum quitado'); }
    catch {}
  }, [showToast]);

  // ─── Mixes/Playlists guardados ──────────────────────────────────
  const isPlaylistSaved = useCallback((pid) => {
    return useLibraryStore.getState().savedPlaylists.some(p => p.playlistId === pid);
  }, []);

  const savePlaylist = useCallback(async (mix) => {
    if (!mix) return;
    const pid = 'mix:' + (mix.label || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60);
    const store = useLibraryStore.getState();
    if (store.savedPlaylists.some(p => p.playlistId === pid)) {
      showToast?.('Ya está guardado');
      return;
    }
    const rawCover = mix.tracks?.[0]?.cover || '';
    const cover = (typeof rawCover === 'string' && (rawCover.startsWith('data:') || rawCover.startsWith('blob:'))) ? '' : rawCover;
    const entry = { playlistId: pid, name: mix.label || 'Mix', cover, trackIds: (mix.tracks || []).map(t => t.id).filter(Boolean) };
    store.savePlaylist(entry);
    if (mix.tracks?.length) api.saveTracks(mix.tracks.map(slimTrack).filter(Boolean)).catch(() => {});
    // Mezcla guardada → offline de todas sus pistas (letra + audio)
    if (entry.trackIds?.length) offlinePack(entry.trackIds);
    try { await api.savePlaylist(entry); showToast?.('Mix guardado en tu biblioteca'); }
    catch {
      setTimeout(() => api.savePlaylist(entry).catch(() => {}), 2000);
      showToast?.('Guardado localmente · se sincronizará después');
    }
  }, [showToast, offlinePack]);

  const unsavePlaylist = useCallback(async (playlistId) => {
    const store = useLibraryStore.getState();
    store.unsavePlaylist(playlistId);
    try { await api.unsavePlaylist(playlistId); showToast?.('Mix quitado de biblioteca'); }
    catch {}
  }, [showToast]);

  return {
    toggleFav,
    createPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    deletePlaylist,
    flushPendingFavs,
    isAlbumSaved,
    saveAlbum,
    unsaveAlbum,
    isPlaylistSaved,
    savePlaylist,
    unsavePlaylist,
  };
}

export default useLibraryActions;
