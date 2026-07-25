import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ResolveError } from '../src/services/audioResolver.js';
import { StreamCache } from '../src/services/streamCache.js';

const TRACK = { artist: 'Fallback Artist', title: 'Fallback Song' };
const YOUTUBE_URL = 'https://youtube.example/audio';
const DEEZER_URL = 'https://deezer.example/audio';

function cacheKeys(cache) {
  const base = cache.keyFor(TRACK.artist, TRACK.title);
  return { base, deezer: `deezer:${base}` };
}

test('fallback: YouTube Music exitoso conserva prioridad sobre Deezer', async () => {
  const cache = new StreamCache();
  let deezerCalls = 0;

  const result = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl: async () => YOUTUBE_URL,
    deezerExtractorImpl: async () => {
      deezerCalls += 1;
      return DEEZER_URL;
    },
  });

  assert.deepEqual(result, {
    status: 302,
    url: YOUTUBE_URL,
    fromCache: false,
    mode: 'full',
  });
  assert.equal(deezerCalls, 0);
});

test('fallback: fallo de YouTube Music resuelve con Deezer y metadata del proveedor', async () => {
  const cache = new StreamCache();
  let youtubeCalls = 0;

  const result = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl: async () => {
      youtubeCalls += 1;
      throw new Error('YouTube no disponible');
    },
    deezerExtractorImpl: async ({ artist, title }) => {
      assert.equal(artist, TRACK.artist);
      assert.equal(title, TRACK.title);
      return DEEZER_URL;
    },
  });

  assert.deepEqual(result, {
    status: 302,
    url: DEEZER_URL,
    provider: 'deezer',
    fromCache: false,
    mode: 'full',
  });
  assert.equal(youtubeCalls, 1);
});

test('fallback: ambos proveedores fallan y devuelve degradación/error sin cachear', async () => {
  const cache = new StreamCache();
  const result = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl: async () => null,
    deezerExtractorImpl: async () => {
      throw new Error('Deezer no disponible');
    },
  });

  assert.equal(result.status, 'degraded');
  assert.equal(result.mode, 'degraded');
  assert.equal(cache.size(), 0);

  await assert.rejects(
    () => resolve(TRACK, { cache, mode: 'full' }),
    (error) => error instanceof ResolveError && error.status === 404,
  );
});

test('fallback: forceRefresh ignora la caché específica de Deezer', async () => {
  const cache = new StreamCache();
  const calls = [];
  const extractorImpl = async () => null;
  const deezerExtractorImpl = async () => {
    const url = calls.length === 0 ? 'https://deezer.example/old' : 'https://deezer.example/fresh';
    calls.push(url);
    return url;
  };

  const first = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl,
    deezerExtractorImpl,
  });
  const cached = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl,
    deezerExtractorImpl,
  });
  const refreshed = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl,
    deezerExtractorImpl,
    forceRefresh: true,
  });

  assert.equal(first.url, 'https://deezer.example/old');
  assert.equal(cached.url, 'https://deezer.example/old');
  assert.equal(cached.fromCache, true);
  assert.equal(refreshed.url, 'https://deezer.example/fresh');
  assert.equal(refreshed.fromCache, false);
  assert.deepEqual(calls, ['https://deezer.example/old', 'https://deezer.example/fresh']);
});

test('fallback: las claves primaria y Deezer no colisionan', async () => {
  const cache = new StreamCache();
  const { base, deezer } = cacheKeys(cache);

  const deezerResult = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl: async () => null,
    deezerExtractorImpl: async () => DEEZER_URL,
  });

  assert.equal(deezerResult.provider, 'deezer');
  assert.equal(cache.get(base), null);
  assert.equal(cache.get(deezer), DEEZER_URL);

  const youtubeResult = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl: async () => YOUTUBE_URL,
    deezerExtractorImpl: async () => {
      throw new Error('Deezer no debería ser necesario');
    },
  });

  assert.equal(youtubeResult.url, YOUTUBE_URL);
  assert.equal(youtubeResult.provider, undefined);
  assert.equal(youtubeResult.fromCache, false);
  assert.equal(cache.get(base), YOUTUBE_URL);
  assert.equal(cache.get(deezer), DEEZER_URL);
});

test('fallback: SoundCloud y expansión de catálogo no entran en la cadena de audio', async () => {
  const cache = new StreamCache();
  let catalogCalls = 0;
  let soundCloudLikeCalls = 0;

  const catalogImpl = async () => {
    catalogCalls += 1;
    return [{ source: 'soundcloud', streamUrl: 'https://soundcloud.example/audio' }];
  };
  const soundCloudLikeExtractor = async () => {
    soundCloudLikeCalls += 1;
    return 'https://soundcloud.example/audio';
  };

  const fallbackResult = await resolve(TRACK, {
    cache,
    mode: 'full',
    extractorImpl: async () => null,
    deezerExtractorImpl: async () => DEEZER_URL,
    catalogImpl,
  });

  assert.equal(fallbackResult.url, DEEZER_URL);
  assert.equal(fallbackResult.provider, 'deezer');
  assert.equal(catalogCalls, 0);
  assert.equal(soundCloudLikeCalls, 0);

  const explicitSoundCloud = await resolve(
    { ...TRACK, stream: 'https://soundcloud.example/audio' },
    {
      cache: new StreamCache(),
      mode: 'full',
      extractorImpl: soundCloudLikeExtractor,
      deezerExtractorImpl: async () => DEEZER_URL,
      catalogImpl,
    },
  );

  assert.equal(explicitSoundCloud.url, 'https://soundcloud.example/audio');
  assert.equal(explicitSoundCloud.provider, undefined);
  assert.equal(soundCloudLikeCalls, 0);
  assert.equal(catalogCalls, 0);
});
