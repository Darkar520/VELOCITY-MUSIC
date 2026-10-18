import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { cacheTrack, trackById, loadPlayerState, normalizeTrack } from '../../catalog.js';
import { usePlayerStore } from '../../store/playerStore.js';
import { usePlayerStoreBindings, hydratePlayerStoreOnce } from '../usePlayerStoreBindings.js';
import { isStreamUrlFresh } from '../../audioContinuity.js';

afterEach(cleanup);

it('restores a fresh signed URL as metadata, without mounting it before the local source is resolved', () => {
  const previous = localStorage.getItem('velocity.player');
  const hydrated = window.__velocityPlayerHydrated;
  const state = usePlayerStore.getState();
  const url = '/api/stream-proxy?artist=Artist&title=Song&id=local-first&exp=9999999999&sig=test';
  expect(isStreamUrlFresh(url)).toBe(true);
  try {
    window.__velocityPlayerHydrated = false;
    localStorage.setItem('velocity.player', JSON.stringify({ track: { id: 'local-first', title: 'Song', artist: 'Artist', url }, t: 42, queue: ['local-first'] }));
    hydratePlayerStoreOnce();
    expect(usePlayerStore.getState()).toMatchObject({ track: { id: 'local-first', url }, time: 42, playing: false, playSrc: null });
  } finally {
    window.__velocityPlayerHydrated = hydrated;
    usePlayerStore.setState(state, true);
    if (previous === null) localStorage.removeItem('velocity.player'); else localStorage.setItem('velocity.player', previous);
  }
});

it('restoring position cannot replace downloaded metadata with an older player snapshot', () => {
  cacheTrack({ id: 'snapshot-metadata', title: 'Title', artist: 'Artist', album: 'xx', durationSeconds: 176, cover: 'data:image/png;base64,aGVsbG8=' });
  const old = localStorage.getItem('velocity.player');
  try {
    localStorage.setItem('velocity.player', JSON.stringify({ track: { id: 'snapshot-metadata', title: 'Title', artist: 'Artist', album: 'Sencillo', url: '/signed-source' }, t: 12, queue: ['snapshot-metadata'] }));
    const restored = loadPlayerState();
    expect(restored.track).toMatchObject({ album: 'Sencillo', url: '/signed-source' });
    expect(restored.t).toBe(12);
    expect(trackById('snapshot-metadata').album).toBe('xx');
    expect(trackById('snapshot-metadata').cover).toBe('data:image/png;base64,aGVsbG8=');
  } finally {
    if (old == null) localStorage.removeItem('velocity.player'); else localStorage.setItem('velocity.player', old);
  }
});

it('normalizing a partial API record retains known metadata before applying display defaults', () => {
  cacheTrack({ id: 'partial-normalization', title: 'Known title', artist: 'Known artist', album: 'Known album' });
  expect(normalizeTrack({ id: 'partial-normalization' })).toMatchObject({ title: 'Known title', artist: 'Known artist', album: 'Known album' });
  // An explicit title that resembles a fallback is still a legitimate value.
  expect(normalizeTrack({ id: 'partial-normalization', title: 'Sin título', artist: 'Desconocido', album: 'Sencillo' })).toMatchObject({ title: 'Sin título', artist: 'Desconocido', album: 'Sencillo' });
});

it('a downloaded cover and metadata update the active UI without replacing its audio source', () => {
  const track = { id: 'metadata-live', title: 'Title', artist: 'Artist', url: 'blob:playing', cover: '/remote.png' };
  cacheTrack(track);
  usePlayerStore.setState({ track, playSrc: 'blob:playing', playing: true });
  const { result, unmount } = renderHook(() => usePlayerStoreBindings());
  act(() => cacheTrack({ id: track.id, title: '', cover: 'data:image/png;base64,aGVsbG8=', album: 'Album', durationSeconds: 123 }));
  expect(result.current.track).toMatchObject({ title: 'Title', artist: 'Artist', album: 'Album', durationSeconds: 123, cover: 'data:image/png;base64,aGVsbG8=', url: 'blob:playing' });
  expect(usePlayerStore.getState().playSrc).toBe('blob:playing');
  expect(usePlayerStore.getState().playing).toBe(true);
  unmount();
  const old = usePlayerStore.getState().track;
  act(() => cacheTrack({ id: track.id, title: 'Later' }));
  expect(usePlayerStore.getState().track).toBe(old);
});

it('partial metadata never erases known title, artist, album, duration or offline cover', () => {
  cacheTrack({ id: 'metadata-preserve', title: 'Title', artist: 'Artist', album: 'Album', durationSeconds: 123, cover: 'data:image/png;base64,aGVsbG8=' });
  cacheTrack({ id: 'metadata-preserve', title: '', artist: undefined, album: '', durationSeconds: 0, cover: '/remote.png' });
  expect(trackById('metadata-preserve')).toMatchObject({ title: 'Title', artist: 'Artist', album: 'Album', durationSeconds: 123, cover: 'data:image/png;base64,aGVsbG8=' });
});
