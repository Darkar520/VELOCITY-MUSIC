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

const PENDING_FAVS_KEY = 'velocity.pendingFavs';

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

  const toggleFav = useCallback(async (id) => {
    const store = useLibraryStore.getState();
    const has = store.favs.includes(id);
    // Optimistic update via store wrapper
    store.toggleFav(id);
    if (!has) { const tk = trackById(id); if (tk) api.saveTracks([slimTrack(tk)]).catch(() => {}); }
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
  }, [showToast]);

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
    try { await api.addToPlaylist(pid, tid); }
    catch { showToast?.('No se pudo añadir'); }
  }, [showToast]);

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

  return {
    toggleFav,
    createPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    deletePlaylist,
    flushPendingFavs,
  };
}

export default useLibraryActions;
