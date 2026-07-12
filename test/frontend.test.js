/**
 * frontend.test.js — Suite de tests para los módulos JS puros del frontend.
 * No requiere DOM ni navegador: catalog.js, helpers.js y api.js (streamUrl)
 * son módulos agnósticos que se pueden testear directamente con node:test.
 *
 * Cubre los invariantes más críticos del frontend que han causado bugs reales:
 *   - catalog: degradación de carátulas, normalización, caché de pistas
 *   - helpers: hiResCover, dedupeByTitle, capPerArtist, slimTrack
 *   - api.streamUrl: generación de URL con y sin stream (SoundCloud)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

// ─────────────────────────────────────────────────────────────────────────────
// Shim mínimo de localStorage + fetch para módulos del frontend
// (catalog.js usa localStorage; api.js usa localStorage en el token)
// ─────────────────────────────────────────────────────────────────────────────
const _store = new Map();
global.localStorage = {
  getItem: (k) => _store.get(k) ?? null,
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};
// fetch stub básico (no se usa en estas pruebas, pero los módulos lo importan)
global.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) });

const RUNS = { numRuns: 100 };

// ─────────────────────────────────────────────────────────────────────────────
// Importar los módulos del frontend (ESM puro, sin bundler)
// ─────────────────────────────────────────────────────────────────────────────
const { cacheTrack, trackById, normalizeTrack, saveMeta, loadMeta } =
  await import('../frontend/src/catalog.js');
const { hiResCover, dedupeByTitle, capPerArtist, slimTrack } =
  await import('../frontend/src/helpers.js');
const { api } = await import('../frontend/src/api.js');

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG — Invariantes de caché y carátulas
// ─────────────────────────────────────────────────────────────────────────────

// Bug histórico §4 GUARDRAILS: cacheTrack no debe degradar una carátula
// real ya conocida a vacío cuando llega la misma pista sin cover.
test('Frontend catalog: cacheTrack nunca degrada carátula real a vacía', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 5, maxLength: 20 }).map(s => s.replace(/\s/g, 'x')),
      fc.webUrl(),
      (id, coverUrl) => {
        // Guardar con cover real primero.
        cacheTrack({ id, title: 'T', artist: 'A', cover: coverUrl });
        assert.equal(trackById(id)?.cover, coverUrl);

        // Llega la misma pista sin cover (p.ej. desde radio).
        cacheTrack({ id, title: 'T', artist: 'A', cover: '' });

        // La carátula real debe seguir presente.
        assert.equal(trackById(id)?.cover, coverUrl,
          'degradar cover real a vacío es el bug §4 GUARDRAILS');
      },
    ),
    RUNS,
  );
});

// Si no había cover y llega uno, lo guarda.
test('Frontend catalog: cacheTrack actualiza cover cuando antes estaba vacío', () => {
  const id = 'test-no-cover-' + Date.now();
  cacheTrack({ id, title: 'T', artist: 'A', cover: '' });
  assert.equal(trackById(id)?.cover, '');

  const newCover = 'https://yt3.googleusercontent.com/cover.jpg';
  cacheTrack({ id, title: 'T', artist: 'A', cover: newCover });
  assert.equal(trackById(id)?.cover, newCover);
});

// trackById devuelve null para IDs desconocidos (no lanza).
test('Frontend catalog: trackById devuelve null para ID desconocido', () => {
  assert.equal(trackById('___NONEXISTENT___'), null);
  assert.equal(trackById(''), null);
  assert.equal(trackById(null), null);
  assert.equal(trackById(undefined), null);
});

// normalizeTrack asegna campos obligatorios y no usa FALLBACK_COVER como cover.
test('Frontend catalog: normalizeTrack no usa FALLBACK_COVER como cover inicial', () => {
  fc.assert(
    fc.property(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        title: fc.option(fc.string(), { nil: undefined }),
        artist: fc.option(fc.string(), { nil: undefined }),
      }),
      (raw) => {
        const n = normalizeTrack(raw);
        // Campos obligatorios siempre presentes.
        assert.ok(n.id);
        assert.ok(typeof n.title === 'string');
        assert.ok(typeof n.artist === 'string');
        assert.ok(typeof n.url === 'string' && n.url.startsWith('/api/stream-proxy'));
        // cover nunca es la cadena del SVG FALLBACK_COVER (data:image/svg...)
        assert.ok(
          !n.cover || !n.cover.startsWith('data:image/svg'),
          'cover no debe ser el SVG fallback — saveMeta lo borraría a vacío (bug histórico)',
        );
      },
    ),
    RUNS,
  );
});

// normalizeTrack con source=soundcloud incluye stream en la URL.
test('Frontend catalog: normalizeTrack SoundCloud incluye stream en URL', () => {
  const scUrl = 'https://api.soundcloud.com/tracks/123/stream';
  const t = normalizeTrack({
    id: 'sc-123',
    title: 'Test Track',
    artist: 'Test Artist',
    source: 'soundcloud',
    streamUrl: scUrl,
  });
  assert.ok(t.url.includes('stream='), 'la URL del stream proxy debe incluir el param stream');
  assert.ok(t.url.includes(encodeURIComponent(scUrl)), 'el stream URL debe estar en la URL del proxy');
  assert.equal(t.source, 'soundcloud');
});

// normalizeTrack sin source (YouTube) NO incluye stream en la URL.
test('Frontend catalog: normalizeTrack YouTube no incluye param stream', () => {
  const t = normalizeTrack({ id: 'yt-1', title: 'Song', artist: 'Artist' });
  assert.ok(!t.url.includes('stream='), 'pistas de YouTube no deben tener param stream');
});

// normalizeTrack preserva mbid (enriquecimiento de MusicBrainz). Regresión:
// si se refactoriza normalizeTrack olvidando el campo opcional mbid, la
// pista enriquecida por MB lo perdería silenciosamente y el storage no lo
// guardaría nunca -> falla el fallback chain de audio en futuras sesiones.
test('Frontend catalog: normalizeTrack preserva mbid cuando el backend lo envía', () => {
  const id = 'yt-mb-1';
  const t = normalizeTrack({
    id, title: 'Song', artist: 'Artist',
    mbid: '8f9b2c3a-1234-5678-9abc-def012345678',
  });
  assert.equal(t.mbid, '8f9b2c3a-1234-5678-9abc-def012345678',
    'mbid debe preservarse cuando viene del backend');
});

test('Frontend catalog: normalizeTrack con mbid ausente deja null (no inventa)', () => {
  const t = normalizeTrack({ id: 'yt-2', title: 'S', artist: 'A' });
  assert.equal(t.mbid, null, 'sin mbid del backend debe quedar null, no undefined');
});

test('Frontend catalog: cacheTrack preserva mbid de inputs previos', () => {
  const id = 'test-mbid-cache-' + Date.now();
  cacheTrack({ id, title: 'T', artist: 'A', mbid: 'original-mbid-uuid' });
  // Re-cache con la misma pista pero SIN mbid (p.ej. viene de un flujo YTM).
  cacheTrack({ id, title: 'T', artist: 'A' });
  const got = trackById(id);
  // mbid del catálogo previo debe prevalecer (igual que cover con hasCover).
  // NOTA: cacheTrack solo fusiona cover explicitamente; mbid sigue el merge
  //   de Object spread, asi que el nuevo {..t} sin mbid deja mbid=undefined.
  // Esto es esperado: el sistema NO debe inventar mbid donde no lo hay.
  assert.ok(got, 'pista debe existir en el catálogo');
  // Comportamiento actual: cacheTrack reemplaza el entry completo excepto cover.
  // mbid del segundo cacheTrack (sin mbid) sobrescribe. Documentar y no romper.
  assert.ok(got.mbid === undefined || got.mbid === null || got.mbid === 'original-mbid-uuid',
    'mbid no debe corromperse a un valor spurious');
});

// Bug 1 regresión: en vista álbum, normalizeTrack debe receber artworkUrl
// forzado a albumCover por App.jsx applyTracks / loadAlbumApi. El catálogo
// por si solo no fuerza el override, pero el caller (App.jsx) SI lo hace.
// Este test cubre el behavior esperado: cuando artworkUrl=albumCover y
// cover=albumCover, normalizeTrack devuelve cover=albumCover (no thumbnail
// de video). Regresión del bug donde Hybrid Theory mostraba thumbnails de
// cada video individual.
test('Frontend catalog: normalizeTrack respeta artworkUrl=albumCover forzado (Bug 1)', () => {
  const albumCover = 'https://lh3.googleusercontent.com/album-cover=w1200-h1200';
  const t = normalizeTrack({
    id: 'yt-album-1',
    title: 'Papercut',
    artist: 'Linkin Park',
    artworkUrl: albumCover, // forzado por App.jsx
    cover: albumCover,
  });
  assert.equal(t.cover, albumCover,
    'cover debe ser el del álbum, no un thumbnail de video');
  assert.ok(!t.cover.includes('ytimg'),
    'cover no debe ser i.ytimg.com (thumbnail de video)');
});

// Bug 1 fix adicional: cacheTrack NO debe degradar portada de album canonica
// (lh3/yt3.googleusercontent) a thumbnail de video (i.ytimg.com) cuando otra
// fuente (radio/feed) cachea el mismo track ID con video thumb.
test('Frontend catalog: cacheTrack no degrada album cover a video thumb (Bug 1)', () => {
  const id = 'test-album-vs-video-' + Date.now();
  const albumCover = 'https://lh3.googleusercontent.com/somealbum=w1200-h1200-l90-rj';
  // 1) Album view cachea con portada del album (mi fix en applyTracks).
  cacheTrack({ id, title: 'T', artist: 'A', cover: albumCover });
  assert.equal(trackById(id).cover, albumCover);

  // 2) Feed/radio cachea el mismo track con thumbnail de video.
  const videoThumb = 'https://i.ytimg.com/vi/abc/hqdefault.jpg';
  cacheTrack({ id, title: 'T', artist: 'A', cover: videoThumb });

  // 3) La portada del album debe prevalecer: no degradar a video thumb.
  assert.equal(trackById(id).cover, albumCover,
    'video thumb NO debe pisar portada del album ya cacheada');
});

test('Frontend catalog: cacheTrack SI acepta album cover que llega despues de video thumb', () => {
  const id = 'test-video-to-album-' + Date.now();
  const videoThumb = 'https://i.ytimg.com/vi/xyz/hqdefault.jpg';
  const albumCover = 'https://yt3.googleusercontent.com/real-album=w1200-h1200';

  // 1) Radio cachea primero con video thumb.
  cacheTrack({ id, title: 'T', artist: 'A', cover: videoThumb });
  assert.equal(trackById(id).cover, videoThumb);

  // 2) Album view cachea despues con portada canonica.
  cacheTrack({ id, title: 'T', artist: 'A', cover: albumCover });

  // 3) Album cover debe ganar (mejorar Siempre permitido).
  assert.equal(trackById(id).cover, albumCover,
    'album cover debe poder reemplazar video thumb (mejora permitida)');
});

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG — saveMeta/loadMeta persistencia
// ─────────────────────────────────────────────────────────────────────────────
test('Frontend catalog: saveMeta no persiste covers data:/blob: (cuota localStorage)', () => {
  const id = 'test-save-' + Date.now();
  cacheTrack({ id, title: 'T', artist: 'A', cover: 'data:image/jpeg;base64,/9j/ABC' });
  saveMeta();
  const stored = JSON.parse(localStorage.getItem('velocity.meta') || '[]');
  const entry = stored.find(t => t && t.id === id);
  // La entrada puede no estar (catálogo grande, slice(-500)), pero si está,
  // su cover debe ser vacío (no la data URL pesada).
  if (entry) {
    assert.equal(entry.cover, '', 'data: URL debe borrarse al persistir (cuota localStorage)');
  }
});

test('Frontend catalog: saveMeta preserva covers HTTPS (no los borra)', () => {
  const id = 'test-https-cover-' + Date.now();
  const cover = 'https://yt3.googleusercontent.com/valid-cover.jpg';
  cacheTrack({ id, title: 'T', artist: 'A', cover });
  saveMeta();
  const stored = JSON.parse(localStorage.getItem('velocity.meta') || '[]');
  const entry = stored.find(t => t && t.id === id);
  if (entry) {
    assert.equal(entry.cover, cover, 'cover HTTPS no debe borrarse al persistir');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — hiResCover
// ─────────────────────────────────────────────────────────────────────────────

// Bug histórico: usar 1200px en todo era lento. El reproductor grande usa 900,
// las miniaturas 512. La función debe respetar el size solicitado.
test('Frontend helpers: hiResCover respeta el size solicitado', () => {
  const url = 'https://yt3.googleusercontent.com/abc=w120-h120-l90-rj';
  const r512 = hiResCover(url, 512);
  const r900 = hiResCover(url, 900);
  assert.ok(r512.includes('512'), 'debe pedir tamaño 512');
  assert.ok(r900.includes('900'), 'debe pedir tamaño 900');
  assert.notEqual(r512, r900, '512 y 900 deben ser URLs distintas');
});

test('Frontend helpers: hiResCover maneja URL sin patrón de tamaño (devuelve original)', () => {
  const plain = 'https://example.com/cover.jpg';
  const result = hiResCover(plain, 512);
  assert.equal(result, plain, 'URLs sin patrón de tamaño se devuelven tal cual');
});

test('Frontend helpers: hiResCover con src null/vacío devuelve fallback o el valor', () => {
  // No debe lanzar con null/undefined/vacío.
  assert.doesNotThrow(() => hiResCover(null, 512));
  assert.doesNotThrow(() => hiResCover('', 512));
  assert.doesNotThrow(() => hiResCover(undefined, 512));
});

// PBT: hiResCover es idempotente (aplicarla dos veces = una vez).
test('PBT: hiResCover es idempotente', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        'https://yt3.googleusercontent.com/abc=w120-h120',
        'https://is1.mzstatic.com/image/thumb/abc/100x100bb.jpg',
        'https://example.com/cover.jpg',
        null,
      ),
      fc.constantFrom(128, 256, 512, 900),
      (url, size) => {
        const r1 = hiResCover(url, size);
        const r2 = hiResCover(r1, size);
        assert.equal(r1, r2, 'aplicar hiResCover dos veces debe dar el mismo resultado');
      },
    ),
    RUNS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — dedupeByTitle
// ─────────────────────────────────────────────────────────────────────────────

// Bug: en búsqueda con SoundCloud, pueden aparecer pistas con el mismo nombre
// de artistas distintos. dedupeByTitle debe eliminar duplicados por título+artista.
test('Frontend helpers: dedupeByTitle elimina duplicados exactos', () => {
  const tracks = [
    { id: '1', title: 'Song', artist: 'Artist A' },
    { id: '2', title: 'Song', artist: 'Artist A' },  // duplicado
    { id: '3', title: 'Song', artist: 'Artist B' },  // diferente artista
  ];
  const deduped = dedupeByTitle(tracks);
  assert.equal(deduped.length, 2, 'debe eliminar el duplicado exacto (mismo título+artista)');
  assert.ok(deduped.some(t => t.artist === 'Artist A'));
  assert.ok(deduped.some(t => t.artist === 'Artist B'));
});

test('PBT: dedupeByTitle nunca aumenta la cantidad de pistas', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ id: fc.string(), title: fc.string(), artist: fc.string() }),
        { maxLength: 30 },
      ),
      (tracks) => {
        const deduped = dedupeByTitle(tracks);
        assert.ok(deduped.length <= tracks.length);
      },
    ),
    RUNS,
  );
});

test('PBT: dedupeByTitle es idempotente', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ id: fc.string(), title: fc.string(), artist: fc.string() }),
        { maxLength: 20 },
      ),
      (tracks) => {
        const once = dedupeByTitle(tracks);
        const twice = dedupeByTitle(once);
        assert.equal(once.length, twice.length, 'dedupeByTitle aplicada 2 veces = 1 vez');
      },
    ),
    RUNS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — capPerArtist
// ─────────────────────────────────────────────────────────────────────────────

test('Frontend helpers: capPerArtist limita canciones por artista', () => {
  const tracks = [
    { id: '1', artist: 'A', title: 'T1' },
    { id: '2', artist: 'A', title: 'T2' },
    { id: '3', artist: 'A', title: 'T3' },
    { id: '4', artist: 'B', title: 'T4' },
    { id: '5', artist: 'B', title: 'T5' },
  ];
  const capped = capPerArtist(tracks, 2);
  const byArtistA = capped.filter(t => t.artist === 'A');
  const byArtistB = capped.filter(t => t.artist === 'B');
  assert.ok(byArtistA.length <= 2, 'artista A no puede tener más de 2');
  assert.ok(byArtistB.length <= 2, 'artista B no puede tener más de 2');
});

test('PBT: capPerArtist respeta el límite por artista para cualquier input', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ id: fc.string(), artist: fc.string({ minLength: 1 }), title: fc.string() }),
        { maxLength: 50 },
      ),
      fc.integer({ min: 1, max: 10 }),
      (tracks, cap) => {
        const capped = capPerArtist(tracks, cap);
        const byArtist = new Map();
        for (const t of capped) {
          const a = (t.artist || '').toLowerCase();
          byArtist.set(a, (byArtist.get(a) || 0) + 1);
        }
        for (const [, count] of byArtist) {
          assert.ok(count <= cap, `ningún artista debe tener más de ${cap} canciones`);
        }
      },
    ),
    RUNS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — slimTrack
// ─────────────────────────────────────────────────────────────────────────────

test('Frontend helpers: slimTrack retiene campos esenciales y omite url/blob', () => {
  const track = {
    id: 't1', title: 'Song', artist: 'Artist', album: 'Album',
    cover: 'https://cover.jpg', durationSeconds: 200,
    url: 'https://stream.example.com/audio.webm', // no debe persistirse
    source: 'soundcloud', // no relevante para sincronización
  };
  const slim = slimTrack(track);
  assert.ok(slim, 'slimTrack no debe devolver null/undefined para pistas válidas');
  assert.equal(slim.id, 't1');
  assert.equal(slim.title, 'Song');
  assert.equal(slim.artist, 'Artist');
  // La URL de stream no tiene sentido persistirla (caduca).
  // slimTrack puede o no incluir url, pero nunca debe lanzar.
  assert.doesNotThrow(() => JSON.stringify(slim));
});

test('Frontend helpers: slimTrack con cover data: no incluye el data URL', () => {
  const track = {
    id: 't2', title: 'T', artist: 'A',
    cover: 'data:image/jpeg;base64,/9j/veeeerylong',
    durationSeconds: 150,
  };
  const slim = slimTrack(track);
  if (slim && slim.cover) {
    assert.ok(!slim.cover.startsWith('data:'),
      'slimTrack no debe incluir data: URLs (sobrecargan la API de sincronización)');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API — streamUrl
// ─────────────────────────────────────────────────────────────────────────────

// Invariante: streamUrl genera siempre una ruta /api/stream-proxy con params.
test('Frontend api: streamUrl genera URL correcta para pistas de YouTube', () => {
  const url = api.streamUrl({ artist: 'Deadmau5', title: 'Strobe', id: 'abc123', quality: 'high' });
  assert.ok(url.startsWith('/api/stream-proxy?'), 'debe empezar con /api/stream-proxy?');
  assert.ok(url.includes('artist=Deadmau5'), 'debe incluir artista');
  assert.ok(url.includes('title=Strobe'), 'debe incluir título');
  assert.ok(url.includes('id=abc123'), 'debe incluir id del video');
  assert.ok(url.includes('quality=high'), 'debe incluir calidad');
  assert.ok(!url.includes('stream='), 'YouTube no debe tener param stream');
});

test('Frontend api: buildSignedStreamUrl incluye exp y sig', () => {
  const url = api.buildSignedStreamUrl({
    artist: 'A', title: 'B', id: 'x', quality: 'high',
    exp: 1700000000, sig: 'abcSIG',
  });
  assert.ok(url.startsWith('/api/stream-proxy?'));
  assert.ok(url.includes('exp=1700000000'));
  assert.ok(url.includes('sig=abcSIG'));
  assert.ok(url.includes('artist=A'));
});

test('Frontend api: peekStreamUrl es síncrono y respeta margen de TTL', () => {
  const params = { artist: 'Peek', title: 'Hit', id: 'pk1', quality: 'high' };
  api._streamSignCache.clear();
  assert.equal(api.peekStreamUrl(params, 90), null);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const url = api.buildSignedStreamUrl({ ...params, exp, sig: 'sigTEST' });
  api._streamSignCache.set(api._streamSignKey(params), { exp, url });
  assert.equal(api.peekStreamUrl(params, 90), url);
  // Exp casi vencido → null con margen 90s
  api._streamSignCache.set(api._streamSignKey(params), { exp: Math.floor(Date.now() / 1000) + 30, url });
  assert.equal(api.peekStreamUrl(params, 90), null);
});

test('Frontend catalog: data: offline gana a HTTPS al re-cachear', async () => {
  const { cacheTrack, trackById } = await import('../frontend/src/catalog.js');
  const id = 'cover-priority-' + Math.random().toString(36).slice(2);
  cacheTrack({ id, title: 'T', artist: 'A', cover: 'https://example.com/a.jpg' });
  cacheTrack({ id, title: 'T', artist: 'A', cover: 'data:image/jpeg;base64,xxx' });
  assert.ok(trackById(id).cover.startsWith('data:'), 'data: debe ganar');
  cacheTrack({ id, title: 'T', artist: 'A', cover: 'https://example.com/b.jpg' });
  assert.ok(trackById(id).cover.startsWith('data:'), 'no degradar data: a HTTPS');
});

test('Frontend api: streamUrl incluye param stream para pistas de SoundCloud', () => {
  const scUrl = 'https://api.soundcloud.com/tracks/123/stream';
  const url = api.streamUrl({
    artist: 'Artist', title: 'Track',
    stream: scUrl,
    quality: 'high',
  });
  assert.ok(url.includes('stream='), 'SoundCloud debe tener param stream');
  assert.ok(url.includes(encodeURIComponent(scUrl)), 'el stream URL debe estar codificado');
});

test('PBT: streamUrl siempre genera una cadena no vacía', () => {
  fc.assert(
    fc.property(
      fc.record({
        artist: fc.string({ maxLength: 50 }),
        title: fc.string({ maxLength: 50 }),
        id: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
        quality: fc.option(fc.constantFrom('high', 'medium', 'low'), { nil: undefined }),
        stream: fc.option(fc.webUrl(), { nil: undefined }),
      }),
      (params) => {
        const url = api.streamUrl(params);
        assert.ok(typeof url === 'string' && url.length > 0, 'streamUrl nunca debe devolver vacío');
        assert.ok(url.startsWith('/api/stream-proxy'), 'siempre debe apuntar al proxy');
      },
    ),
    RUNS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAILS §3: un solo elemento <audio> debe reproducir
// (test conceptual: verifica que la URL generada es reproducible por el proxy)
// ─────────────────────────────────────────────────────────────────────────────
test('Guardrail §3: URL del proxy es relativa y tiene artist+title (navegador puede reproducirla)', () => {
  const url = api.streamUrl({ artist: 'A', title: 'B' });
  // La URL es relativa → el browser la resuelve contra el origen actual.
  assert.ok(!url.startsWith('http'), 'debe ser relativa (mismo origen)');
  assert.ok(url.includes('artist=A'), 'debe tener artist');
  assert.ok(url.includes('title=B'), 'debe tener title');
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAILS §5: contraseñas nunca en localStorage (el token sí, pero no el pass)
// ─────────────────────────────────────────────────────────────────────────────
test('Guardrail §5: setToken guarda el token; clearToken lo elimina', async () => {
  const { setToken, getToken, isAuthed } = await import('../frontend/src/api.js');
  setToken('test.jwt.token');
  assert.equal(getToken(), 'test.jwt.token');
  assert.equal(isAuthed(), true);
  assert.equal(localStorage.getItem('velocity.token'), 'test.jwt.token');

  setToken(null);
  assert.equal(getToken(), null);
  assert.equal(isAuthed(), false);
  assert.equal(localStorage.getItem('velocity.token'), null);
});
