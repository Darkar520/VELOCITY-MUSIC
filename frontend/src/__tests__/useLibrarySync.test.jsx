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
