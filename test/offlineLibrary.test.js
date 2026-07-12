/**
 * Política offline de biblioteca.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// api.js toca localStorage al importar; shim mínimo para Node.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

const { isTrackInLibrary } = await import('../frontend/src/offlineLibrary.js');

test('isTrackInLibrary: Me gusta', () => {
  assert.equal(isTrackInLibrary('a', { favs: ['a'], playlists: [], savedPlaylists: [] }), true);
  assert.equal(isTrackInLibrary('b', { favs: ['a'], playlists: [], savedPlaylists: [] }), false);
});

test('isTrackInLibrary: playlist propia', () => {
  assert.equal(
    isTrackInLibrary('t2', {
      favs: [],
      playlists: [{ id: 'p1', trackIds: ['t1', 't2'] }],
      savedPlaylists: [],
    }),
    true,
  );
});

test('isTrackInLibrary: mezcla guardada', () => {
  assert.equal(
    isTrackInLibrary('m1', {
      favs: [],
      playlists: [],
      savedPlaylists: [{ playlistId: 'mix:x', trackIds: ['m1', 'm2'] }],
    }),
    true,
  );
});

test('isTrackInLibrary: null / fuera de biblioteca', () => {
  assert.equal(isTrackInLibrary(null, { favs: ['a'] }), false);
  assert.equal(
    isTrackInLibrary('solo-play', {
      favs: [],
      playlists: [],
      savedPlaylists: [],
    }),
    false,
  );
});
