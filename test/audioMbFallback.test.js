/**
 * audioMbFallback.test.js — cadena de 3 intentos en audioResolver.
 *
 * Verde garantiza: cuando el extractor primario (tier 1: YTM con query original)
 * falla, audioResolver hace hasta 2 intentos extra con query MB-canonical:
 *   tier 2: YTM con query limpia
 *   tier 3: YouTube plano con query limpia
 *
 * Cubre tambien backwards-compat: sin `mbEnrich`, comportamiento = 1 intento.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ResolveError } from '../src/services/audioResolver.js';

// CatalogImpl dummy (no se usa en estos tests).
const catalogImpl = null;

// Fake cache: simple Map. No tocar el real.
function fakeCache() {
  const store = new Map();
  return {
    get: (k) => store.get(k) || null,
    set: (k, v) => store.set(k, v),
    keyFor: (a, t) => `${a}:${t}`,
  };
}

/** Construye un extractor mock que devuelve URLs según sourcePool y query. */
function makeExtractor(plan) {
  // plan: array of { matches: (params) => boolean, returns: string|null }
  // Cada llamada pasa al siguiente plan del array (consume uno por llamada).
  const calls = [];
  return {
    impl: async ({ sourcePool = 'ytm', query, videoId, artist, title }) => {
      const called = { sourcePool, query, videoId, artist, title, n: calls.length };
      calls.push(called);
      const step = plan[calls.length - 1];
      if (!step) return null;
      return step.returns;
    },
    calls,
  };
}

/** MB mock: devuelve el dato canónico dado. */
function mbEnrichReturn(data) {
  return async ({ artist, title, duration }) => data;
}

test('Cadena MB: tier 1 success -> no llama tiers 2 ni 3', async () => {
  const ex = makeExtractor([
    { returns: 'https://audio.ytm.example/stream1' },
    { returns: 'https://should-not-reach.example/' },
  ]);
  const r = await resolve(
    { artist: 'LP', title: 'Lost On You' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: mbEnrichReturn({ mbid: 'uuid-1', year: 2016, albumName: 'Lost On You' }),
      fallbackChain: true,
    },
  );
  assert.equal(r.status, 302);
  assert.equal(r.url, 'https://audio.ytm.example/stream1');
  assert.equal(ex.calls.length, 1, 'tier 1 success debe cortar la cadena');
  assert.equal(ex.calls[0].sourcePool, 'ytm', 'tier 1 explicitamente pide pool ytm');
  restore();
});

test('Cadena MB: tier 1 fail + tier 2 (YTM-clean) success -> no llama tier 3', async () => {
  const ex = makeExtractor([
    { returns: null },
    { returns: 'https://audio.ytm.example/clean-query' },
    { returns: 'https://should-not-reach.example/' },
  ]);
  const r = await resolve(
    { artist: 'LP', title: 'Lost On You (Official Video)' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: mbEnrichReturn({ mbid: 'uuid-1', year: 2016, albumName: 'Lost On You' }),
      fallbackChain: true,
    },
  );
  assert.equal(r.status, 302);
  assert.equal(r.url, 'https://audio.ytm.example/clean-query');
  assert.equal(ex.calls.length, 2, '2 tier ejecutados, no mas');
  assert.equal(ex.calls[1].sourcePool, 'ytm', 'tier 2 sigue siendo ytm');
  assert.ok(ex.calls[1].query, 'tier 2 usa query canonica limpia');
  assert.equal(r.mbid, 'uuid-1', 'respuesta trae MBID del enriquecido');
  assert.equal(r.mbEnriched, true);
  restore();
});

test('Cadena MB: tier 1 + tier 2 fail -> tier 3 (YT-plan) success', async () => {
  const ex = makeExtractor([
    { returns: null },
    { returns: null },
    { returns: 'https://audio.plain-yt.example/cover-version' },
    { returns: 'https://should-not-reach.example/' },
  ]);
  const r = await resolve(
    { artist: 'Metallica', title: 'One' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: mbEnrichReturn({ mbid: 'uuid-metallica-one', year: 1988, albumName: '...And Justice for All' }),
      fallbackChain: true,
    },
  );
  assert.equal(r.status, 302);
  assert.equal(r.url, 'https://audio.plain-yt.example/cover-version');
  assert.equal(ex.calls.length, 3, '3 tier ejecutados (cadena completa)');
  assert.equal(ex.calls[1].sourcePool, 'ytm', 'tier 2 ytm');
  assert.equal(ex.calls[2].sourcePool, 'yt', 'tier 3 yt plano');
  assert.ok(ex.calls[2].query, 'tier 3 usa query canonica');
  restore();
});

test('Cadena MB: 3 tiers fallan -> estado degraded (no throw, no 404)', async () => {
  const ex = makeExtractor([
    { returns: null },
    { returns: null },
    { returns: null },
  ]);
  const r = await resolve(
    { artist: 'X', title: 'Y' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: mbEnrichReturn({ mbid: 'u', year: 2020, albumName: 'Z' }),
      fallbackChain: true,
    },
  );
  assert.equal(r.status, 'degraded', '3 fallos -> degraded');
  assert.equal(ex.calls.length, 3, 'no mas de 3 resoluciones');
  restore();
});

test('Cadena MB: sin mbEnrich -> solo tier 1 (backwards compat)', async () => {
  const ex = makeExtractor([
    { returns: null },
    { returns: 'https://should-not-reach.example/' },
  ]);
  const r = await resolve(
    { artist: 'X', title: 'Y' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      // mbEnrich omitted
      fallbackChain: true,
    },
  );
  assert.equal(r.status, 'degraded');
  assert.equal(ex.calls.length, 1, 'sin mbEnrich -> solo 1 tier (comportamiento historico)');
  restore();
});

test('Cadena MB: mbEnrich devuelve null -> solo tier 1 + tier 3 con query original? no, se queda en tier 1', async () => {
  // Si MB no matchea (null), la query limpia no esta disponible. No hay tier 2/3
  // porque no hay query alternativa. La cadena colapsa a tier 1.
  const ex = makeExtractor([
    { returns: null },
    { returns: 'https://should-not-reach.example/' },
  ]);
  const r = await resolve(
    { artist: 'X', title: 'Y' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: async () => null, // MB no matcheo
      fallbackChain: true,
    },
  );
  assert.equal(r.status, 'degraded');
  assert.equal(ex.calls.length, 1, 'MB null -> sin query limpia -> no tiers 2/3');
  restore();
});

test('Cadena MB: fallback=false desactiva la cadena aunque mbEnrich venga', async () => {
  const ex = makeExtractor([
    { returns: null },
    { returns: 'https://should-not-reach.example/' },
  ]);
  const r = await resolve(
    { artist: 'X', title: 'Y' },
    {
      cache: fakeCache(),
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: mbEnrichReturn({ mbid: 'u', year: 2020, albumName: 'Z' }),
      fallbackChain: false,
    },
  );
  assert.equal(r.status, 'degraded');
  assert.equal(ex.calls.length, 1, 'fallbackChain=false desactiva tiers 2/3');
  restore();
});

test('Cadena MB: cache hit -> no se llama extractor (sin tocar cadena)', async () => {
  const cache = fakeCache();
  cache.set('X:Y', 'https://cached.example/');
  const ex = makeExtractor([{ returns: 'https://should-not-reach.example/' }]);
  const r = await resolve(
    { artist: 'X', title: 'Y' },
    {
      cache,
      mode: 'full',
      extractorImpl: ex.impl,
      timeoutMs: 30000,
      mbEnrich: mbEnrichReturn({ mbid: 'u', year: 2020, albumName: 'Z' }),
    },
  );
  assert.equal(r.status, 302);
  assert.equal(r.url, 'https://cached.example/');
  assert.equal(r.fromCache, true);
  assert.equal(ex.calls.length, 0, 'cache hit -> extractor definitivamente no se llama');
  restore();
});

function restore() {/* noop */}