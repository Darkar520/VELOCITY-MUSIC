/**
 * libraryStore — single source of truth para el dominio LIBRARY.
 *
 * Patrón idéntico a playerStore.js ( commits 3c20873..50d25f1 ):
 *   - Zustand create()
 *   - Selectores finos exportados (cero re-renders innecesarios)
 *   - Acciones atómicas que mutan solo state (sin DOM, sin fetch)
 *   - El adapter de red (api.*) sigue en App.jsx / useLibrarySync
 *
 * Estado que NO vive acá:
 *   - Catálogo de tracks → catalog.js (privado, _catalog Map)
 *   - trackById, cacheTrack → catalog.js
 *   - playStats → App.jsx ref (estaba bien ahí)
 *   - recentSearches → App.jsx (es UI de búsqueda, no library)
 *
 * Acciones asíncronas (api.addFavorite, api.createPlaylist, etc.) NO están acá.
 * El store solo muta state optimistamente. La persistencia la dispara useLibrarySync
 * vía suscripción a cambios, o App.jsx llama al store + api en paralelo.
 */
import { create } from 'zustand';

// ─── Selectores finos ──────────────────────────────────────────────
export const useFavs = () => (s) => s.favs;
export const usePlaylists = () => (s) => s.playlists;
export const useRecent = () => (s) => s.recent;
export const useSavedAlbums = () => (s) => s.savedAlbums;
export const useSavedPlaylists = () => (s) => s.savedPlaylists;
export const useHomeRows = () => (s) => s.homeRows;
export const useHomeLoading = () => (s) => s.homeLoading;
export const useFeedNonce = () => (s) => s.feedNonce;

export const useLibraryStore = create((set, get) => ({
  // ─── Estado ──────────────────────────────────────────────────
  favs: [],
  playlists: [],
  recent: [],
  savedAlbums: [],
  savedPlaylists: [],
  homeRows: [],
  homeLoading: false,
  feedNonce: 0,
  catVer: 0,

  // ─── Setters directos (para hidratación desde backend/cache) ──
  setFavs: (favs) => set({ favs: Array.isArray(favs) ? favs : [] }),
  setPlaylists: (playlists) => set({ playlists: Array.isArray(playlists) ? playlists : [] }),
  setRecent: (recent) => set({ recent: Array.isArray(recent) ? recent : [] }),
  setSavedAlbums: (albums) => set({ savedAlbums: Array.isArray(albums) ? albums : [] }),
  setSavedPlaylists: (playlists) => set({ savedPlaylists: Array.isArray(playlists) ? playlists : [] }),
  setHomeRows: (rows) => set({ homeRows: Array.isArray(rows) ? rows : [] }),
  setHomeLoading: (b) => set({ homeLoading: !!b }),
  setFeedNonce: (n) => set({ feedNonce: Number(n) || 0 }),
  bumpFeedNonce: () => set((s) => ({ feedNonce: s.feedNonce + 1 })),
  bumpCatVer: () => set((s) => ({ catVer: s.catVer + 1 })),

  // ─── Favs ────────────────────────────────────────────────────
  /** Alterna fav optimistamente. Retorna true si quedó faveado, false si se quitó. */
  toggleFav: (trackId) => {
    if (!trackId) return false;
    const has = get().favs.includes(trackId);
    set((s) => ({
      favs: has ? s.favs.filter((x) => x !== trackId) : [trackId, ...s.favs],
    }));
    return !has;
  },

  /** Agrega un fav sin duplicar. No revierte si ya existía. */
  addFav: (trackId) => {
    if (!trackId) return;
    set((s) => (s.favs.includes(trackId) ? s : { favs: [trackId, ...s.favs] }));
  },

  /** Quita un fav. */
  removeFav: (trackId) => {
    set((s) => ({ favs: s.favs.filter((x) => x !== trackId) }));
  },

  isFav: (trackId) => get().favs.includes(trackId),

  // ─── Playlists ──────────────────────────────────────────────
  /** Crea playlist local. El id lo asigna el backend; App.jsx llama api.createPlaylist
   *  primero y después agrega al store con el id real via addPlaylist. */
  addPlaylist: (playlist) => {
    if (!playlist || !playlist.id) return;
    set((s) => ({
      playlists: [...s.playlists, { id: playlist.id, name: playlist.name || 'Sin nombre', trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds : [] }],
    }));
  },

  createPlaylistLocal: (id, name) => {
    set((s) => ({
      playlists: [...s.playlists, { id, name: name || 'Sin nombre', trackIds: [] }],
    }));
  },

  deletePlaylist: (playlistId) => {
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== playlistId) }));
  },

  addToPlaylist: (playlistId, trackId) => {
    if (!playlistId || !trackId) return;
    set((s) => ({
      playlists: s.playlists.map((pl) =>
        pl.id === playlistId && !pl.trackIds.includes(trackId)
          ? { ...pl, trackIds: [...pl.trackIds, trackId] }
          : pl
      ),
    }));
  },

  removeFromPlaylist: (playlistId, trackId) => {
    set((s) => ({
      playlists: s.playlists.map((pl) =>
        pl.id === playlistId
          ? { ...pl, trackIds: pl.trackIds.filter((x) => x !== trackId) }
          : pl
      ),
    }));
  },

  // ─── Recent (historial de reproducción) ─────────────────────
  /** Agrega trackId al frente del historial, dedupe, máx 200. */
  pushRecent: (trackId) => {
    if (!trackId) return;
    set((s) => ({
      recent: [trackId, ...s.recent.filter((x) => x !== trackId)].slice(0, 200),
    }));
  },

  // ─── Saved albums ───────────────────────────────────────────
  saveAlbum: (album) => {
    if (!album || !album.albumId) return;
    set((s) => (s.savedAlbums.some((a) => a.albumId === album.albumId) ? s : { savedAlbums: [...s.savedAlbums, album] }));
  },

  unsaveAlbum: (albumId) => {
    set((s) => ({ savedAlbums: s.savedAlbums.filter((a) => a.albumId !== albumId) }));
  },

  isAlbumSaved: (albumId) => get().savedAlbums.some((a) => a.albumId === albumId),

  // ─── Saved playlists (mixes guardados) ─────────────────────
  savePlaylist: (playlist) => {
    if (!playlist || !playlist.playlistId) return;
    set((s) => (s.savedPlaylists.some((p) => p.playlistId === playlist.playlistId) ? s : { savedPlaylists: [...s.savedPlaylists, playlist] }));
  },

  unsavePlaylist: (playlistId) => {
    set((s) => ({ savedPlaylists: s.savedPlaylists.filter((p) => p.playlistId !== playlistId) }));
  },

  isPlaylistSaved: (playlistId) => get().savedPlaylists.some((p) => p.playlistId === playlistId),

  // ─── Reset (para logout / cambio de cuenta) ────────────────
  reset: () => set({
    favs: [],
    playlists: [],
    recent: [],
    savedAlbums: [],
    savedPlaylists: [],
    homeRows: [],
    homeLoading: false,
    feedNonce: 0,
    catVer: 0,
  }),
}));

export default useLibraryStore;
