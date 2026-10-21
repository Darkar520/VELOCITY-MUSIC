import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAudioErrorRecovery } from '../useAudioErrorRecovery.js';
import { api } from '../../api.js';
vi.mock('../../api.js', () => ({ api: {
  reportPlaybackError: vi.fn(async () => {}),
  ensureStreamUrl: vi.fn(),
  isDirectPlaybackUrl: vi.fn(() => false),
  recordDirectPlaybackFailure: vi.fn(() => true),
} }));
beforeEach(() => {
  api.reportPlaybackError.mockReset().mockResolvedValue(undefined);
  api.ensureStreamUrl.mockReset();
  api.isDirectPlaybackUrl.mockReset().mockReturnValue(false);
  api.recordDirectPlaybackFailure.mockReset().mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('replaces a failed direct URL with the signed proxy once and preserves position', async () => {
  vi.useFakeTimers();
  const directUrl = 'https://rr1.googlevideo.com/videoplayback?expire=1900000000';
  const track = { id: 'direct-track', artist: 'Artist', title: 'Song' };
  const audio = { getAttribute: () => directUrl, currentSrc: directUrl, currentTime: 32, duration: 200, error: { code: 4 } };
  const dispatchAudio = vi.fn();
  const setTrack = vi.fn();
  const playingRef = { current: true };
  api.isDirectPlaybackUrl.mockReturnValue(true);
  api.ensureStreamUrl.mockResolvedValue('/api/stream-proxy?exp=1&sig=signed');
  const { result } = renderHook(() => useAudioErrorRecovery({
    audioRef: { current: audio }, effectCtxRef: { current: {} }, selfPauseRef: { current: false },
    playingRef, trackRef: { current: track }, playErrorRef: { current: { id: null, n: 0 } },
    consecutiveFailsRef: { current: 0 }, track, queue: [track.id], quality: 'high',
    getMachine: () => ({ trackId: track.id, intent: 'play', focus: 'own' }), dispatchAudio,
    setTrack, setLoadingAudio: vi.fn(), setPlaying: vi.fn(), showToast: vi.fn(), next: vi.fn(),
  }));

  result.current.handleAudioError();
  await vi.advanceTimersByTimeAsync(450);
  expect(api.ensureStreamUrl).toHaveBeenCalledWith(
    expect.objectContaining({ id: track.id }),
    expect.objectContaining({ forceRefresh: true, playbackMode: 'proxy' }),
  );
  expect(api.recordDirectPlaybackFailure).toHaveBeenCalledWith(directUrl);
  expect(dispatchAudio).toHaveBeenCalledWith(expect.objectContaining({ type: 'STREAM_READY', url: expect.stringContaining('/api/stream-proxy') }));
  expect(dispatchAudio).toHaveBeenCalledWith({ type: 'USER_SEEK', position: 32 });
  expect(api.reportPlaybackError).toHaveBeenCalledWith(expect.objectContaining({
    errorCode: 'DIRECT_FALLBACK_PROXY_MOUNTED',
  }));
  vi.useRealTimers();
});

it('does not start proxy fallback after another app has received audio focus', async () => {
  vi.useFakeTimers();
  const directUrl = 'https://rr1.googlevideo.com/videoplayback?expire=1900000000';
  const track = { id: 'yielded-track', artist: 'Artist', title: 'Song' };
  api.isDirectPlaybackUrl.mockReturnValue(true);
  const { result } = renderHook(() => useAudioErrorRecovery({
    audioRef: { current: { getAttribute: () => directUrl, currentSrc: directUrl, currentTime: 0, duration: 200, error: { code: 4 } } },
    effectCtxRef: { current: {} }, selfPauseRef: { current: false }, playingRef: { current: true },
    trackRef: { current: track }, playErrorRef: { current: { id: null, n: 0 } }, consecutiveFailsRef: { current: 0 },
    track, queue: [track.id], quality: 'high', getMachine: () => ({ trackId: track.id, intent: 'play', focus: 'yielded' }),
    dispatchAudio: vi.fn(), setLoadingAudio: vi.fn(), setPlaying: vi.fn(), showToast: vi.fn(), next: vi.fn(),
  }));
  result.current.handleAudioError();
  await vi.advanceTimersByTimeAsync(450);
  expect(api.ensureStreamUrl).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it('does not record a direct-provider failure for a proxied source', () => {
  const track = { id: 'proxied-track', artist: 'Artist', title: 'Song' };
  api.isDirectPlaybackUrl.mockReturnValue(false);
  const { result } = renderHook(() => useAudioErrorRecovery({
    audioRef: { current: { getAttribute: () => '/api/stream-proxy?exp=1&sig=x', currentSrc: 'http://localhost/api/stream-proxy?exp=1&sig=x', currentTime: 0, duration: 200, error: { code: 4 } } },
    effectCtxRef: { current: {} }, selfPauseRef: { current: false }, playingRef: { current: true },
    trackRef: { current: track }, playErrorRef: { current: { id: null, n: 0 } }, consecutiveFailsRef: { current: 0 },
    track, queue: [track.id], quality: 'high', getMachine: () => ({ trackId: track.id, intent: 'play', focus: 'own' }),
    dispatchAudio: vi.fn(), setLoadingAudio: vi.fn(), setPlaying: vi.fn(), showToast: vi.fn(), next: vi.fn(),
  }));
  result.current.handleAudioError();
  expect(api.recordDirectPlaybackFailure).not.toHaveBeenCalled();
});

it('does not start proxy fallback after the user pauses while the retry is pending', async () => {
  vi.useFakeTimers();
  const directUrl = 'https://rr1.googlevideo.com/videoplayback?expire=1900000000';
  const track = { id: 'paused-track', artist: 'Artist', title: 'Song' };
  const playingRef = { current: true };
  api.isDirectPlaybackUrl.mockReturnValue(true);
  const { result } = renderHook(() => useAudioErrorRecovery({
    audioRef: { current: { getAttribute: () => directUrl, currentSrc: directUrl, currentTime: 0, duration: 200, error: { code: 4 } } },
    effectCtxRef: { current: {} }, selfPauseRef: { current: false }, playingRef,
    trackRef: { current: track }, playErrorRef: { current: { id: null, n: 0 } }, consecutiveFailsRef: { current: 0 },
    track, queue: [track.id], quality: 'high', getMachine: () => ({ trackId: track.id, intent: playingRef.current ? 'play' : 'pause', focus: 'own' }),
    dispatchAudio: vi.fn(), setLoadingAudio: vi.fn(), setPlaying: vi.fn(), showToast: vi.fn(), next: vi.fn(),
  }));
  result.current.handleAudioError();
  playingRef.current = false;
  await vi.advanceTimersByTimeAsync(450);
  expect(api.ensureStreamUrl).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it('renews a failed local URL once with the same saved bytes, then stops without skipping or fetching online', () => {
  const track = { id: 'downloaded', title: 'Song', artist: 'Artist' };
  const retrySource = vi.fn();
  const next = vi.fn();
  const playErrorRef = { current: { id: null, n: 0 } };
  const dispatchAudio = vi.fn();
  const props = { audioRef: { current: { currentSrc: 'blob:broken', currentTime: 0, duration: NaN, error: { code: 4 } } },
    effectCtxRef: { current: {} }, selfPauseRef: { current: false }, playingRef: { current: true }, trackRef: { current: track },
    playErrorRef, consecutiveFailsRef: { current: 0 }, track, queue: [track.id, 'next'],
    getMachine: () => ({ trackId: track.id, intent: 'play' }), dispatchAudio, setLoadingAudio: vi.fn(), setPlaying: vi.fn(),
    showToast: vi.fn(), next, retrySource };
  const { result } = renderHook(() => useAudioErrorRecovery(props));
  result.current.handleAudioError();
  expect(retrySource).toHaveBeenLastCalledWith(track.id);
  result.current.handleAudioError();
  expect(retrySource).toHaveBeenCalledOnce();
  props.audioRef.current.currentSrc = 'blob:fresh-but-also-fails';
  result.current.handleAudioError();
  expect(retrySource).toHaveBeenCalledOnce();
  expect(next).not.toHaveBeenCalled();
  expect(dispatchAudio).toHaveBeenCalledWith({ type: 'USER_PAUSE' });
});

it.each([
  { attr: null, current: 'blob:old', error: { code: 4 } },
  { attr: '', current: 'blob:old', error: { code: 4 } },
  { attr: 'blob:new', current: 'blob:old', error: { code: 4 } },
  { attr: 'blob:new', current: 'blob:new', error: null },
])('ignores a queued error belonging to an emptied/replaced source: %j', state => {
  const retrySource = vi.fn(), dispatchAudio = vi.fn(), next = vi.fn();
  const { result } = renderHook(() => useAudioErrorRecovery({
    effectCtxRef: { current: {} }, audioRef: { current: { getAttribute: () => state.attr, currentSrc: state.current, error: state.error } },
    track: { id: 'new' }, retrySource, dispatchAudio, next, queue: ['new', 'next'],
    selfPauseRef: { current: false }, playErrorRef: { current: { id: null, n: 0 } },
    consecutiveFailsRef: { current: 0 }, getMachine: () => ({ trackId: 'new', intent: 'play' }),
    setLoadingAudio: vi.fn(), setPlaying: vi.fn(), showToast: vi.fn(),
  }));
  result.current.handleAudioError();
  expect(retrySource).not.toHaveBeenCalled();
  expect(dispatchAudio).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
