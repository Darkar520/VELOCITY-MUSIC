import React, { Profiler } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlayerBar } from '../../player/PlayerBar.jsx';
import { MiniPlayerBar } from '../../player/MiniPlayerBar.jsx';
import { usePlayerStore } from '../../store/playerStore.js';
import { T, resetStores, seedPlaying } from '../../__tests__/uiFixtures.js';
import { useAppUpdate } from '../useAppUpdate.js';

function visibility(value) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => { resetStores(); vi.useFakeTimers(); visibility('visible'); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); delete document.visibilityState; });

it('keeps native progress in the store without rendering hidden player clocks, then catches up', () => {
  seedPlaying();
  const commits = vi.fn();
  render(<Profiler id="players" onRender={commits}><PlayerBar T={T} /><MiniPlayerBar T={T} /></Profiler>);
  act(() => visibility('hidden'));
  const baseline = commits.mock.calls.length;
  for (let i = 1; i <= 20; i++) act(() => usePlayerStore.getState().setTime(i));
  expect(usePlayerStore.getState().time).toBe(20);
  expect(commits).toHaveBeenCalledTimes(baseline);
  act(() => visibility('visible'));
  expect(screen.getByText('0:20')).toBeTruthy();
});

it('does not poll app versions while hidden and deduplicates return/focus checks', async () => {
  const script = document.createElement('script');
  script.src = '/assets/index-current.js';
  document.head.appendChild(script);
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '<script src="/assets/index-current.js"></script>' }));
  vi.stubGlobal('fetch', fetchMock);
  visibility('hidden');
  renderHook(() => useAppUpdate({ playing: true }));
  await act(() => vi.advanceTimersByTimeAsync(120000));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => { visibility('visible'); window.dispatchEvent(new Event('focus')); });
  expect(fetchMock).toHaveBeenCalledOnce();
  script.remove();
});
