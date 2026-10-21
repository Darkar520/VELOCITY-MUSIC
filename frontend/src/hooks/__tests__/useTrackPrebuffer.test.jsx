import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  peekStreamUrl: vi.fn(() => null),
  peekPlaybackUrl: vi.fn(() => null),
  ensureStreamUrl: vi.fn(),
}));

vi.mock('../../api.js', () => ({ api: apiMock }));
vi.mock('../../catalog.js', () => ({
  trackById: (id) => ({ id, artist: `Artist ${id}`, title: `Track ${id}` }),
}));
vi.mock('../../audioContinuity.js', () => ({ isDocumentVisible: () => true }));

import { useTrackPrebuffer } from '../useTrackPrebuffer.js';

function makeAudio() {
  const audio = document.createElement('audio');
  vi.spyOn(audio, 'load').mockImplementation(() => {});
  vi.spyOn(audio, 'pause').mockImplementation(() => {});
  return audio;
}

function setup(mode = 'current', queue = ['current', 'next', 'later'], track = { id: 'current' }, prefetchNext, playbackMode = 'auto') {
  const audio = makeAudio();
  const audio2 = makeAudio();
  const args = {
    preloadAudioRef: { current: audio },
    preloadAudio2Ref: { current: audio2 },
    preloadEpochRef: { current: 0 },
    preloadEpoch: 0,
    track,
    queue,
    quality: 'high',
    downloaded: new Set(),
    mode,
    playbackMode,
    prefetchNext,
  };
  const hook = renderHook((props) => useTrackPrebuffer({ ...args, ...props }), {
    initialProps: { mode, queue, track, playbackMode },
  });
  return { ...hook, audio, audio2 };
}

describe('useTrackPrebuffer modes and cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.ensureStreamUrl.mockImplementation(async ({ id }) => `/stream/${id}`);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('current mode preserves both following audio preloads', async () => {
    const { audio, audio2 } = setup('current');
    await waitFor(() => {
      expect(audio.getAttribute('src')).toBe('/stream/next');
      expect(audio2.getAttribute('src')).toBe('/stream/later');
    });
    expect(apiMock.ensureStreamUrl).toHaveBeenCalledTimes(2);
    expect(audio.volume).toBe(0);
    expect(audio2.volume).toBe(0);
  });

  it('one-track mode requests audio for only the next queued track', async () => {
    const { audio, audio2 } = setup('one-track');
    await waitFor(() => expect(audio.getAttribute('src')).toBe('/stream/next'));
    expect(apiMock.ensureStreamUrl).toHaveBeenCalledTimes(1);
    expect(audio2.getAttribute('src')).toBeNull();
  });

  it('passes the selected playback route when preloading a later track', async () => {
    setup('current', ['current', 'next', 'later'], { id: 'current' }, vi.fn(async () => '/stream/next'), 'direct-experimental');
    await waitFor(() => expect(apiMock.ensureStreamUrl).toHaveBeenCalled());
    expect(apiMock.ensureStreamUrl.mock.calls[0][1]).toEqual(expect.objectContaining({ playbackMode: 'direct-experimental' }));
  });

  it('url-only mode does not mount audio sources', async () => {
    const { audio, audio2 } = setup('url-only');
    await act(async () => {});
    expect(apiMock.ensureStreamUrl).not.toHaveBeenCalled();
    expect(audio.getAttribute('src')).toBeNull();
    expect(audio2.getAttribute('src')).toBeNull();
  });

  it('uses the existing next-track URL preparation instead of resolving that track twice', async () => {
    const prefetchNext = vi.fn(async () => '/stream/next');
    const { audio, audio2 } = setup('current', ['current', 'next', 'later'], { id: 'current' }, prefetchNext);
    await waitFor(() => expect(audio.getAttribute('src')).toBe('/stream/next'));
    expect(prefetchNext).toHaveBeenCalledWith('current', ['current', 'next', 'later'], 'high');
    expect(apiMock.ensureStreamUrl).toHaveBeenCalledTimes(1);
    expect(apiMock.ensureStreamUrl.mock.calls[0][0].id).toBe('later');
    expect(audio2.getAttribute('src')).toBe('/stream/later');
  });

  it('aborts a stale URL preparation and ignores its late result after the queue changes', async () => {
    const pending = [];
    apiMock.ensureStreamUrl.mockImplementation((_params, options) => new Promise((resolve) => {
      pending.push({ resolve, signal: options.signal });
    }));
    const { audio, rerender } = setup('one-track');
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ mode: 'one-track', queue: ['current', 'later', 'next'], track: { id: 'current' } });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);

    await act(async () => {
      pending[0].resolve('/stream/stale');
      pending[1].resolve('/stream/later');
    });
    await waitFor(() => expect(audio.getAttribute('src')).toBe('/stream/later'));
    expect(audio.getAttribute('src')).not.toBe('/stream/stale');
  });

  it('unloads active preloads when switched to url-only mode', async () => {
    const { audio, audio2, rerender } = setup('current');
    await waitFor(() => expect(audio2.getAttribute('src')).toBe('/stream/later'));
    rerender({ mode: 'url-only', queue: ['current', 'next', 'later'], track: { id: 'current' } });
    expect(audio.getAttribute('src')).toBeNull();
    expect(audio2.getAttribute('src')).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio2.pause).toHaveBeenCalled();
  });

  it('keeps a loaded source that remains next after the current track advances', async () => {
    const { audio, audio2, rerender } = setup('current');
    await waitFor(() => expect(audio2.getAttribute('src')).toBe('/stream/later'));
    const loadsBeforeAdvance = audio2.load.mock.calls.length;

    rerender({ mode: 'current', queue: ['current', 'next', 'later'], track: { id: 'next' } });

    expect(audio.getAttribute('src')).toBeNull();
    expect(audio2.getAttribute('src')).toBe('/stream/later');
    expect(audio2.load).toHaveBeenCalledTimes(loadsBeforeAdvance);
    expect(apiMock.ensureStreamUrl).toHaveBeenCalledTimes(3);
    expect(apiMock.ensureStreamUrl.mock.calls[2][0].id).toBe('current');
  });
});
