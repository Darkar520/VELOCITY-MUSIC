/**
 * Tests del libraryStore — 6 casos mínimos exigidos por el prompt:
 *   toggleFav, createPlaylist, addToPlaylist, removeFromPlaylist,
 *   pushRecent dedupe, saveAlbum toggle.
 *
 * Más casos extra para toggleFav retorno, savePlaylist, reset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLibraryStore } from '../libraryStore.js';

function reset() {
  useLibraryStore.getState().reset();
}

describe('libraryStore', () => {
  beforeEach(reset);

  it('toggleFav agrega y quita, retorna el estado resultante', () => {
    const store = useLibraryStore.getState();
    expect(store.toggleFav('t1')).toBe(true);
    expect(useLibraryStore.getState().favs).toEqual(['t1']);
    expect(store.toggleFav('t1')).toBe(false);
    expect(useLibraryStore.getState().favs).toEqual([]);
  });

  it('toggleFav mantiene el fav al frente si se agrega uno nuevo', () => {
    const store = useLibraryStore.getState();
    store.toggleFav('a');
    store.toggleFav('b');
    store.toggleFav('c');
    expect(useLibraryStore.getState().favs).toEqual(['c', 'b', 'a']);
  });

  it('createPlaylistLocal agrega playlist con trackIds vacío', () => {
    useLibraryStore.getState().createPlaylistLocal('p1', 'Mi playlist');
    const pl = useLibraryStore.getState().playlists;
    expect(pl).toHaveLength(1);
    expect(pl[0]).toEqual({ id: 'p1', name: 'Mi playlist', trackIds: [] });
  });

  it('addToPlaylist agrega trackId sin duplicar', () => {
    const store = useLibraryStore.getState();
    store.createPlaylistLocal('p1', 'Favs');
    store.addToPlaylist('p1', 't1');
    store.addToPlaylist('p1', 't1'); // duplicado — no debe repetir
    store.addToPlaylist('p1', 't2');
    const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'p1');
    expect(pl.trackIds).toEqual(['t1', 't2']);
  });

  it('removeFromPlaylist quita solo el trackId indicado', () => {
    const store = useLibraryStore.getState();
    store.createPlaylistLocal('p1', 'Favs');
    store.addToPlaylist('p1', 't1');
    store.addToPlaylist('p1', 't2');
    store.addToPlaylist('p1', 't3');
    store.removeFromPlaylist('p1', 't2');
    const pl = useLibraryStore.getState().playlists.find((p) => p.id === 'p1');
    expect(pl.trackIds).toEqual(['t1', 't3']);
  });

  it('pushRecent dedupe y mantiene máximo 50 entradas', () => {
    const store = useLibraryStore.getState();
    store.pushRecent('a');
    store.pushRecent('b');
    store.pushRecent('a'); // ya existe — debe mover al frente, no duplicar
    expect(useLibraryStore.getState().recent).toEqual(['a', 'b']);
    // Llenar más de 50
    for (let i = 0; i < 60; i++) store.pushRecent(`id${i}`);
    expect(useLibraryStore.getState().recent).toHaveLength(50);
    // El último pusheado debe estar primero
    expect(useLibraryStore.getState().recent[0]).toBe('id59');
  });

  it('saveAlbum agrega sin duplicar y unsaveAlbum quita', () => {
    const store = useLibraryStore.getState();
    const album = { id: 'al1', name: 'Album X' };
    store.saveAlbum(album);
    store.saveAlbum(album); // duplicado — no debe repetir
    expect(useLibraryStore.getState().savedAlbums).toHaveLength(1);
    expect(store.isAlbumSaved('al1')).toBe(true);
    store.unsaveAlbum('al1');
    expect(useLibraryStore.getState().savedAlbums).toHaveLength(0);
    expect(store.isAlbumSaved('al1')).toBe(false);
  });

  it('savePlaylist / unsavePlaylist / isPlaylistSaved funcionan por playlistId', () => {
    const store = useLibraryStore.getState();
    const mix = { playlistId: 'mix1', name: 'Mix X' };
    store.savePlaylist(mix);
    store.savePlaylist(mix); // duplicado
    expect(useLibraryStore.getState().savedPlaylists).toHaveLength(1);
    expect(store.isPlaylistSaved('mix1')).toBe(true);
    expect(store.isPlaylistSaved('mix2')).toBe(false);
    store.unsavePlaylist('mix1');
    expect(store.isPlaylistSaved('mix1')).toBe(false);
  });

  it('reset limpia todo el estado de library', () => {
    const store = useLibraryStore.getState();
    store.toggleFav('a');
    store.createPlaylistLocal('p1', 'X');
    store.pushRecent('r1');
    store.saveAlbum({ id: 'al1' });
    store.setHomeRows([{ section: 's1' }]);
    store.setHomeLoading(true);
    store.bumpFeedNonce();
    store.reset();
    const s = useLibraryStore.getState();
    expect(s.favs).toEqual([]);
    expect(s.playlists).toEqual([]);
    expect(s.recent).toEqual([]);
    expect(s.savedAlbums).toEqual([]);
    expect(s.homeRows).toEqual([]);
    expect(s.homeLoading).toBe(false);
    expect(s.feedNonce).toBe(0);
  });

  it('bumpFeedNonce y bumpCatVer incrementan de a 1', () => {
    const store = useLibraryStore.getState();
    expect(useLibraryStore.getState().feedNonce).toBe(0);
    store.bumpFeedNonce();
    store.bumpFeedNonce();
    expect(useLibraryStore.getState().feedNonce).toBe(2);
    store.bumpCatVer();
    expect(useLibraryStore.getState().catVer).toBe(1);
  });
});
