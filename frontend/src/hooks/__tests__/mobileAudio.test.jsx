import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAudioEffects } from '../../audio/runAudioEffects.js';
import { initialState, reduce } from '../../audio/audioMachine.js';
import { useAudioElement } from '../useAudioElement.js';
import { useAudioOutput } from '../useAudioOutput.js';

function runner() {
  const machine = { intent: 'play', focus: 'own' };
  const audio = { play: vi.fn(async () => {}), pause: vi.fn(), readyState: 4,
    currentTime: 12, volume: 1, getAttribute: () => '/api/stream-proxy?test' };
  const ctx = { audioRef: { current: audio }, getIntent: () => machine.intent,
    canPlay: () => machine.intent === 'play' && machine.focus !== 'yielded',
    onPlayOk: vi.fn(), onPlayFail: vi.fn(), setMediaSessionState: vi.fn() };
  return { machine, audio, ctx };
}

function handlers() {
  const machine = { ...initialState(), intent: 'play', trackId: 'a', srcStatus: 'ready' };
  const audio = { paused: true, ended: false, readyState: 4, currentTime: 42, getAttribute: () => '/audio/a' };
  const deps = { audioRef: { current: audio }, getMachine: () => machine,
    selfPauseRef: { current: false }, pendingFadeRef: { current: false },
    playingRef: { current: true }, trackRef: { current: { id: 'a' } },
    systemPausedRef: { current: false }, setTime: vi.fn(),
    dispatchAudio: vi.fn(), setLoadingAudio: vi.fn() };
  return { ...renderHook(() => useAudioElement(deps)), machine, audio, deps };
}

describe('mobile audio races and power policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
  afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); delete document.visibilityState; delete navigator.wakeLock; });

  it('starts play synchronously in the media action and never repeats a successful play', async () => {
    const { ctx, audio } = runner();
    runAudioEffects([{ type: 'play' }], ctx);
    expect(audio.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('does not run delayed play attempts after another app owns the audio', async () => {
    const { ctx, machine, audio } = runner();
    runAudioEffects([{ type: 'play' }], ctx);
    await vi.advanceTimersByTimeAsync(1);
    const before = audio.play.mock.calls.length;
    machine.focus = 'yielded';
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.play).toHaveBeenCalledTimes(before);
  });

  it('ignores a late play promise after focus was yielded', async () => {
    const { ctx, machine, audio } = runner();
    let resolve;
    audio.play.mockImplementation(() => new Promise(r => { resolve = r; }));
    runAudioEffects([{ type: 'play' }], ctx);
    await vi.advanceTimersByTimeAsync(1);
    machine.focus = 'yielded';
    resolve();
    await Promise.resolve();
    expect(ctx.onPlayOk).not.toHaveBeenCalled();
    expect(ctx.setMediaSessionState).not.toHaveBeenCalled();
  });

  it('does not restart audio when a prepared source arrives during an interruption', () => {
    const state = { ...initialState(), intent: 'play', focus: 'yielded', trackId: 'a',
      yieldPosition: 42, yieldTrackId: 'a', srcStatus: 'stale' };
    const result = reduce(state, { type: 'STREAM_READY', trackId: 'a', url: '/audio/a' });
    expect(result.state.srcStatus).toBe('ready');
    expect(result.state.focus).toBe('yielded');
    expect(result.effects.some(e => e.type === 'play')).toBe(false);
    const visible = reduce(result.state, { type: 'DOC_VISIBLE', currentTime: 0 });
    expect(visible.effects).toContainEqual({ type: 'seek', position: 42 });
    expect(visible.effects).toContainEqual({ type: 'play' });
  });

  it('bounds AbortError retries and cancels them when the machine yields', async () => {
    const { ctx, machine, audio } = runner();
    audio.play.mockRejectedValue(Object.assign(new Error('source changed'), { name: 'AbortError' }));
    runAudioEffects([{ type: 'play' }], ctx);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.play).toHaveBeenCalledTimes(3);
    expect(ctx.onPlayFail).toHaveBeenCalledOnce();
    audio.play.mockClear();
    runAudioEffects([{ type: 'play' }], ctx);
    await Promise.resolve();
    machine.focus = 'yielded';
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('does not pause a new source when an old play promise completes', async () => {
    const { ctx, audio } = runner();
    let resolve;
    audio.play.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    runAudioEffects([{ type: 'play' }], ctx);
    runAudioEffects([{ type: 'clearSrc' }], ctx);
    const stopped = audio.pause.mock.calls.length;
    resolve();
    await Promise.resolve();
    expect(audio.pause).toHaveBeenCalledTimes(stopped);
    expect(ctx.onPlayOk).not.toHaveBeenCalled();
  });

  it.each(['pause', 'yielded'])('ignores late PLAYING after %s', mode => {
    const state = { ...initialState(), intent: mode === 'pause' ? 'pause' : 'play',
      focus: mode === 'yielded' ? 'yielded' : 'own', trackId: 'a', srcStatus: 'ready' };
    const result = reduce(state, { type: 'PLAYING', trackId: 'a', position: 43 });
    expect(result.state).toEqual(state);
    expect(result.effects).toEqual([]);
  });

  it('discards a delayed pause when playback has already recovered', async () => {
    const { result, audio, deps } = handlers();
    act(() => result.current.onPause());
    audio.paused = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(deps.dispatchAudio).not.toHaveBeenCalled();
  });

  it('does not yield or carry the old position when a notification next queues an internal pause', () => {
    const { result, machine, audio, deps } = handlers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    let src = '/audio/a';
    audio.getAttribute = () => src;
    audio.removeAttribute = () => { src = null; };
    audio.paused = false;
    audio.pause = () => { audio.paused = true; }; // native pause event arrives in a later task
    const transition = reduce(machine, { type: 'TRACK_SET', trackId: 'b', intent: 'play' });
    Object.assign(machine, transition.state);
    runAudioEffects(transition.effects, { audioRef: deps.audioRef, selfPauseRef: deps.selfPauseRef });
    act(() => result.current.onPause());
    expect(deps.dispatchAudio).not.toHaveBeenCalled();
    const ready = reduce(machine, { type: 'STREAM_READY', trackId: 'b', url: '/audio/b' });
    expect(ready.state.focus).toBe('own');
    expect(ready.effects).toContainEqual({ type: 'seek', position: 0 });
    expect(ready.effects).toContainEqual({ type: 'play' });
  });

  it('ignores the old resource clock while a new track is resolving', () => {
    const { result, machine, deps } = handlers();
    Object.assign(machine, reduce(machine, { type: 'TRACK_SET', trackId: 'b', intent: 'play' }).state);
    act(() => result.current.onTimeUpdate());
    expect(deps.setTime).not.toHaveBeenCalled();
  });

  it.each(['empty', 'loading', 'previous-source'])('ignores a queued pause from a %s resource without suppressing a real interruption', mode => {
    const { result, audio, deps } = handlers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    audio.readyState = 4;
    audio.getAttribute = () => mode.includes('empty') ? null : '/audio/b';
    audio.readyState = mode.includes('loading') ? 0 : 4;
    audio.currentSrc = mode.includes('previous-source') ? new URL('/audio/a', location.href).href : '';
    act(() => result.current.onPause());
    expect(deps.dispatchAudio).not.toHaveBeenCalled();
    audio.getAttribute = () => '/audio/b';
    audio.currentSrc = new URL('/audio/b', location.href).href;
    audio.readyState = 4;
    act(() => result.current.onPause());
    expect(deps.dispatchAudio).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXTERNAL_PAUSE', hidden: true }));
  });

  it('discards an old-track pause and cancels pending pause work on unmount', async () => {
    const { result, machine, deps, unmount } = handlers();
    act(() => result.current.onPause());
    machine.trackId = 'b';
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(deps.dispatchAudio).not.toHaveBeenCalled();
    act(() => result.current.onPause());
    unmount();
    await vi.advanceTimersByTimeAsync(350);
    expect(deps.dispatchAudio).not.toHaveBeenCalled();
  });

  it('allows the screen to sleep while music plays', () => {
    const request = vi.fn(async () => ({ release: vi.fn(async () => {}) }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    renderHook(() => useAudioOutput({ audioRef: { current: { volume: 1 } },
      playing: true, vol: 1, settings: {}, setOutputs: vi.fn() }));
    expect(request).not.toHaveBeenCalled();
    delete navigator.wakeLock;
  });
});
