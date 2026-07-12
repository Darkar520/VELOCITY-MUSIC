/**
 * musicbrainz.test.js — tests del extractor MusicBrainz.
 *
 * Sin red: usa un stub de `fetch` global que graba las URLs pedidas y devuelve
 * respuestas pre-grabadas. Cubre:
 *  - throttle rolling 1 req/seg (≥1s entre llamadas seriales).
 *  - enrichTrack matchea por título+artista, no matchea con score<5.
 *  - searchTrack/manejo de respuestas vacías o null (red caída -> null).
 *  - getReleaseTracks mapea media/tracks correctamente.
 *  - lookupByMBID devuelve null ante 404.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichTrack, searchTrack, lookupByMBID, getReleaseTracks, __resetThrottleForTests } from '../src/extractors/musicbrainz.js';

// ─── Stub de fetch ─────────────────────────────────────────────────
const _origFetch = global.fetch;

function mockFetch(routes) {
  // routes: Map<urlSubstring, responseBody | {status, body} | null-throws>
  // Trackea timestamps de las llamadas para el test de throttle.
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, at: Date.now() });
    for (const [sub, resp] of routes) {
      if (url.includes(sub)) {
        if (resp === null) throw new Error('network down');
        if (resp?.status) {
          return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, json: async () => resp.body };
        }
        return { ok: true, status: 200, json: async () => resp };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return calls;
}

function restoreFetch() { global.fetch = _origFetch; }

test('MusicBrainz: throttle respeta 1 req/seg entre llamadas seriales', async () => {
  __resetThrottleForTests();
  const calls = mockFetch(new Map([
    ['/recording?', { recordings: [] }],
  ]));
  const t0 = Date.now();
  await searchTrack({ artist: 'LP', title: 'Lost On You' });
  await searchTrack({ artist: 'LP', title: 'Other Song' });
  await searchTrack({ artist: 'LP', title: 'Third Track' });
  const elapsed = Date.now() - t0;

  // 3 llamadas con throttle 1req/seg: minimo ~2.2s (gap entre 1-2 y 2-3).
  // Allow ~2.1s_lower_bound por margen de setTimeout.
  assert.ok(elapsed >= 2100, `3 llamadas seriales debieron tardar >=2.1s, tardaron ${elapsed}ms`);
  assert.ok(calls.length === 3, `3 fetches hechos, no ${calls.length}`);

  // Diferencia entre la 1ra y 2da llamada >= 1000ms (throttle rolling).
  const gap1 = calls[1].at - calls[0].at;
  const gap2 = calls[2].at - calls[1].at;
  assert.ok(gap1 >= 950, `gap 1->2 debe ser >=1s, fue ${gap1}ms`);
  assert.ok(gap2 >= 950, `gap 2->3 debe ser >=1s, fue ${gap2}ms`);
  restoreFetch();
});

test('MusicBrainz: enrichTrack devuelve null ante red caída (no throw)', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/recording?', null]])); // null => throws en fetch -> caught
  const e = await enrichTrack({ artist: 'LP', title: 'Lost On You' });
  assert.equal(e, null, 'red caída -> null silencioso');
  restoreFetch();
});

test('MusicBrainz: enrichTrack matchea por título+artista canónico', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/recording?', {
    recordings: [
      {
        id: 'rec-uuid-1',
        title: 'Lost On You',
        'artist-credit': [{ name: 'LP' }],
        length: 243000, // 4:03 en ms
        releases: [{ id: 'rel-uuid-1', title: 'Lost On You', date: '2016-06-19' }],
      },
    ],
  }]]));
  const e = await enrichTrack({ artist: 'LP', title: 'Lost On You' });
  assert.ok(e, 'debe matchear');
  assert.equal(e.mbid, 'rec-uuid-1');
  assert.equal(e.year, 2016);
  assert.equal(e.albumName, 'Lost On You');
  assert.equal(e.mbSource, 'musicbrainz');
  restoreFetch();
});

test('MusicBrainz: enrichTrack rechaza match con score<5 (artista totalmente distinto)', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/recording?', {
    recordings: [
      {
        id: 'rec-uuid-2',
        title: 'Completely Different Song',
        'artist-credit': [{ name: 'Other Artist' }],
        length: 180000,
        releases: [],
      },
    ],
  }]]));
  const e = await enrichTrack({ artist: 'LP', title: 'Lost On You', duration: 243 });
  assert.equal(e, null, 'artista+titulo totalmente distintos no matchean');
  restoreFetch();
});

test('MusicBrainz: enrichTrack con duración ±2s suma score (bono)', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/recording?', {
    recordings: [
      {
        id: 'rec-uuid-3',
        title: 'Toxicity',
        'artist-credit': [{ name: 'System of a Down' }],
        length: 218000, // 3:38 (≈ real)
        releases: [{ id: 'rel-3', title: 'Toxicity', date: '2001-09-04' }],
      },
    ],
  }]]));
  const e = await enrichTrack({ artist: 'System of a Down', title: 'Toxicity', duration: 218 });
  assert.ok(e);
  assert.equal(e.mbid, 'rec-uuid-3');
  restoreFetch();
});

test('MusicBrainz: lookupByMBID devuelve null ante 404', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['nonexistent-mbid', { status: 404, body: {} }]]));
  const e = await lookupByMBID('nonexistent-mbid-xyz');
  assert.equal(e, null);
  restoreFetch();
});

test('MusicBrainz: getReleaseTracks mapea media/tracks', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release/', {
    id: 'rel-uuid-99',
    title: 'Album X',
    date: '2012-01-01',
    'artist-credit': [{ name: 'LP' }],
    media: [
      {
        track: [
          { id: 'tr-1', title: 'Song A', length: 240000 },
          { id: 'tr-2', title: 'Song B', length: 200000 },
        ],
      },
    ],
  }]]));
  const tracks = await getReleaseTracks('rel-uuid-99');
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].mbid, 'tr-1');
  assert.equal(tracks[0].artist, 'LP');
  assert.equal(tracks[0].album, 'Album X');
  assert.equal(tracks[1].durationSeconds, 200);
  // Sin videoId YTM (MB no entrega audio)
  assert.equal(tracks[0].id, null);
  assert.equal(tracks[0].mbSource, 'musicbrainz');
  restoreFetch();
});

test('MusicBrainz: getReleaseTracks ante red caída devuelve []', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release/', null]]));
  const tracks = await getReleaseTracks('whatever-uuid');
  assert.deepEqual(tracks, []);
  restoreFetch();
});