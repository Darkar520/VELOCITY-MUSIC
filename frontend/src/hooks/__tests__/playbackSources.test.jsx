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
import { useAudioElement } from '../useAudioElement.js';
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
  return { ...renderHook(() => usePlaybackController(deps)), track, audio, deps };
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

it('finds a stored file even when the React download index has not hydrated yet', async () => {
  mocks.blob.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
  const { result, track } = setup(false);
  await act(async () => { result.current.play(track); });
  expect(mocks.blob).toHaveBeenCalledWith(track.id);
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('plays local bytes without requiring artist metadata used only by the server', async () => {
  mocks.blob.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
  const { result, track } = setup(true);
  await act(async () => { result.current.play({ ...track, id: 'local-no-artist', artist: '' }); });
  expect(mocks.blob).toHaveBeenCalledWith('local-no-artist');
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().playSrc).toContain('blob:');
});

it('keeps the failure budget when advancing a queue instead of resetting it at every skipped song', async () => {
  const { deps, track } = setup();
  const failures = { current: 2 };
  const { result } = renderHook(() => usePlaybackController({ ...deps, consecutiveFailsRef: failures }));
  await act(async () => { result.current.play({ ...track, id: 'next-in-queue' }, ['source-test','next-in-queue'], { keepMix: true }); });
  expect(failures.current).toBe(2);
});

it('detaches an active blob before revoking its URL, including a local retry', async () => {
  mocks.blob.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
  const { result, track, audio } = setup(true);
  await act(async () => { result.current.play(track); });
  const previous = audio.getAttribute('src');
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {
    expect(audio.getAttribute('src')).not.toBe(url);
  });
  await act(async () => { await result.current.retrySource(track.id); });
  expect(revoked).toHaveBeenCalledWith(previous);
  await act(async () => { result.current.play({ ...track, id: 'following-local' }, [track.id,'following-local'], { keepMix: true }); });
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('starts a cached signed source once, without a second STREAM_READY from the caller', async () => {
  mocks.peek.mockReturnValue('/api/stream-proxy?cached');
  const { result, track, audio } = setup();
  await act(async () => { result.current.play(track); });
  expect(audio.play).toHaveBeenCalledOnce();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('starts a prepared remote queue track synchronously even when IndexedDB is suspended', () => {
  mocks.peek.mockReturnValue('/api/stream-proxy?cached');
  mocks.blob.mockImplementation(() => new Promise(() => {}));
  const { result, track, audio } = setup();
  act(() => result.current.play(track, [track.id], { keepMix: true }));
  expect(audio.getAttribute('src')).toBe('/api/stream-proxy?cached');
  expect(audio.play).toHaveBeenCalledOnce();
  expect(mocks.blob).not.toHaveBeenCalled();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('keeps a known download local even with a prepared remote URL', async () => {
  mocks.peek.mockReturnValue('/api/stream-proxy?cached');
  mocks.blob.mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
  const { result, track, audio } = setup(true);
  await act(async () => { result.current.play(track); });
  expect(audio.getAttribute('src')).toContain('blob:');
  expect(mocks.blob).toHaveBeenCalledOnce();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('advances two ended events while hidden without waiting for storage or React ref mirrors', () => {
  mocks.peek.mockImplementation(params => '/api/stream-proxy?track=' + params.id);
  mocks.blob.mockImplementation(() => new Promise(() => {}));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { result, track, audio, deps } = setup();
  const tracks = [track, { ...track, id: 'second' }, { ...track, id: 'third' }];
  tracks.forEach(cacheTrack);
  const queue = tracks.map(t => t.id);
  Object.defineProperties(audio, {
    readyState: { configurable: true, get: () => 4 },
    currentSrc: { configurable: true, get: () => audio.getAttribute('src') ? new URL(audio.getAttribute('src'), location.href).href : '' },
    ended: { configurable: true, get: () => true },
  });
  const handlers = renderHook(() => useAudioElement({
    ...deps, getMachine: result.current.getMachine,
    dispatchAudio: result.current.dispatchAudio, onTrackEnded: result.current.next,
  }));
  act(() => result.current.play(track, queue));
  for (const nextTrack of tracks.slice(1)) {
    act(() => handlers.result.current.onEnded());
    expect(usePlayerStore.getState().track.id).toBe(nextTrack.id);
    expect(audio.getAttribute('src')).toBe('/api/stream-proxy?track=' + nextTrack.id);
    expect(result.current.getMachine()).toMatchObject({ trackId: nextTrack.id, intent: 'play', focus: 'own', srcStatus: 'ready' });
  }
  expect(audio.play).toHaveBeenCalledTimes(3);
  expect(mocks.blob).not.toHaveBeenCalled();
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(deps.trackRef.current.id).toBe(track.id);
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
