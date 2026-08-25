import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  favorites: vi.fn(), playlists: vi.fn(), history: vi.fn(), savedAlbums: vi.fn(), savedPlaylists: vi.fn(),
  playlistTracks: vi.fn(), album: vi.fn(), getTracks: vi.fn(), saveTracks: vi.fn(),
  getToken: vi.fn(() => ''), getAuthGeneration: vi.fn(() => 0),
}));
vi.mock('../api.js', () => ({ api, getToken: api.getToken, getAuthGeneration: api.getAuthGeneration }));
vi.mock('../catalog.js', () => ({
  allCached: vi.fn(() => []), saveMeta: vi.fn(), trackById: vi.fn(() => null),
  normalizeTrack: vi.fn(), cacheTrack: vi.fn(),
}));
vi.mock('../helpers.js', () => ({ slimTrack: vi.fn((track) => track) }));
vi.mock('../offlineLibrary.js', () => ({ backfillLibraryLyrics: vi.fn() }));
vi.mock('../offline.js', () => ({ listIds: vi.fn(async () => []), listMetas: vi.fn(async () => []) }));

const { useLibrarySync } = await import('../hooks/useLibrarySync.js');
const { useLibraryStore } = await import('../store/libraryStore.js');
const offlineDb = await import('../offline.js');
const catalog = await import('../catalog.js');

beforeEach(() => {
  useLibraryStore.getState().reset();
  localStorage.clear();
  vi.clearAllMocks();
  api.favorites.mockResolvedValue([]);
  api.playlists.mockResolvedValue([]);
  api.history.mockResolvedValue([]);
  api.savedAlbums.mockResolvedValue([]);
  api.savedPlaylists.mockResolvedValue([]);
  api.playlistTracks.mockResolvedValue([]);
  api.album.mockResolvedValue({ tracks: [] });
  api.getTracks.mockResolvedValue([]);
  api.saveTracks.mockResolvedValue({});
  api.getToken.mockReturnValue('');
  api.getAuthGeneration.mockReturnValue(0);
  // Aislamiento: restaurar las implementaciones del módulo offline y del
  // catálogo (clearAllMocks borra llamadas, no implementaciones previas).
  offlineDb.listIds.mockResolvedValue([]);
  offlineDb.listMetas.mockResolvedValue([]);
  catalog.trackById.mockReturnValue(null);
});

afterEach(() => cleanup());

describe('useLibrarySync account isolation', () => {
  it('clears shared library state when authentication is lost', () => {
    useLibraryStore.setState({
      favs: ['account-a'],
      playlists: [{ id: 'p1', trackIds: ['account-a'] }],
      recent: ['account-a'],
      savedAlbums: [{ albumId: 'al1' }],
      savedPlaylists: [{ playlistId: 'mix-a' }],
    });

    renderHook(() => useLibrarySync({ authed: false, email: 'a@example.com' }));

    expect(useLibraryStore.getState()).toMatchObject({
      favs: [], playlists: [], recent: [], savedAlbums: [], savedPlaylists: [],
    });
  });

  it('resets the previous account before hydrating a new account', async () => {
    api.favorites.mockResolvedValue(null);
    localStorage.setItem('velocity.lib.b@example.com', JSON.stringify({ favs: ['account-b'] }));
    const { rerender } = renderHook(({ authed, email }) => useLibrarySync({ authed, email }), {
      initialProps: { authed: true, email: 'a@example.com' },
    });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    act(() => { useLibraryStore.getState().setFavs(['account-a']); });
    await act(async () => { rerender({ authed: false, email: 'a@example.com' }); });
    await waitFor(() => expect(useLibraryStore.getState().favs).toEqual([]));
    await act(async () => { rerender({ authed: true, email: 'b@example.com' }); });
    await waitFor(() => expect(useLibraryStore.getState().favs).toEqual(['account-b']));

    expect(useLibraryStore.getState().favs).toEqual(['account-b']);
      });

      it('offline: hidrata desde la caché local sin llamar a la red y conserva la biblioteca', async () => {
        const cached = {
          favs: ['offline-1', 'offline-2'],
          playlists: [{ id: 'p-off', name: 'Offline PL', trackIds: ['offline-1'] }],
          savedAlbums: [{ albumId: 'al-off', name: 'Album Off', trackIds: [] }],
          savedPlaylists: [{ playlistId: 'sp-off', name: 'Guardada Off', trackIds: [] }],
          recent: ['offline-1'],
          tracks: [{ id: 'offline-1', title: 'T1', artist: 'A1', cover: 'https://cdn/x.jpg' }],
        };
        localStorage.setItem('velocity.lib.a@example.com', JSON.stringify(cached));

        renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com', offline: true }));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        const s = useLibraryStore.getState();
        expect(s.favs).toEqual(['offline-1', 'offline-2']);
        expect(s.playlists).toHaveLength(1);
        expect(s.savedAlbums).toHaveLength(1);
        expect(s.savedPlaylists).toHaveLength(1);
        // Sin red: ningún fetch a la API.
        expect(api.favorites).not.toHaveBeenCalled();
        expect(api.playlists).not.toHaveBeenCalled();
        expect(api.history).not.toHaveBeenCalled();
        expect(api.savedAlbums).not.toHaveBeenCalled();
        expect(api.savedPlaylists).not.toHaveBeenCalled();
      });
    });

describe('useLibrarySync: el módulo offline no queda sombreado por el parámetro', () => {
  it('offline: incorpora los metadatos de las descargas al catálogo', async () => {
    // Regresión: el parámetro booleano `offline` sombreaba el import del
    // módulo offline.js, así que `offline.listIds()` lanzaba TypeError y el
    // catch global se lo tragaba. Las descargas nunca llegaban al catálogo.
    const { cacheTrack, saveMeta } = catalog;
    offlineDb.listMetas.mockResolvedValue([{ id: 'dl-1', title: 'Descargada', artist: 'A' }]);

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com', offline: true }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(offlineDb.listMetas).toHaveBeenCalled();
    // forEach pasa (item, index, array): comprobamos el primer argumento.
    expect(cacheTrack.mock.calls[0][0]).toEqual({ id: 'dl-1', title: 'Descargada', artist: 'A' });
    expect(saveMeta).toHaveBeenCalled();
  });

  it('online: completa el backfill de metadatos y persiste el catálogo', async () => {
    // Regresión: el TypeError abortaba todo lo que venía después, incluidos
    // api.getTracks (backfill), saveMeta() y writeLibCache(). Resultado: la
    // caché local se quedaba sin metadatos y offline no se veía nada.
    const { saveMeta } = catalog;
    api.favorites.mockResolvedValue(['fav-1']);
    api.getTracks.mockResolvedValue([{ id: 'fav-1', title: 'Favorita', artist: 'A' }]);

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));

    await waitFor(() => expect(saveMeta).toHaveBeenCalled());
    expect(offlineDb.listMetas).toHaveBeenCalled();
    // El backfill pidió los metadatos que faltaban en el catálogo.
    expect(api.getTracks).toHaveBeenCalledWith(expect.arrayContaining(['fav-1']));
    // Y la biblioteca quedó persistida para el siguiente arranque offline.
    await waitFor(() => {
      const raw = localStorage.getItem('velocity.lib.a@example.com');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw).favs).toEqual(['fav-1']);
    });
  });

  it('un fallo de playlistTracks no vacía los trackIds ya conocidos', async () => {
    // Regresión: `catch(() => [])` colapsaba "fallo de red" y "playlist vacía",
    // así que un timeout puntual vaciaba la playlist y el efecto de
    // persistencia grababa el vacío de forma permanente.
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      playlists: [{ id: 'p1', name: 'Mi PL', trackIds: ['t1', 't2'] }],
    }));
    api.playlists.mockResolvedValue([{ id: 'p1', name: 'Mi PL' }]);
    api.playlistTracks.mockRejectedValue(new Error('timeout'));

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    await waitFor(() => {
      const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'p1');
      expect(pl?.trackIds).toEqual(['t1', 't2']);
    });
  });

  it('una playlist realmente vacía sí se refleja como vacía', async () => {
    localStorage.setItem('velocity.lib.a@example.com', JSON.stringify({
      playlists: [{ id: 'p1', name: 'Mi PL', trackIds: ['t1'] }],
    }));
    api.playlists.mockResolvedValue([{ id: 'p1', name: 'Mi PL' }]);
    api.playlistTracks.mockResolvedValue([]);

    renderHook(() => useLibrarySync({ authed: true, email: 'a@example.com' }));

    await waitFor(() => {
      const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'p1');
      expect(pl?.trackIds).toEqual([]);
    });
  });
});
