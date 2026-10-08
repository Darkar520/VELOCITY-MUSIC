import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  peekStreamUrl: vi.fn(() => null),
  ensureStreamUrl: vi.fn(async () => '/api/stream-proxy?exp=1&sig=test'),
  streamUrl: vi.fn(() => '/api/stream-proxy'),
  recordHistory: vi.fn(async () => {}),
  updateNowPlaying: vi.fn(),
  saveTracks: vi.fn(async () => {}),
  warmStreamUrl: vi.fn(),
  radio: vi.fn(async () => []),
}));

vi.mock('../../api.js', () => ({ api: apiMock }));
vi.mock('../../coverEnrich.js', () => ({ enrichCoverIfNeeded: vi.fn() }));
// DOM effects are a separate tested layer. Keep the real state reducer and
// controller here, and observe whether selecting a track resets them.
vi.mock('../../audio/runAudioEffects.js', () => ({
  runAudioEffects: vi.fn(),
  bumpAudioEpoch: vi.fn(),
}));

import { usePlaybackController } from '../usePlaybackController.js';
import { usePlayerStore } from '../../store/playerStore.js';
import { initialState } from '../../audio/audioMachine.js';
import { makeTrack, resetStores, seedCatalog } from '../../__tests__/uiFixtures.js';

function setup({ intent = 'play', ended = false, readyState = 4, error = null, loading = false } = {}) {
  const track = makeTrack();
  const other = makeTrack({ id: 't2', title: 'Aerials' });
  const ids = [track.id, other.id];
  seedCatalog([track, other]);
  usePlayerStore.getState().patchMachine({
    ...initialState(), trackId: track.id, intent,
    livePosition: 32, sessionPosition: 32, srcStatus: readyState ? 'ready' : 'none',
  });
  usePlayerStore.setState({ track, time: 32, duration: 200, queue: ids,
    playing: intent === 'play', loadingAudio: loading, playSrc: track.url });

  const audio = { currentTime: 32, readyState, error, ended, paused: intent !== 'play',
    volume: 1, pause: vi.fn(), play: vi.fn(async () => {}) };
  const refs = Object.fromEntries([
    'selfPauseRef', 'playingRef', 'fadeRafRef', 'fadeSafetyRef', 'pendingFadeRef',
    'objUrlRef', 'radioRef', 'radioSeedRef', 'nextTrackActionRef', 'prevTrackActionRef',
    'sessionResumeRef', 'systemPausedRef', 'interruptPositionRef', 'interruptTrackIdRef',
  ].map(name => [name, { current: null }]));
  const setter = key => value => usePlayerStore.setState(s => ({
    [key]: typeof value === 'function' ? value(s[key]) : value,
  }));
  const recordPlayStat = vi.fn();
  const deps = {
    ...refs, audioRef: { current: audio }, trackRef: { current: track },
    queueRef: { current: ids }, mixSessionRef: { current: { label: null, used: new Set() } },
    track, queue: ids, playing: intent === 'play', vol: 1, shuffle: false,
    quality: 'high', backendDown: false, downloaded: new Set(),
    setTrack: setter('track'), setPlaying: setter('playing'), setTime: setter('time'),
    setPlaySrc: setter('playSrc'), setLoadingAudio: setter('loadingAudio'),
    setMediaInterrupted: setter('mediaInterrupted'), setQueue: setter('queue'),
    setRecent: vi.fn(), setPlayingFrom: vi.fn(), showToast: vi.fn(),
    recordPlayStat, setMediaSessionState: vi.fn(),
  };
  const hook = renderHook(() => usePlaybackController(deps));
  return { ...hook, audio, track, other, ids, recordPlayStat };
}

describe('selecting the current track', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); resetStores(); });
  afterEach(() => {
    cleanup();
    usePlayerStore.getState().setPolicyEffectCtx(null);
    usePlayerStore.getState().patchMachine(initialState());
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('opens the player without restarting, replacing the queue or preparing another stream', () => {
    const { result, track, audio, ids, recordPlayStat } = setup();
    act(() => result.current.play(track, [track.id], { radio: true }));
    expect(usePlayerStore.getState().expanded).toBe(true);
    expect(usePlayerStore.getState().time).toBe(32);
    expect(usePlayerStore.getState().queue).toEqual(ids);
    expect(result.current.getMachine().livePosition).toBe(32);
    expect(result.current.playGenRef.current).toBe(0);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(apiMock.peekStreamUrl).not.toHaveBeenCalled();
    expect(apiMock.ensureStreamUrl).not.toHaveBeenCalled();
    expect(recordPlayStat).not.toHaveBeenCalled();
  });

  it('opens a track still loading without cancelling or restarting preparation', () => {
    const { result, track, audio } = setup({ readyState: 0, loading: true });
    act(() => result.current.play(track));
    expect(usePlayerStore.getState().expanded).toBe(true);
    expect(usePlayerStore.getState().loadingAudio).toBe(true);
    expect(result.current.playGenRef.current).toBe(0);
    expect(audio.pause).not.toHaveBeenCalled();
  });

  it('resumes a paused track from its existing position and opens the player', () => {
    const { result, track, audio } = setup({ intent: 'pause' });
    act(() => result.current.play(track));
    expect(usePlayerStore.getState().expanded).toBe(true);
    expect(result.current.getMachine().intent).toBe('play');
    expect(result.current.getMachine().livePosition).toBe(32);
    expect(usePlayerStore.getState().time).toBe(32);
    expect(audio.pause).not.toHaveBeenCalled();
  });

  it('still starts a different track at zero', () => {
    const { result, other, audio } = setup();
    act(() => result.current.play(other, [other.id]));
    expect(result.current.getMachine().trackId).toBe(other.id);
    expect(usePlayerStore.getState().time).toBe(0);
    expect(usePlayerStore.getState().queue).toEqual([other.id]);
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it('allows replaying a track that has ended', () => {
    const { result, track } = setup({ intent: 'pause', ended: true });
    act(() => result.current.play(track));
    expect(result.current.playGenRef.current).toBe(1);
    expect(usePlayerStore.getState().time).toBe(0);
    expect(result.current.getMachine().intent).toBe('play');
  });

  it('lets a failed track be retried instead of only opening the player', () => {
    const { result, track } = setup({ intent: 'pause', readyState: 0, error: { code: 4 } });
    act(() => result.current.play(track));
    expect(result.current.playGenRef.current).toBe(1);
    expect(result.current.getMachine().intent).toBe('play');
    expect(usePlayerStore.getState().time).toBe(0);
  });

  it.each([{ keepMix: true }, { restart: true }])('preserves explicit and automatic replay: %j', opts => {
    const { result, track } = setup();
    act(() => result.current.play(track, [track.id], opts));
    expect(result.current.playGenRef.current).toBe(1);
    expect(usePlayerStore.getState().time).toBe(0);
    expect(usePlayerStore.getState().expanded).toBe(false);
  });
});
