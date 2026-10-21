import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { compatiblePlaybackQuality, canUseOfflineAudio, DEFAULT_PLAYBACK_QUALITY } from '../audio/playbackFormat.js';
import { usePersisted } from '../hooks.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.removeItem('velocity.quality'); });
it.each(['high', 'medium', 'low'])('preserves %s tier while requesting an AAC-only source', quality => {
  expect(compatiblePlaybackQuality(quality, { webm: false, aac: true })).toBe(`${quality}-aac`);
});
it.each([{ webm: true, aac: true }, { webm: false, aac: false }])('retains the original profile for WebM or unknown capabilities: %j', capabilities => {
  expect(compatiblePlaybackQuality('high', capabilities)).toBe('high');
});
it('keeps explicit profiles idempotent', () => {
  expect(compatiblePlaybackQuality('high-aac', { webm: false, aac: true })).toBe('high-aac');
});
it('uses medium for new profiles while preserving explicit quality tiers', () => {
  expect(DEFAULT_PLAYBACK_QUALITY).toBe('medium');
  expect(compatiblePlaybackQuality(undefined, { webm: true, aac: true })).toBe('medium');
  expect(compatiblePlaybackQuality(undefined, { webm: false, aac: true })).toBe('medium-aac');
  expect(compatiblePlaybackQuality(undefined, { webm: false, aac: false })).toBe('medium');
  expect(compatiblePlaybackQuality('high', { webm: true, aac: true })).toBe('high');
});
it('defaults a new profile to medium and leaves a persisted quality intact', () => {
  const newProfile = renderHook(() => usePersisted('velocity.quality', DEFAULT_PLAYBACK_QUALITY));
  expect(newProfile.result.current[0]).toBe('medium');
  newProfile.unmount();

  localStorage.setItem('velocity.quality', JSON.stringify('high'));
  const existingProfile = renderHook(() => usePersisted('velocity.quality', DEFAULT_PLAYBACK_QUALITY));
  expect(existingProfile.result.current[0]).toBe('high');
  expect(localStorage.getItem('velocity.quality')).toBe(JSON.stringify('high'));
});
it('keeps known compatible and unknown offline files but rejects a positively incompatible WebM', () => {
  const aacOnly = { webm: false, aac: true };
  expect(canUseOfflineAudio({ type: 'audio/webm' }, aacOnly)).toBe(false);
  expect(canUseOfflineAudio({ type: 'audio/mp4' }, aacOnly)).toBe(true);
  expect(canUseOfflineAudio({ type: 'audio/webm' }, { webm: true, aac: true })).toBe(true);
  expect(canUseOfflineAudio({ type: 'audio/webm' }, { webm: false, aac: false })).toBe(true);
});

it('signs, caches and downloads the same capability profile without rewriting signed parameters', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(type => type.startsWith('audio/mp4') ? 'probably' : '');
  vi.resetModules();
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sig: 'test' }) }));
  vi.stubGlobal('fetch', fetchMock);
  const { api } = await import('../api.js');
  const params = { id: 'aac-test', artist: 'Artist', title: 'Song', quality: 'high' };
  const signed = await api.ensureStreamUrl(params);
  expect(new URL(fetchMock.mock.calls[0][0], location.href).searchParams.get('quality')).toBe('high-aac');
  expect(new URL(signed, location.href).searchParams.get('quality')).toBe('high-aac');
  expect(api.peekStreamUrl(params)).toBe(signed);
  const download = await api.signDownloadUrl(params);
  expect(new URL(download, location.href).searchParams.get('quality')).toBe('high-aac');
  await api.prefetchStream(params);
  expect(new URL(fetchMock.mock.calls.at(-1)[0], location.href).searchParams.get('quality')).toBe('high-aac');
  expect(api.buildSignedStreamUrl({ ...params, exp: 1, sig: 'old-signature' })).toContain('quality=high&');
});
