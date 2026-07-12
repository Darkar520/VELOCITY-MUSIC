/**
 * useLibraryStoreBindings — App usa libraryStore sin mirrors useState.
 */
import { useCallback, useEffect } from 'react';
import { useLibraryStore } from '../store/libraryStore.js';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

export function useLibraryStoreBindings() {
  const favs = useLibraryStore((s) => s.favs);
  const playlists = useLibraryStore((s) => s.playlists);
  const recent = useLibraryStore((s) => s.recent);
  const savedAlbums = useLibraryStore((s) => s.savedAlbums);
  const savedPlaylists = useLibraryStore((s) => s.savedPlaylists);
  const homeRows = useLibraryStore((s) => s.homeRows);
  const homeLoading = useLibraryStore((s) => s.homeLoading);
  const catVer = useLibraryStore((s) => s.catVer);

  const setFavs = useCallback((v) => {
    useLibraryStore.getState().setFavs(typeof v === 'function' ? v(useLibraryStore.getState().favs) : asArray(v));
  }, []);
  const setPlaylists = useCallback((v) => {
    useLibraryStore.getState().setPlaylists(typeof v === 'function' ? v(useLibraryStore.getState().playlists) : asArray(v));
  }, []);
  const setRecent = useCallback((v) => {
    useLibraryStore.getState().setRecent(typeof v === 'function' ? v(useLibraryStore.getState().recent) : asArray(v));
  }, []);
  const setSavedAlbums = useCallback((v) => {
    useLibraryStore.getState().setSavedAlbums(typeof v === 'function' ? v(useLibraryStore.getState().savedAlbums) : asArray(v));
  }, []);
  const setSavedPlaylists = useCallback((v) => {
    useLibraryStore.getState().setSavedPlaylists(typeof v === 'function' ? v(useLibraryStore.getState().savedPlaylists) : asArray(v));
  }, []);
  const setHomeRows = useCallback((v) => {
    useLibraryStore.getState().setHomeRows(typeof v === 'function' ? v(useLibraryStore.getState().homeRows) : asArray(v));
  }, []);
  const setCatVer = useCallback((v) => {
    if (typeof v === 'function') {
      useLibraryStore.setState((s) => ({ catVer: v(s.catVer) }));
    } else {
      useLibraryStore.setState({ catVer: Number(v) || 0 });
    }
  }, []);

  // Persist homeRows → localStorage; seed from cache once.
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('velocity.home') || 'null');
      if (Array.isArray(cached) && cached.length && !useLibraryStore.getState().homeRows.length) {
        useLibraryStore.getState().setHomeRows(cached);
      }
    } catch { /* ignore */ }
    return useLibraryStore.subscribe((s, prev) => {
      if (s.homeRows !== prev?.homeRows) {
        try { localStorage.setItem('velocity.home', JSON.stringify(s.homeRows || [])); } catch { /* ignore */ }
      }
    });
  }, []);

  return {
    favs, setFavs,
    playlists, setPlaylists,
    recent, setRecent,
    savedAlbums, setSavedAlbums,
    savedPlaylists, setSavedPlaylists,
    homeRows, homeLoading, setHomeRows,
    catVer, setCatVer,
  };
}

export default useLibraryStoreBindings;
