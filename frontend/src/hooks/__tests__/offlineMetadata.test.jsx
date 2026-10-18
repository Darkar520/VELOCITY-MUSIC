import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { cacheTrack, trackById } from '../../catalog.js';
import { usePlayerStore } from '../../store/playerStore.js';
import { usePlayerStoreBindings } from '../usePlayerStoreBindings.js';

afterEach(cleanup);

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
