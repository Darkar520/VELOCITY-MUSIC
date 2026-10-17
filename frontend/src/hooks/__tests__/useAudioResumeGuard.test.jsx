import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAudioResumeGuard } from '../useAudioResumeGuard.js';

function setup({ status = 'ready', paused = false, position = 0.8 } = {}) {
  const machine = { trackId: 'second', intent: 'play', focus: 'own', srcStatus: status };
  const audio = { paused, ended: false, readyState: status === 'ready' ? 4 : 0,
    currentTime: position, volume: 1, getAttribute: () => status === 'ready' ? '/second' : '' };
  const deps = { audioRef: { current: audio }, preloadAudioRef: { current: null }, preloadAudio2Ref: { current: null },
    playingRef: { current: true }, selfPauseRef: { current: false }, systemPausedRef: { current: false },
    reacquireInFlight: { current: false }, lastTimeRef: { current: 170 }, stuckCheckRef: { current: null },
    bgLastCtRef: { current: 170 }, bgLastProgressRef: { current: Date.now() - 9000 },
    preloadEpochRef: { current: 0 }, setPreloadEpoch: vi.fn(), vol: 1,
    getMachine: () => machine, dispatchAudio: vi.fn() };
  return { ...renderHook(() => useAudioResumeGuard(deps)), machine, audio, deps };
}
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); delete document.visibilityState; });

it('does not classify the paused element during next-track preparation as loss of audio focus', async () => {
  const { deps } = setup({ status: 'none', paused: true, position: 0 });
  await act(() => vi.advanceTimersByTimeAsync(12000));
  expect(deps.dispatchAudio).not.toHaveBeenCalled();
});

it('starts a fresh progress baseline when a new source resets currentTime', async () => {
  const { deps, audio } = setup();
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(deps.dispatchAudio).not.toHaveBeenCalled();
  audio.currentTime = 2.3;
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(deps.dispatchAudio).not.toHaveBeenCalled();
});

it('still reports a confirmed stopped clock with a ready source', async () => {
  const { deps } = setup();
  await act(() => vi.advanceTimersByTimeAsync(7500));
  expect(deps.dispatchAudio).toHaveBeenCalledWith({ type: 'PIPELINE_DEAD', hidden: true, position: 0.8 });
});

it('does not infer a stopped clock from a single sample when the window gains focus', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const { deps } = setup({ position: 42 });
  deps.lastTimeRef.current = 42;
  act(() => window.dispatchEvent(new Event('focus')));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(deps.dispatchAudio).not.toHaveBeenCalled();
});

it('still resumes an actually paused source on return', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const { deps } = setup({ position: 42, paused: true });
  act(() => window.dispatchEvent(new Event('focus')));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(deps.dispatchAudio).toHaveBeenCalledWith({ type: 'DOC_VISIBLE', currentTime: 42 });
});
