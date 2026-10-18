import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ blob: vi.fn(), peek: vi.fn(), ensure: vi.fn(), offlineCompatible: vi.fn() }));
vi.mock('../../audio/playbackFormat.js', () => ({ canUseOfflineAudio: mocks.offlineCompatible }));
vi.mock('../../api.js', () => ({ api: {
  peekStreamUrl: mocks.peek, ensureStreamUrl: mocks.ensure, streamUrl: () => '/api/unsigned',
  warmStreamUrl: vi.fn(), recordHistory: async () => {}, updateNowPlaying: vi.fn(), saveTracks: async () => {},
  reportPlaybackError: async () => {},
} }));
vi.mock('../../offline.js', () => ({ getBlob: mocks.blob }));
vi.mock('../../coverEnrich.js', () => ({ enrichCoverIfNeeded: vi.fn() }));
import { usePlaybackController } from '../usePlaybackController.js';
import { usePlayerStore } from '../../store/playerStore.js';
import { initialState } from '../../audio/audioMachine.js';
import { cacheTrack } from '../../catalog.js';

function setup(downloaded = false) {
  const track = { id: 'source-test', artist: 'Artist', title: 'Song' };
  cacheTrack(track);
  const refs = Object.fromEntries(['selfPauseRef','playingRef','fadeRafRef','fadeSafetyRef','pendingFadeRef','objUrlRef','radioRef','radioSeedRef',
    'nextTrackActionRef','prevTrackActionRef','sessionResumeRef','systemPausedRef','interruptPositionRef','interruptTrackIdRef'].map(k => [k, { current: null }]));
  const audio = document.createElement('audio');
  const set = key => value => usePlayerStore.setState(s => ({ [key]: typeof value === 'function' ? value(s[key]) : value }));
  const deps = { ...refs, audioRef: { current: audio }, trackRef: { current: track }, queueRef: { current: [] },
    mixSessionRef: { current: { used: new Set() } }, vol: 1, quality: 'high', downloaded: new Set(downloaded ? [track.id] : []), queue: [],
    setTrack: set('track'), setTime: set('time'), setPlaying: set('playing'), setPlaySrc: set('playSrc'), setQueue: set('queue'),
    setLoadingAudio: set('loadingAudio'), setMediaInterrupted: set('mediaInterrupted'), setRecent: vi.fn(), showToast: vi.fn() };
  return { ...renderHook(() => usePlaybackController(deps)), track, audio };
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.blob.mockReset().mockResolvedValue(null);
  mocks.offlineCompatible.mockReset().mockReturnValue(true);
  mocks.peek.mockReset().mockReturnValue(null);
  mocks.ensure.mockReset().mockResolvedValue('/api/stream-proxy?signed');
  usePlayerStore.getState().patchMachine(initialState());
  usePlayerStore.setState({ track: null, playing: false, queue: [] });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); usePlayerStore.getState().setPolicyEffectCtx(null); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('reads one offline blob and mounts one object URL per track selection', async () => {
  mocks.blob.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
  const create = vi.spyOn(URL, 'createObjectURL');
  const { result, track } = setup(true);
  await act(async () => { result.current.play(track); });
  expect(mocks.blob).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('starts a cached signed source once, without a second STREAM_READY from the caller', async () => {
  mocks.peek.mockReturnValue('/api/stream-proxy?cached');
  const { result, track, audio } = setup();
  await act(async () => { result.current.play(track); });
  expect(audio.play).toHaveBeenCalledOnce();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('does not publish an offline blob that finishes reading after unmount', async () => {
  let resolve;
  mocks.blob.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result, track, unmount } = setup(true);
  act(() => result.current.play(track));
  unmount();
  const create = vi.spyOn(URL, 'createObjectURL');
  await act(async () => { resolve(new Blob(['audio'])); });
  expect(create).not.toHaveBeenCalled();
});

it('uses the online source once when offline storage cannot read the downloaded file', async () => {
  mocks.blob.mockRejectedValue(new Error('IndexedDB unavailable'));
  const { result, track, audio } = setup(true);
  await act(async () => { result.current.play(track); });
  expect(mocks.blob).toHaveBeenCalledOnce();
  expect(mocks.ensure).toHaveBeenCalledOnce();
  expect(audio.getAttribute('src')).toContain('stream-proxy');
});

it('keeps an incompatible downloaded file and uses the online compatible source', async () => {
  mocks.blob.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
  mocks.offlineCompatible.mockReturnValue(false);
  const create = vi.spyOn(URL, 'createObjectURL');
  const { result, track, audio } = setup(true);
  await act(async () => { result.current.play(track); });
  expect(create).not.toHaveBeenCalled();
  expect(mocks.ensure).toHaveBeenCalledOnce();
  expect(audio.getAttribute('src')).toContain('stream-proxy');
});

it.each([0, 201])('a new selection replaces the previous duration with its own metadata (%s seconds)', async durationSeconds => {
  const { result, track } = setup();
  usePlayerStore.setState({ duration: 127.941 });
  await act(async () => { result.current.play({ ...track, id: 'new-duration-' + durationSeconds, durationSeconds }); });
  expect(usePlayerStore.getState().duration).toBe(durationSeconds);
});
