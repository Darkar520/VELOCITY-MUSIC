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
 *   const { toggleFav, createPlaylist, ... } = useLibraryActions({ authed, email, showToast });
 */
import { useEffect, useRef, useCallback } from 'react';
import { api, getToken, getAuthGeneration } from '../api.js';
import { trackById } from '../catalog.js';
import { slimTrack } from '../helpers.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { scheduleLibraryOfflineSync } from '../offlineLibrary.js';
import {
  loadPendingFavs,
  savePendingFavs,
  cacheIdentity,
  noteFavoriteIntent,
  acknowledgeFavoriteIntent,
} from '../favoriteOutbox.js';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * @param {{ authed?: boolean, email?: string, showToast?: function }} opts
 * Al añadir a biblioteca: solo letra offline (ligero). Audio = botón Descargar.
 */
export function useLibraryActions({ authed, email = '', showToast } = {}) {
  const pendingScope = authed ? cacheIdentity(email, getToken()) : '';
  const pendingAuthGeneration = getAuthGeneration();
  const scopeStateRef = useRef(null);
  if (!scopeStateRef.current
    || scopeStateRef.current.scope !== pendingScope
    || scopeStateRef.current.authGeneration !== pendingAuthGeneration) {
    const previous = scopeStateRef.current;
    previous?.timers.forEach((timer) => clearTimeout(timer));
    scopeStateRef.current = {
      scope: pendingScope,
      authGeneration: pendingAuthGeneration,
      pending: loadPendingFavs(globalThis.localStorage, pendingScope),
      workers: new Map(),
      timers: new Map(),
      attempts: new Map(),
    };
  }

  const isCurrentScope = useCallback((state) => (
    scopeStateRef.current === state && state.authGeneration === getAuthGeneration()
  ), []);
  const persistPendingFavs = useCallback((state) => {
    savePendingFavs(state.pending, globalThis.localStorage, state.scope);
  }, []);

  const runFavoriteIntent = useCallback(async (state, id, op) => {
    if (!isCurrentScope(state)) return false;
    if (op === 'add') {
      const tk = trackById(id);
      if (!tk) throw new Error(`No hay metadatos para ${id}`);
      // El backend valida existencia: completar metadatos es parte del add.
      await api.saveTracks([slimTrack(tk)], { throwOnError: true });
      // No permitimos que una respuesta de la cuenta anterior continúe con
      // addFavorite después de que cambió la identidad activa.
      if (!isCurrentScope(state)) return false;
      await api.addFavorite(id);
    } else {
      await api.removeFavorite(id);
    }
    return isCurrentScope(state);
  }, [isCurrentScope]);

  const queueFavorite = useCallback((id) => {
    if (!id) return Promise.resolve();
    const state = scopeStateRef.current;
    const previous = state.workers.get(id) || Promise.resolve();
    const worker = previous.catch(() => {}).then(async () => {
      while (isCurrentScope(state) && state.pending.has(id)) {
        const op = state.pending.get(id);
        try {
          const completed = await runFavoriteIntent(state, id, op);
          if (!completed || !isCurrentScope(state)) return;
          if (state.pending.get(id) === op) {
            state.pending.delete(id);
            state.attempts.delete(id);
            acknowledgeFavoriteIntent(state.scope, id, op);
            persistPendingFavs(state);
          }
        } catch (error) {
          if (!isCurrentScope(state)) return;
          const attempt = (state.attempts.get(id) || 0) + 1;
          state.attempts.set(id, attempt);
          // No revert: la outbox y la caché local son la garantía de durabilidad.
          if (navigator.onLine !== false && error?.status !== 401 && error?.status !== 400 && !state.timers.has(id)) {
            const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.min(attempt - 1, 5)));
            const timer = setTimeout(() => {
              state.timers.delete(id);
              if (isCurrentScope(state)) queueFavorite(id);
            }, delay);
            state.timers.set(id, timer);
          }
          return;
        }
      }
    });
    state.workers.set(id, worker);
    worker.then(() => {
      if (state.workers.get(id) === worker) state.workers.delete(id);
    }, () => {
      if (state.workers.get(id) === worker) state.workers.delete(id);
    });
    return worker;
  }, [isCurrentScope, persistPendingFavs, runFavoriteIntent]);

  const flushPendingFavs = useCallback(async () => {
    const state = scopeStateRef.current;
    const ids = [...state.pending.keys()];
    await Promise.all(ids.map((id) => queueFavorite(id)));
  }, [queueFavorite]);

  // Limpiar temporizadores cuando el hook deja de existir.
  useEffect(() => () => {
    scopeStateRef.current?.timers.forEach((timer) => clearTimeout(timer));
    scopeStateRef.current?.timers.clear();
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
    if (!id) return;
    const state = scopeStateRef.current;
    const store = useLibraryStore.getState();
    const has = store.favs.includes(id);
    const op = has ? 'remove' : 'add';

    // Optimista y durable: la caché/outbox se actualizan antes de cualquier red.
    store.toggleFav(id);
    // Registrar también la última intención fuera de la outbox: una respuesta
    // remota iniciada antes de este toggle no puede sobrescribir el estado local.
    noteFavoriteIntent(state.scope, id, op);
    state.pending.set(id, op);
    persistPendingFavs(state);
    if (op === 'add') {
      // Me gusta → offline (letra + audio). Quitar like no borra descargas.
      offlinePack([id]);
    }
    await queueFavorite(id);
    if (isCurrentScope(state) && state.pending.has(id)) {
      showToast?.('Se sincronizará Me gusta cuando el servidor responda');
    }
  }, [isCurrentScope, persistPendingFavs, queueFavorite, showToast, offlinePack]);

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
      // No revertir el guardado local: un timeout/429/5xx hacía desaparecer
      // el álbum recién guardado ("a veces los álbumes no aparecen").
      // Mismo criterio que savePlaylist: se conserva local y se reintenta.
      setTimeout(() => api.saveAlbum(album).catch(() => {}), 2000);
      showToast?.('Guardado localmente · se sincronizará después');
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
