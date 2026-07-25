import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  StreamCache,
  DEEZER_CACHE_TTL_SECONDS,
} from '../src/services/streamCache.js';

const RUNS = { numRuns: 100 };
const START_TIME_MS = 1_700_000_000_000;
const providerArb = fc.constantFrom('deezer', 'youtube', 'soundcloud');
const tokenArb = fc.string({ minLength: 1, maxLength: 32 });
const urlArb = fc.string({ minLength: 1, maxLength: 80 }).map(
  (suffix) => `https://cdn.test/audio/${encodeURIComponent(suffix)}.mp3`,
);

function withFakeClock(startMs, callback) {
  const realNow = Date.now;
  let now = startMs;
  Date.now = () => now;
  try {
    return callback({
      now: () => now,
      advance: (milliseconds) => { now += milliseconds; },
    });
  } finally {
    Date.now = realNow;
  }
}

function cacheKey(prefix, token) {
  return `${prefix}:${token}`;
}

// **Validates: Requirements 1.6**
test('Property 1: solo se invalidan URLs Deezer fallidas y coincidentes', () => {
  fc.assert(
    fc.property(
      tokenArb,
      urlArb,
      fc.boolean(),
      providerArb,
      (token, failedUrl, urlMatches, provider) => {
        const cache = new StreamCache();
        const key = cacheKey(provider === 'deezer' ? 'deezer' : provider, token);
        cache.set(key, failedUrl, { provider, ttlSeconds: 3600 });

        const reportedUrl = urlMatches ? failedUrl : `${failedUrl}-different`;
        const invalidated = cache.invalidateFailedUrl(key, reportedUrl);
        const expectedInvalidation = provider === 'deezer' && urlMatches;

        assert.equal(invalidated, expectedInvalidation);
        assert.equal(cache.get(key), expectedInvalidation ? null : failedUrl);
        assert.equal(cache.cache.has(key), !expectedInvalidation);
      }),
    RUNS,
  );
});

// **Validates: Requirements 1.6**
test('Property 2: las entradas Deezer expiran exactamente después del TTL configurado', () => {
  fc.assert(
    fc.property(
      tokenArb,
      urlArb,
      fc.integer({ min: 1, max: 86_400 }),
      fc.integer({ min: 0, max: 86_401 }),
      (token, url, ttlSeconds, elapsedSeconds) => withFakeClock(START_TIME_MS, (clock) => {
        const cache = new StreamCache();
        const key = cacheKey('deezer', token);
        cache.set(key, url, { provider: 'deezer', ttlSeconds });
        const item = cache.cache.get(key);

        assert.equal(item.expiresAt, START_TIME_MS + ttlSeconds * 1000);
        clock.advance(elapsedSeconds * 1000);

        const stillValid = elapsedSeconds <= ttlSeconds;
        assert.equal(cache.get(key), stillValid ? url : null);
        assert.equal(cache.cache.has(key), stillValid);
      }),
    ),
    RUNS,
  );

  // A Deezer entry without an explicit TTL receives the documented 24-hour TTL.
  withFakeClock(START_TIME_MS, (clock) => {
    const cache = new StreamCache();
    cache.set('deezer:default-ttl', 'https://cdn.test/default.mp3', { provider: 'deezer' });
    assert.equal(
      cache.cache.get('deezer:default-ttl').expiresAt,
      START_TIME_MS + DEEZER_CACHE_TTL_SECONDS * 1000,
    );
    clock.advance(DEEZER_CACHE_TTL_SECONDS * 1000 + 1);
    assert.equal(cache.get('deezer:default-ttl'), null);
  });
});

// **Validates: Requirements 1.6**
test('Property 3: getEntry conserva URL, proveedor y expiración de la entrada', () => {
  fc.assert(
    fc.property(
      tokenArb,
      urlArb,
      providerArb,
      fc.integer({ min: 1, max: 86_400 }),
      (token, url, provider, ttlSeconds) => withFakeClock(START_TIME_MS, () => {
        const cache = new StreamCache();
        const key = cacheKey(provider === 'deezer' ? 'deezer' : provider, token);
        cache.set(key, url, { provider, ttlSeconds });

        const entry = cache.getEntry(key);
        assert.deepEqual(entry, {
          value: url,
          provider,
          expiresAt: START_TIME_MS + ttlSeconds * 1000,
        });
        // The compatibility API still returns only the URL string.
        assert.equal(cache.get(key), url);
      }),
    ),
    RUNS,
  );
});

// **Validates: Requirements 1.6, 1.9**
test('Property 4: estadísticas y hit ratio se agrupan por proveedor', () => {
  fc.assert(
    fc.property(
      tokenArb,
      urlArb,
      fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: 1, max: 20 }),
      (token, url, deezerHits, deezerMisses, otherHits, otherMisses) => {
        const cache = new StreamCache();
        const deezerKey = cacheKey('deezer', token);
        const otherKey = cacheKey('youtube', token);
        const missingDeezerKey = cacheKey('deezer-missing', token);
        const missingOtherKey = cacheKey('youtube-missing', token);
        cache.set(deezerKey, url, { provider: 'deezer', ttlSeconds: 3600 });
        cache.set(otherKey, `${url}-other`, { provider: 'youtube', ttlSeconds: 3600 });

        for (let index = 0; index < deezerHits; index++) assert.equal(cache.get(deezerKey), url);
        for (let index = 0; index < deezerMisses; index++) {
          assert.equal(cache.get(missingDeezerKey, { provider: 'deezer' }), null);
        }
        for (let index = 0; index < otherHits; index++) assert.equal(cache.get(otherKey), `${url}-other`);
        for (let index = 0; index < otherMisses; index++) {
          assert.equal(cache.get(missingOtherKey, { provider: 'youtube' }), null);
        }

        const stats = cache.getStatsByProvider();
        const expectedDeezerRatio = deezerHits / (deezerHits + deezerMisses);
        const expectedOtherRatio = otherHits / (otherHits + otherMisses);
        assert.deepEqual(stats.deezer, {
          entries: 1,
          hits: deezerHits,
          misses: deezerMisses,
          hitRatio: expectedDeezerRatio,
        });
        assert.deepEqual(stats.youtube, {
          entries: 1,
          hits: otherHits,
          misses: otherMisses,
          hitRatio: expectedOtherRatio,
        });
        assert.equal(cache.getHitRatioByProvider('deezer'), expectedDeezerRatio);
        assert.equal(cache.getProviderHitRatio('youtube'), expectedOtherRatio);
      }),
    RUNS,
  );
});
