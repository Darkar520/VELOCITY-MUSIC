import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { DeezerProvider } from '../src/extractors/deezer.js';
import { DeezerHttpClient } from '../src/extractors/deezerHttp.js';

const RUNS = { numRuns: 100 };
const QUALITIES = ['MP3_128', 'MP3_320', 'FLAC'];
const QUALITY_RANK = { MP3_128: 0, MP3_320: 1, FLAC: 2 };
const silentLogger = { warn() {} };

function tokenDouble() {
  return {
    async getToken() { return null; },
    async invalidateToken() {},
    async refreshToken() { return null; },
  };
}

function providerWith(httpClient, parser) {
  return new DeezerProvider({
    httpClient,
    parser,
    tokenManager: tokenDouble(),
    logger: silentLogger,
    timeoutMs: 60_000,
  });
}

function streamResponse(qualities) {
  return {
    streams: qualities.map((quality) => ({
      format: quality,
      url: `https://cdn.test/audio/${quality.toLowerCase()}.bin`,
    })),
  };
}

function qualityFromUrl(url) {
  const match = /audio\/(mp3_128|mp3_320|flac)\.bin$/i.exec(url);
  return match ? match[1].toUpperCase() : null;
}

function deduplicateTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    const key = `${track.id}|${track.title}|${track.artist}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// **Validates: Requirements 1.1, 1.2**
test('Property 1: la selección de calidad es monotónica', async () => {
  const qualityPairArb = fc.integer({ min: 0, max: 1 }).map((index) => ({
    lower: QUALITIES[index],
    higher: QUALITIES[index + 1],
  }));
  const availableArb = fc.array(fc.constantFrom(...QUALITIES), { minLength: 1, maxLength: 6 })
    .map((qualities) => [...new Set(qualities)]);

  await fc.assert(
    fc.asyncProperty(qualityPairArb, availableArb, async ({ lower, higher }, available) => {
      const httpClient = {
        async getStreamUrl() { return streamResponse(available); },
      };
      const provider = providerWith(httpClient);
      const lowerUrl = await provider.getStreamUrl({ id: 'track-1' }, lower);
      const higherUrl = await provider.getStreamUrl({ id: 'track-1' }, higher);
      const lowerQuality = qualityFromUrl(lowerUrl);
      const higherQuality = qualityFromUrl(higherUrl);

      assert.ok(lowerQuality);
      assert.ok(higherQuality);

      // La calidad devuelta para una solicitud más alta debe ser
      // igual o mejor que la devuelta para una solicitud más baja
      // Esto se cumple porque ambos usan la misma lista de calidades disponibles
      // y el algoritmo selecciona la mejor calidad disponible en el orden de fallback
      assert.ok(QUALITY_RANK[higherQuality] >= QUALITY_RANK[lowerQuality]);
    }),
    RUNS,
  );
});

const trackArb = fc.record({
  id: fc.oneof(fc.integer({ min: 1, max: 100_000 }), fc.string({ minLength: 1, maxLength: 20 })),
  title: fc.string({ minLength: 1, maxLength: 30 }),
  artist: fc.string({ minLength: 1, maxLength: 30 }),
});

// **Validates: Requirements 1.1**
test('Property 2: la deduplicación de resultados de búsqueda es idempotente', async () => {
  const searchTracksArb = fc.tuple(
    trackArb,
    fc.array(trackArb, { minLength: 0, maxLength: 19 }),
  ).map(([duplicate, rest]) => [duplicate, duplicate, ...rest]);

  await fc.assert(
    fc.asyncProperty(searchTracksArb, async (tracks) => {
      const parser = {
        parseSearchResponse() { return tracks; },
      };
      const provider = providerWith({
        async search() { return { data: tracks }; },
      }, parser);
      const results = await provider.searchTracks('generated query', tracks.length);
      const once = deduplicateTracks(results);
      const twice = deduplicateTracks(once);

      assert.deepEqual(twice, once);
      assert.ok(once.length >= 1);
      assert.equal(once.length, new Set(results.map((track) => `${track.id}|${track.title}|${track.artist}`)).size);
      assert.ok(once.length < results.length);
    }),
    RUNS,
  );
});

const errorCaseArb = fc.constantFrom(
  { category: 'network', name: 'TypeError', status: undefined },
  { category: 'auth', name: 'AuthenticationError', status: 401 },
  { category: 'rate-limit', name: 'RateLimitError', status: 429 },
  { category: 'not-found', name: 'NotFoundError', status: 404 },
  { category: 'api', name: 'ApiError', status: 500 },
);
const operationArb = fc.constantFrom('searchTracks', 'getStreamUrl', 'getTrackById', 'getAlbum', 'getArtist');

function equivalentError(spec) {
  const error = new Error(`${spec.category} failure`);
  error.name = spec.name;
  if (spec.status !== undefined) error.status = spec.status;
  return error;
}

async function invokeOperation(provider, operation) {
  if (operation === 'searchTracks') return provider.searchTracks('generated query', 3);
  if (operation === 'getStreamUrl') return provider.getStreamUrl({ id: 'track-1' }, 'MP3_320');
  if (operation === 'getTrackById') return provider.getTrackById('track-1');
  if (operation === 'getAlbum') return provider.getAlbum('album-1');
  return provider.getArtist('artist-1');
}

// **Validates: Requirements 1.4, 1.6**
test('Property 3: la clasificación observable de errores es consistente', async () => {
  await fc.assert(
    fc.asyncProperty(errorCaseArb, operationArb, async (errorSpec, operation) => {
      const makeProvider = () => providerWith({
        async search() { throw equivalentError(errorSpec); },
        async getStreamUrl() { throw equivalentError(errorSpec); },
        async getTrack() { throw equivalentError(errorSpec); },
        async getAlbum() { throw equivalentError(errorSpec); },
        async getArtist() { throw equivalentError(errorSpec); },
      });
      const first = await invokeOperation(makeProvider(), operation);
      const second = await invokeOperation(makeProvider(), operation);
      const expected = operation === 'searchTracks' ? [] : null;

      assert.deepEqual(first, expected);
      assert.deepEqual(second, expected);
      assert.deepEqual(first, second);
    }),
    RUNS,
  );
});

// **Validates: Requirements 1.1, 1.2**
test('Property 4: el proveedor cumple la interfaz de extractor requerida', () => {
  fc.assert(
    fc.property(
      fc.record({ timeoutMs: fc.integer({ min: 1, max: 60_000 }), quality: fc.constantFrom(...QUALITIES) }),
      ({ timeoutMs, quality }) => {
        const provider = new DeezerProvider({
          timeoutMs,
          quality,
          httpClient: {},
          tokenManager: tokenDouble(),
          logger: silentLogger,
        });
        for (const method of ['searchTracks', 'getStreamUrl', 'getTrackById', 'getAlbum', 'getArtist']) {
          assert.equal(typeof provider[method], 'function', method);
        }
      },
    ),
    RUNS,
  );
});

// **Validates: Requirements 1.4**
test('Property 5: el backoff ante respuestas rate-limit crece exponencialmente', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (retryAttempts) => {
      const delays = [];
      const realSetTimeout = globalThis.setTimeout;
      const timeoutMs = 60_000;
      const expectedBackoff = Array.from(
        { length: retryAttempts },
        (_, attempt) => 250 * (2 ** attempt),
      );
      globalThis.setTimeout = (callback, delay, ...args) => {
        delays.push(delay);
        const isBackoff = expectedBackoff.includes(delay);
        return realSetTimeout(callback, isBackoff ? 0 : delay, ...args);
      };

      try {
        const httpClient = new DeezerHttpClient({
          retryAttempts,
          timeoutMs,
          fetchImpl: async () => ({ ok: false, status: 429 }),
          logger: silentLogger,
        });
        const provider = providerWith(httpClient);
        const result = await provider.getTrackById('track-1');
        const observedBackoff = delays.filter((delay) => expectedBackoff.includes(delay));

        assert.equal(result, null);
        assert.deepEqual(observedBackoff, expectedBackoff);
        assert.ok(observedBackoff.every((delay, index) => index === 0 || delay > observedBackoff[index - 1]));
      } finally {
        globalThis.setTimeout = realSetTimeout;
      }
    }),
    RUNS,
  );
});
