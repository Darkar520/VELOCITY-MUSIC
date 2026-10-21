import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api.js';

const params = { artist: 'Artist', title: 'Song', id: 'track-1', quality: 'high' };
const sourceUrl = `https://rr1.googlevideo.com/videoplayback?expire=${Math.floor(Date.now() / 1000) + 900}&mime=audio%2Fwebm`;

function responseFor(overrides = {}) {
  return {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sig: 'signed-proxy-test',
    provider: 'youtube',
    proxyUrl: '/api/stream-proxy?transport=2&exp=1&sig=signed-proxy-test',
    directUrl: sourceUrl,
    directExpiresAt: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.removeItem('velocity.directPlaybackSessionFailures');
  api._streamSignCache.clear();
  api._streamSignInflight.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(responseFor()),
  })));
});

afterEach(() => {
  api._streamSignCache.clear();
  api._streamSignInflight.clear();
  sessionStorage.removeItem('velocity.directPlaybackSessionFailures');
  vi.unstubAllGlobals();
});

it('auto tries the direct URL first and blocks that provider for this session after failure', async () => {
  const selected = await api.ensureStreamUrl(params, { playbackMode: 'auto' });
  expect(selected).toBe(sourceUrl);
  expect(new URL(fetch.mock.calls[0][0], location.href).searchParams.get('playbackMode')).toBe('auto');
  expect(api.recordDirectPlaybackFailure(selected)).toBe(true);
  expect(api.hasDirectPlaybackFailure('youtube')).toBe(true);
  expect(api.peekPlaybackUrl(params, 10, 'auto')).toBe('/api/stream-proxy?transport=2&exp=1&sig=signed-proxy-test');
  expect(await api.ensureStreamUrl(params, { playbackMode: 'auto' })).toBe('/api/stream-proxy?transport=2&exp=1&sig=signed-proxy-test');
  expect(fetch).toHaveBeenCalledOnce();
});

it('experimental direct mode can retry after a failed auto source and success clears the session block', async () => {
  await api.ensureStreamUrl(params, { playbackMode: 'auto' });
  api.recordDirectPlaybackFailure(sourceUrl);
  const direct = await api.ensureStreamUrl(params, { playbackMode: 'direct-experimental' });
  expect(direct).toBe(sourceUrl);
  expect(api.isDirectPlaybackUrl(direct)).toBe(true);
  expect(api.recordDirectPlaybackSuccess(direct)).toBe(true);
  expect(api.hasDirectPlaybackFailure('youtube')).toBe(false);
  expect(api.peekPlaybackUrl(params, 10, 'auto')).toBe(sourceUrl);
});

it('falls back to the signed proxy for untrusted or nearly expired direct URLs', async () => {
  const proxy = '/api/stream-proxy?transport=2&exp=1&sig=signed-proxy-test';
  fetch.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(responseFor({
      directUrl: 'https://googlevideo.com.attacker.example/audio.mp3',
      directExpiresAt: Math.floor(Date.now() / 1000) + 300,
    })),
  }));
  expect(await api.ensureStreamUrl(params, { playbackMode: 'direct-experimental' })).toBe(proxy);

  api._streamSignCache.clear();
  fetch.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(responseFor({ directExpiresAt: Math.floor(Date.now() / 1000) + 5 })),
  }));
  expect(await api.ensureStreamUrl({ ...params, id: 'track-2' }, { playbackMode: 'direct-experimental' })).toBe(proxy);
});

it('marks only an allowed provider as compatible and never stores a source URL', () => {
  expect(api.recordDirectPlaybackSuccess('http://rr1.googlevideo.com/audio')).toBe(false);
  expect(api.recordDirectPlaybackSuccess('https://googlevideo.com.attacker.example/audio')).toBe(false);
  expect(api.recordDirectPlaybackFailure('https://googlevideo.com.attacker.example/audio')).toBe(false);
  expect(sessionStorage.getItem('velocity.directPlaybackSessionFailures')).toBeNull();
});
