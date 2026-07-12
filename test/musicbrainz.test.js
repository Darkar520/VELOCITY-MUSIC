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
import { enrichTrack, searchTrack, lookupByMBID, getReleaseTracks, enrichAlbum, __resetThrottleForTests } from '../src/extractors/musicbrainz.js';

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

// ─── Bug 2: enrichAlbum + getReleaseTracks ampliado ─────────────────

test('MusicBrainz: enrichAlbum devuelve releaseMBID prefiriendo Album sobre Live', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release?', {
    releases: [
      {
        id: 'live-uuid',
        title: 'Live atMSG',
        'artist-credit': [{ name: 'Linkin Park', artist: { id: 'lp-mbid' } }],
        'release-group': { 'primary-type': 'Live' },
        date: '2010-01-01',
      },
      {
        id: 'studio-uuid',
        title: 'Hybrid Theory',
        'artist-credit': [{ name: 'Linkin Park', artist: { id: 'lp-mbid' } }],
        'release-group': { 'primary-type': 'Album' },
        date: '2000-10-24',
      },
    ],
  }]]));
  const r = await enrichAlbum({ artist: 'Linkin Park', albumName: 'Hybrid Theory' });
  assert.ok(r);
  assert.equal(r.releaseMBID, 'studio-uuid',
    'Album debe ganar sobre Live del mismo artista');
  assert.equal(r.isLive, false, 'Album de estudio -> isLive false');
  assert.equal(r.year, 2000);
  assert.equal(r.artistMBID, 'lp-mbid');
  restoreFetch();
});

test('MusicBrainz: enrichAlbum sin match devuelve null', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release?', {
    releases: [{
      id: 'other-uuid',
      title: 'Completely Different Album',
      'artist-credit': [{ name: 'Other Artist' }],
      'release-group': { 'primary-type': 'Album' },
    }],
  }]]));
  const r = await enrichAlbum({ artist: 'LP', albumName: 'Hybrid Theory' });
  assert.equal(r, null, 'artista totalmente distinto -> null');
  restoreFetch();
});

test('MusicBrainz: enrichAlbum ante red caida devuelve null', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release?', null]]));
  const r = await enrichAlbum({ artist: 'LP', albumName: 'Anything' });
  assert.equal(r, null);
  restoreFetch();
});

test('MusicBrainz: getReleaseTracks ampliado trae trackNumber consecutivos', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release/', {
    id: 'rel-uuid-100',
    title: 'Hybrid Theory',
    date: '2000-10-24',
    'artist-credit': [{ name: 'Linkin Park' }],
    'release-group': { 'primary-type': 'Album' },
    media: [
      {
        track: [
          { id: 't1', title: 'Papercut', length: 183000 },
          { id: 't2', title: 'One Step Closer', length: 156000 },
          { id: 't3', title: 'With You', length: 200000 },
        ],
      },
      {
        track: [
          { id: 't4', title: 'Points of Authority', length: 200000 },
          { id: 't5', title: 'Crawling', length: 182000 },
        ],
      },
    ],
  }]]));
  const tracks = await getReleaseTracks('rel-uuid-100');
  assert.equal(tracks.length, 5);
  // trackNumber debe ser consecutivo 1..N a través de discos.
  assert.deepEqual(tracks.map((t) => t.trackNumber), [1, 2, 3, 4, 5]);
  assert.equal(tracks[3].title, 'Points of Authority');
  assert.equal(tracks[3].trackNumber, 4);
  // isLive: el album es Album (no Live) -> false.
  assert.equal(tracks[0].isLive, false);
  assert.equal(tracks[0].isCompilation, false);
  restoreFetch();
});

test('MusicBrainz: getReleaseTracks de Live trae isLive=true', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/release/', {
    id: 'live-rel-uuid',
    title: 'Live at Madison Square Garden',
    date: '2010-08-29',
    'artist-credit': [{ name: 'Linkin Park' }],
    'release-group': { 'primary-type': 'Live' },
    media: [{ track: [{ id: 'lt1', title: 'Papercut (Live)', length: 200000 }] }],
  }]]));
  const tracks = await getReleaseTracks('live-rel-uuid');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].isLive, true, 'Live album -> isLive true');
  restoreFetch();
});

test('MusicBrainz: enrichTrack ampliado trae isLive del release-group', async () => {
  __resetThrottleForTests();
  // Simula una busqueda de "Points of Authority" que primariamente matchea con
  // un album de studio (Album) y por ende isLive=false.
  mockFetch(new Map([['/recording?', {
    recordings: [
      {
        id: 'rec-ptauth-studio',
        title: 'Points of Authority',
        'artist-credit': [{ name: 'Linkin Park' }],
        length: 200000,
        releases: [{
          id: 'hybrid-theory-rel',
          title: 'Hybrid Theory',
          date: '2000-10-24',
          'release-group': { 'primary-type': 'Album' },
        }],
      },
    ],
  }]]));
  const e = await enrichTrack({ artist: 'Linkin Park', title: 'Points of Authority' });
  assert.ok(e);
  assert.equal(e.mbid, 'rec-ptauth-studio');
  assert.equal(e.albumName, 'Hybrid Theory');
  assert.equal(e.isLive, false, 'album de studio -> isLive false');
  restoreFetch();
});

test('MusicBrainz: enrichTrack detecta Live album', async () => {
  __resetThrottleForTests();
  mockFetch(new Map([['/recording?', {
    recordings: [
      {
        id: 'rec-live-uuid',
        title: 'One Step Closer (Live)',
        'artist-credit': [{ name: 'Linkin Park' }],
        length: 165000,
        releases: [{
          id: 'live-rel',
          title: 'Live at MSG',
          date: '2010-08-29',
          'release-group': { 'primary-type': 'Live' },
        }],
      },
    ],
  }]]));
  const e = await enrichTrack({ artist: 'Linkin Park', title: 'One Step Closer' });
  assert.ok(e);
  assert.equal(e.isLive, true, 'Live album -> isLive true');
  restoreFetch();
});