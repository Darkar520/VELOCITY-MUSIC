import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  saveTracks: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn(), getToken: vi.fn(() => ''), getAuthGeneration: vi.fn(() => 0),
  createPlaylist: vi.fn(), addToPlaylist: vi.fn(), removeFromPlaylist: vi.fn(), deletePlaylist: vi.fn(),
  saveAlbum: vi.fn(), unsaveAlbum: vi.fn(),
}));
vi.mock('../api.js', () => ({ api, getToken: api.getToken, getAuthGeneration: api.getAuthGeneration }));
vi.mock('../catalog.js', () => ({ trackById: vi.fn(() => ({ id: 't1', title: 'Song', artist: 'Artist' })) }));
vi.mock('../offlineLibrary.js', () => ({ scheduleLibraryOfflineSync: vi.fn() }));

const { useLibraryActions } = await import('../hooks/useLibraryActions.js');
const { useLibraryStore } = await import('../store/libraryStore.js');

beforeEach(() => {
  useLibraryStore.getState().reset();
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  api.saveTracks.mockResolvedValue({});
  api.getAuthGeneration.mockReturnValue(0);
  api.addFavorite.mockResolvedValue({ favorited: true });
  api.removeFavorite.mockResolvedValue({ favorited: false });
  api.saveAlbum.mockResolvedValue({});
  api.unsaveAlbum.mockResolvedValue({});
});

describe('useLibraryActions saved albums durability', () => {
  const album = { albumId: 'al-1', name: 'Álbum', artist: 'Artista', cover: '' };

  it('conserva el álbum guardado cuando la API falla (no revierte)', async () => {
    // Regresión: un timeout/429/5xx llamaba a unsaveAlbum y el álbum recién
    // guardado desaparecía de la biblioteca.
    api.saveAlbum.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useLibraryActions({ authed: true, email: 'a@example.com' }));

    await act(async () => { await result.current.saveAlbum(album); });

    const saved = useLibraryStore.getState().savedAlbums;
    expect(saved).toHaveLength(1);
    expect(saved[0].albumId).toBe('al-1');
  });

  it('guarda el álbum en el store cuando la API responde bien', async () => {
    const { result } = renderHook(() => useLibraryActions({ authed: true, email: 'a@example.com' }));

    await act(async () => { await result.current.saveAlbum(album); });

    expect(api.saveAlbum).toHaveBeenCalledWith(album);
    expect(useLibraryStore.getState().isAlbumSaved('al-1')).toBe(true);
  });
});

describe('useLibraryActions favorite durability', () => {
  it('waits for metadata before creating the favorite', async () => {
    const order = [];
    api.saveTracks.mockImplementation(async () => { order.push('metadata'); });
    api.addFavorite.mockImplementation(async () => { order.push('favorite'); });
    const { result } = renderHook(() => useLibraryActions({ authed: false }));

    await act(async () => { await result.current.toggleFav('t1'); });

    expect(order).toEqual(['metadata', 'favorite']);
    expect(useLibraryStore.getState().favs).toEqual(['t1']);
    expect(api.saveTracks).toHaveBeenCalledWith(expect.any(Array), { throwOnError: true });
  });

  it('keeps an optimistic like and persists the outbox after a failure', async () => {
    api.saveTracks.mockRejectedValueOnce(new Error('temporary'));
    const { result } = renderHook(() => useLibraryActions({ authed: false }));

    await act(async () => { await result.current.toggleFav('t1'); });

    expect(useLibraryStore.getState().favs).toContain('t1');
    expect(JSON.parse(localStorage.getItem('velocity.pendingFavs'))).toEqual([['t1', 'add']]);
  });

  it('serializes a rapid add/remove and preserves the last intent', async () => {
    let releaseMetadata;
    api.saveTracks.mockImplementation(() => new Promise((resolve) => { releaseMetadata = resolve; }));
    const { result } = renderHook(() => useLibraryActions({ authed: false }));

    let first;
    await act(async () => {
      first = result.current.toggleFav('t1');
      await vi.waitFor(() => expect(api.saveTracks).toHaveBeenCalledTimes(1));
    });
    let second;
    await act(async () => { second = result.current.toggleFav('t1'); });

    expect(useLibraryStore.getState().favs).toEqual([]);
    releaseMetadata({});
    await act(async () => { await Promise.all([first, second]); });

    expect(api.addFavorite).toHaveBeenCalledTimes(1);
    expect(api.removeFavorite).toHaveBeenCalledWith('t1');
    expect(localStorage.getItem('velocity.pendingFavs')).toBe('[]');
  });

  it('stops a worker when the auth token changes before React rerenders', async () => {
    let releaseMetadata;
    api.saveTracks.mockImplementation(() => new Promise((resolve) => { releaseMetadata = resolve; }));
    const { result } = renderHook(() => useLibraryActions({ authed: true, email: 'a@example.com' }));

    let first;
    await act(async () => {
      first = result.current.toggleFav('t1');
      await vi.waitFor(() => expect(api.saveTracks).toHaveBeenCalledTimes(1));
    });
    api.getAuthGeneration.mockReturnValue(1);
    releaseMetadata({});
    await act(async () => { await first; });

    expect(api.addFavorite).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('velocity.pendingFavs.a%40example.com'))).toEqual([['t1', 'add']]);
  });

  it('does not let a stale account worker continue after identity changes', async () => {
    let releaseMetadata;
    api.saveTracks.mockImplementation(() => new Promise((resolve) => { releaseMetadata = resolve; }));
    const { result, rerender } = renderHook(({ email }) => useLibraryActions({ authed: true, email }), {
      initialProps: { email: 'a@example.com' },
    });

    let first;
    await act(async () => {
      first = result.current.toggleFav('t1');
      await vi.waitFor(() => expect(api.saveTracks).toHaveBeenCalledTimes(1));
    });
    rerender({ email: 'b@example.com' });
    releaseMetadata({});
    await act(async () => { await first; });

    expect(api.addFavorite).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('velocity.pendingFavs.a%40example.com'))).toEqual([['t1', 'add']]);
    expect(localStorage.getItem('velocity.pendingFavs.b%40example.com')).toBeNull();
  });
});
