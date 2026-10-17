import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMediaSession } from '../useMediaSession.js';
import { usePlayerStore } from '../../store/playerStore.js';

let session;
function setup(track = { id: 'lock-art', title: 'Song', artist: 'Artist', cover: '/img?u=https%3A%2F%2Flh3.googleusercontent.com%2Fa%3Dw512-h512&id=lock-art' }) {
  const props = { track, playing: true, dur: 200, vol: 1,
    audioRef: { current: { duration: 200, currentTime: 30, volume: 1 } },
    ctlRef: { current: { dispatchAudio: vi.fn(), getMachine: () => ({ trackId: track.id }) } },
    nextTrackActionRef: { current: vi.fn() }, prevTrackActionRef: { current: vi.fn() },
    interruptPositionRef: { current: null } };
  return { ...renderHook(p => useMediaSession(p), { initialProps: props }), props };
}
beforeEach(() => {
  vi.useFakeTimers();
  session = { setActionHandler: vi.fn(), setPositionState: vi.fn() };
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
  vi.stubGlobal('MediaMetadata', class { constructor(data) { Object.assign(this, data); } });
  usePlayerStore.setState({ time: 0, duration: 200 });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete navigator.mediaSession; });

it('sends the real relative proxy cover to the OS as an absolute URL', () => {
  setup();
  const cover = new URL(session.metadata.artwork[0].src);
  expect(cover.origin).toBe(location.origin);
  expect(cover.pathname).toBe('/img');
  expect(cover.searchParams.get('id')).toBe('lock-art');
});

it('keeps metadata and action handlers stable across pause/play and URL refresh', () => {
  const { props, rerender } = setup();
  const metadata = session.metadata;
  const binds = session.setActionHandler.mock.calls.length;
  rerender({ ...props, playing: false, track: { ...props.track, url: '/new-audio' } });
  expect(session.metadata).toBe(metadata);
  expect(session.setActionHandler).toHaveBeenCalledTimes(binds);
});

it('does not crash or lose other actions if a browser rejects nexttrack', () => {
  session.setActionHandler.mockImplementation(action => { if (action === 'nexttrack') throw new Error('unsupported'); });
  expect(() => setup()).not.toThrow();
  expect(session.setActionHandler).toHaveBeenCalledWith('pause', expect.any(Function));
  expect(session.setActionHandler).toHaveBeenCalledWith('seekto', expect.any(Function));
});

it('coalesces normal clock updates but immediately reports a seek', () => {
  setup();
  session.setPositionState.mockClear();
  for (let i = 1; i <= 20; i++) {
    act(() => { vi.advanceTimersByTime(250); usePlayerStore.getState().setTime(i / 4); });
  }
  expect(session.setPositionState.mock.calls.length).toBeLessThanOrEqual(5);
  act(() => usePlayerStore.getState().setTime(80));
  expect(session.setPositionState).toHaveBeenLastCalledWith(expect.objectContaining({ position: 80 }));
});

it('implements seekforward as a bounded relative seek, preserving nexttrack', () => {
  const { props } = setup();
  props.ctlRef.current.seek = vi.fn();
  const actions = new Map(session.setActionHandler.mock.calls);
  actions.get('seekforward')({ seekOffset: 15 });
  expect(props.ctlRef.current.seek).toHaveBeenCalledWith(45);
  expect(props.nextTrackActionRef.current).not.toHaveBeenCalled();
  actions.get('nexttrack')();
  expect(props.nextTrackActionRef.current).toHaveBeenCalledOnce();
});

it('falls back for a broken image and ignores an old image failure after changing tracks', () => {
  const images = [];
  vi.stubGlobal('Image', class { constructor() { images.push(this); } });
  const { props, rerender } = setup();
  const staleError = images[0].onerror;
  rerender({ ...props, track: { id: 'new-cover', title: 'New song', cover: '/new-cover.png' } });
  staleError();
  expect(session.metadata.artwork[0].src).toContain('/new-cover.png');
  images[1].onerror();
  expect(session.metadata.artwork[0].src).toContain('/icon-512.png');
});

it('retains offline blob artwork through pause/play and releases it on unmount', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:offline-cover');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['cover'], { type: 'image/png' }) })));
  const { props, rerender, unmount } = setup({ id: 'offline-art', title: 'Offline', cover: 'data:image/png;base64,aGVsbG8=' });
  await act(async () => { await Promise.resolve(); });
  expect(session.metadata.artwork[0].src).toBe('blob:offline-cover');
  rerender({ ...props, playing: false });
  expect(create).toHaveBeenCalledOnce();
  expect(revoke).not.toHaveBeenCalled();
  unmount();
  expect(revoke).toHaveBeenCalledWith('blob:offline-cover');
});
