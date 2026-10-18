import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAudioErrorRecovery } from '../useAudioErrorRecovery.js';
vi.mock('../../api.js', () => ({ api: { reportPlaybackError: vi.fn(async () => {}), ensureStreamUrl: vi.fn() } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
