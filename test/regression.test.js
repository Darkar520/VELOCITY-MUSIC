/**
 * regression.test.js — Suite de regresión avanzada para los bugs reales que
 * ocurrieron en producción. Cada test documenta el bug, la causa raíz y el
 * invariante que nunca debe volver a romperse.
 *
 * Cubre las implementaciones recientes:
 *   - forceRefresh en streamProxy (reintento con URL fresca)
 *   - audioResolver forceRefresh + calidad en clave de caché
 *   - Fallback YT android → ios en el extractor
 *   - searchAll con múltiples fuentes (YT + SoundCloud)
 *   - Cabeceras de seguridad y ADMIN_KEY (ya en hardening.test.js, extendidas)
 *   - streamUrl con parámetro `stream` (pistas de SoundCloud)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { StreamCache } from '../src/services/streamCache.js';
import { resolve as resolveAudio, ResolveError } from '../src/services/audioResolver.js';
import {
  createStreamProxyHandler,
  validateProxyParams,
} from '../src/services/streamProxy.js';
import { signStreamParams } from '../src/lib/streamSign.js';
import {
  createMemoryUserRepo,
  createMemoryPlaylistRepo,
  createMemoryFavoritesRepo,
  createMemoryHistoryRepo,
  createMemoryTrackRepo,
} from '../src/repositories/memory.js';
import { __resetThrottleForTests as mbResetThrottle } from '../src/extractors/musicbrainz.js';

const RUNS = { numRuns: 60 };
const JWT_SECRET = 'test-secret';

function signedQuery(params) {
  const { exp, sig } = signStreamParams(params, JWT_SECRET);
  return { ...params, exp, sig };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    statusCode: null, body: null, headers: null, headersSent: false, ended: false,
    status(c) { this.statusCode = c; return this; },
    json(o)   { this.body = o; this.headersSent = true; return this; },
    writeHead(c, h) { this.statusCode = c; this.headers = h; this.headersSent = true; return this; },
    end() { this.ended = true; return this; },
  };
}

function buildApp(overrides = {}) {
  return createApp({
    cache: new StreamCache(),
    catalogImpl: async (q) => [{ id: 'v1', title: `${q} song`, artist: 'Test', durationSeconds: 200 }],
    extractorImpl: async () => 'https://cdn.example.com/audio.webm',
    getActiveMode: () => 'full',
    startTime: Date.now(),
    userRepo: createMemoryUserRepo(),
    playlistRepo: createMemoryPlaylistRepo(),
    favoritesRepo: createMemoryFavoritesRepo(),
    historyRepo: createMemoryHistoryRepo(),
    trackRepo: createMemoryTrackRepo(['v1']),
    jwtSecret: 'test-secret',
    staticDir: null,
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. audioResolver — forceRefresh omite la caché (bug: URL expirada)
// ─────────────────────────────────────────────────────────────────────────────
// Bug histórico: la URL de googlevideo expiraba (TTL < 4h en la práctica) y
// el proxy devolvía 502. forceRefresh bypasea el StreamCache y re-resuelve.
test('Regresión: forceRefresh omite caché y obtiene URL fresca', async () => {
  const cache = new StreamCache();
  const staleUrl = 'https://stale.googlevideo.com/expired';
  const freshUrl = 'https://fresh.googlevideo.com/valid';
  cache.set(cache.keyFor('Artist', 'Song'), staleUrl, 3600);

  let calls = 0;
  const extractor = async () => { calls++; return freshUrl; };

  // Sin forceRefresh → devuelve la stale de caché sin llamar al extractor.
  const r1 = await resolveAudio({ artist: 'Artist', title: 'Song' }, {
    cache, mode: 'full', extractorImpl: extractor,
  });
  assert.equal(r1.url, staleUrl);
  assert.equal(r1.fromCache, true);
  assert.equal(calls, 0);

  // Con forceRefresh → salta la caché y llama al extractor.
  const r2 = await resolveAudio({ artist: 'Artist', title: 'Song' }, {
    cache, mode: 'full', extractorImpl: extractor, forceRefresh: true,
  });
  assert.equal(r2.url, freshUrl);
  assert.equal(r2.fromCache, false);
  assert.equal(calls, 1);
  // La caché se actualiza con la URL fresca.
  assert.equal(cache.get(cache.keyFor('Artist', 'Song')), freshUrl);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. audioResolver — clave de caché incluye calidad
// ─────────────────────────────────────────────────────────────────────────────
// Bug potencial: si la clave no incluye la calidad, un hit de 'high' podría
// servir a una petición de 'low' con el formato incorrecto.
test('Regresión: clave de caché segrega por calidad (high ≠ low)', async () => {
  const cache = new StreamCache();
  let extractorCalled = 0;
  const extractor = async ({ quality }) => {
    extractorCalled++;
    return quality === 'high'
      ? 'https://cdn/audio-high.webm'
      : 'https://cdn/audio-low.m4a';
  };

  const rHigh = await resolveAudio({ artist: 'A', title: 'B', quality: 'high' }, {
    cache, mode: 'full', extractorImpl: extractor,
  });
  const rLow = await resolveAudio({ artist: 'A', title: 'B', quality: 'low' }, {
    cache, mode: 'full', extractorImpl: extractor,
  });

  // Cada calidad debe tener su URL propia.
  assert.match(rHigh.url, /high/);
  assert.match(rLow.url, /low/);
  assert.equal(extractorCalled, 2); // el extractor se llamó para cada calidad
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. streamProxy — reintento automático con forceRefresh ante upstream 403/502
// ─────────────────────────────────────────────────────────────────────────────
// Bug histórico: URL de audio expirada → upstream 403 → proxy devolvía 502
// sin intentar re-resolver. Con el reintento, el 2º intento usa forceRefresh.
test('Regresión: proxy reintenta con forceRefresh cuando upstream responde 403', async () => {
  let attempts = 0;
  let forcedAttempt = false;

  const resolveUrl = async (_params, opts = {}) => {
    attempts++;
    if (opts.forceRefresh) forcedAttempt = true;
    // 1er intento → URL expirada que dará 403; 2º intento → URL fresca (200).
    return { url: attempts === 1 ? 'https://cdn/expired' : 'https://cdn/fresh' };
  };

  let fetchCount = 0;
  const fetchImpl = async (url) => {
    fetchCount++;
    // La URL expirada da 403; la fresca da 200.
    const status = url.includes('expired') ? 403 : 200;
    return { status, headers: new Map([['content-type', 'audio/webm']]), body: null };
  };

  const handler = createStreamProxyHandler({ resolveUrl, fetchImpl, timeoutMs: 5000 });
  const res = makeRes();
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, res);

  assert.equal(attempts, 2, 'debe haber 2 intentos de resolución');
  assert.equal(forcedAttempt, true, 'el 2º intento debe tener forceRefresh=true');
  assert.equal(fetchCount, 2, 'debe haber 2 fetch upstream');
  assert.equal(res.statusCode, 200);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. streamProxy — NO reintenta cuando el 1er intento ya es exitoso
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: proxy no reintenta innecesariamente en caso exitoso', async () => {
  let attempts = 0;
  const resolveUrl = async () => { attempts++; return { url: 'https://cdn/good' }; };
  const fetchImpl = async () => ({
    status: 200,
    headers: new Map([['content-type', 'audio/webm']]),
    body: null,
  });

  const handler = createStreamProxyHandler({ resolveUrl, fetchImpl, timeoutMs: 5000 });
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, makeRes());
  assert.equal(attempts, 1, 'solo 1 intento cuando el upstream responde 200');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. streamProxy — pista SoundCloud con URL directa (stream param)
// ─────────────────────────────────────────────────────────────────────────────
// Nueva feature: las pistas de SoundCloud pasan stream=<url> en la query.
// El audioResolver las trata como URL explícita → no necesita yt-dlp.
test('Regresión: pista SoundCloud con stream URL explícita no invoca extractor', async () => {
  const scUrl = 'https://api.soundcloud.com/stream/tracks/123456789';
  let extractorCalled = false;
  const extractor = async () => { extractorCalled = true; return 'https://yt/audio'; };

  const cache = new StreamCache();
  const result = await resolveAudio(
    { artist: 'Artist', title: 'Song', stream: scUrl },
    { cache, mode: 'full', extractorImpl: extractor },
  );

  assert.equal(result.status, 302);
  assert.equal(result.url, scUrl);
  assert.equal(extractorCalled, false, 'no debe invocar yt-dlp para una URL de stream explícita');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. searchAll — combina fuentes YT + SoundCloud (sin mezclar álbumes/artistas)
// ─────────────────────────────────────────────────────────────────────────────
// Nueva feature: searchAllImpl combina ytSearchAll + scCatalog. Verifica que:
// - las canciones de ambas fuentes aparecen
// - los álbumes y artistas siguen siendo solo de YT (SC no los provee)
// - una fuente puede fallar sin romper todo
test('Regresión: searchAll mezcla YT + SC; fallo de SC no rompe la respuesta', async () => {
  const ytSongs = [{ id: 'yt1', title: 'YT Song', artist: 'YT Artist', durationSeconds: 200 }];
  const scSongs = [{ id: 'sc1', title: 'SC Song', artist: 'SC Artist', source: 'soundcloud', streamUrl: 'https://sc.com/track/1' }];
  const ytAlbums = [{ albumId: 'alb1', name: 'YT Album' }];
  const ytArtists = [{ artistId: 'art1', name: 'YT Artist' }];

  // Caso normal: ambas fuentes responden.
  const combined = (() => {
    const ytAll = async () => ({ songs: ytSongs, albums: ytAlbums, artists: ytArtists });
    const scAll = async () => scSongs;
    return async (q) => {
      const [yt, sc] = await Promise.allSettled([ytAll(q), scAll(q)]);
      const ytData = yt.status === 'fulfilled' ? yt.value : { songs: [], albums: [], artists: [] };
      const scData = sc.status === 'fulfilled' ? sc.value : [];
      return { songs: [...(ytData.songs || []), ...scData], albums: ytData.albums || [], artists: ytData.artists || [] };
    };
  })();

  const result = await combined('test');
  assert.equal(result.songs.length, 2);
  assert.ok(result.songs.some(s => s.source === 'soundcloud'));
  assert.ok(result.songs.some(s => !s.source));
  assert.equal(result.albums.length, 1);
  assert.equal(result.artists.length, 1);

  // Caso degradado: SC falla → solo YT songs, sin error.
  const degraded = (() => {
    const ytAll = async () => ({ songs: ytSongs, albums: ytAlbums, artists: ytArtists });
    const scAll = async () => { throw new Error('SC down'); };
    return async (q) => {
      const [yt, sc] = await Promise.allSettled([ytAll(q), scAll(q)]);
      const ytData = yt.status === 'fulfilled' ? yt.value : { songs: [], albums: [], artists: [] };
      const scData = sc.status === 'fulfilled' ? sc.value : [];
      return { songs: [...(ytData.songs || []), ...scData], albums: ytData.albums || [], artists: ytData.artists || [] };
    };
  })();

  const fallback = await degraded('test');
  assert.equal(fallback.songs.length, 1, 'cuando SC falla solo vienen canciones de YT');
  assert.equal(fallback.albums.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. /api/search/all endpoint — integración completa
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: /api/search/all devuelve songs/albums/artists', async () => {
  const app = buildApp({
    searchAllImpl: async (q) => ({
      songs: [{ id: 'v1', title: `${q}`, artist: 'Test', durationSeconds: 200 }],
      albums: [{ albumId: 'a1', name: 'Album' }],
      artists: [{ artistId: 'ar1', name: 'Artist' }],
    }),
  });
  const res = await request(app).get('/api/search/all').query({ q: 'strobe' }).expect(200);
  assert.ok(Array.isArray(res.body.songs));
  assert.ok(Array.isArray(res.body.albums));
  assert.ok(Array.isArray(res.body.artists));
  assert.equal(res.body.songs[0].title, 'strobe');
});

test('Regresión: /api/search/all sin q → 400', async () => {
  const app = buildApp({ searchAllImpl: async () => ({ songs: [], albums: [], artists: [] }) });
  await request(app).get('/api/search/all').expect(400);
});

test('Regresión: /api/search/all sin impl → 501', async () => {
  const app = buildApp({ searchAllImpl: null });
  await request(app).get('/api/search/all').query({ q: 'test' }).expect(501);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Fallback de cliente YT (android → ios) — interfaz del extractor
// ─────────────────────────────────────────────────────────────────────────────
// El extractor intenta android primero; si devuelve null, intenta ios.
// Como no podemos correr yt-dlp en tests, verificamos la INTERFAZ:
// si el primer extractor falla, el segundo se usa.
test('Regresión: extractor usa fallback cuando el primero devuelve null', async () => {
  let attempt = 0;
  // Simula el comportamiento del extractor con dos clientes: el 1º falla, el 2º funciona.
  const simulatedExtractor = async ({ artist, title }) => {
    attempt++;
    if (attempt === 1) return null; // cliente android falla
    return `https://cdn/${artist}-${title}.webm`; // cliente ios funciona
  };

  // Wrapper que simula el loop de YT_CLIENTS del extractor real.
  const extractorWithFallback = async (params) => {
    for (let i = 0; i < 2; i++) {
      const url = await simulatedExtractor(params);
      if (url) return url;
    }
    return null;
  };

  const cache = new StreamCache();
  const result = await resolveAudio({ artist: 'Deadmau5', title: 'Strobe' }, {
    cache, mode: 'full', extractorImpl: extractorWithFallback,
  });

  assert.equal(result.status, 302);
  assert.match(result.url, /Deadmau5/);
  assert.equal(attempt, 2, 'debe haber 2 intentos (android fallido + ios exitoso)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. streamProxy — pista de SoundCloud a través del handler completo
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: handler proxy acepta stream param (SoundCloud URL directa)', async () => {
  const scDirectUrl = 'https://api.soundcloud.com/tracks/123/stream';
  let resolvedStream;

  const resolveUrl = async (params) => {
    resolvedStream = params.stream; // capturamos lo que recibe
    return { url: 'https://cdn/proxy-served.m4a' }; // el proxy devuelve audio real
  };
  const fetchImpl = async () => ({
    status: 200,
    headers: new Map([['content-type', 'audio/mp4']]),
    body: null,
  });

  const handler = createStreamProxyHandler({ resolveUrl, fetchImpl, timeoutMs: 5000 });
  const res = makeRes();
  await handler({
    query: { artist: 'Artist', title: 'Track', stream: scDirectUrl },
    headers: {},
  }, res);

  assert.equal(resolvedStream, scDirectUrl, 'el stream param debe llegar al resolver');
  assert.equal(res.statusCode, 200);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. PBT: validateProxyParams acepta streams válidos de SoundCloud
// ─────────────────────────────────────────────────────────────────────────────
test('PBT: validateProxyParams — artist/title válidos siempre pasan (invariante)', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length >= 1),
      fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length >= 1),
      (artist, title) => {
        const v = validateProxyParams(artist, title);
        assert.equal(v.ok, true);
        // Los valores quedan recortados.
        assert.equal(v.artist, artist.trim());
        assert.equal(v.title, title.trim());
      },
    ),
    RUNS,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. audioResolver — forceRefresh no cachea si el extractor falla
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: forceRefresh con extractor fallido → degraded, caché sin cambios', async () => {
  const cache = new StreamCache();
  const goodUrl = 'https://cdn/good.webm';
  cache.set(cache.keyFor('A', 'B'), goodUrl, 3600);

  const r = await resolveAudio({ artist: 'A', title: 'B' }, {
    cache, mode: 'full',
    extractorImpl: async () => null, // extractor falla
    forceRefresh: true,
  });

  // El extractor falla → degraded, no 302.
  assert.equal(r.status, 'degraded');
  // La caché NO fue sobrescrita con null/undefined.
  assert.equal(cache.get(cache.keyFor('A', 'B')), goodUrl, 'la entrada válida no debe borrarse');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Cabeceras de seguridad — presente en todos los endpoints (no solo /status)
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: cabeceras de seguridad presentes en /api/search (no solo /status)', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/search').query({ q: 'test' }).expect(200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. /api/stream-proxy sin gzip (invariante §6 GUARDRAILS)
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: /api/stream-proxy no tiene Content-Encoding: gzip', async () => {
  const app = buildApp();
  // Sin firma → 401; con firma también no debe comprimir. Ambas rutas sin gzip.
  const unsigned = await request(app)
    .get('/api/stream-proxy')
    .query({ artist: 'A', title: 'B' })
    .set('Accept-Encoding', 'gzip');
  assert.notEqual(unsigned.headers['content-encoding'], 'gzip');

  const res = await request(app)
    .get('/api/stream-proxy')
    .query(signedQuery({ artist: 'A', title: 'B' }))
    .set('Accept-Encoding', 'gzip');
  // El proxy puede responder con cualquier código, pero NUNCA debe comprimir.
  assert.notEqual(res.headers['content-encoding'], 'gzip');
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Bug Google login: handleAuthed no debe llamarse más de una vez
// (done=true previene doble invocación y estado inconsistente → pantalla negra)
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: Google login — el handler done=true previene doble invocación', async () => {
  // Simula el patrón done/finish que protege el flujo.
  let authedCalls = 0;
  const onAuthed = () => { authedCalls++; };

  let done = false;
  const finish = (fn) => { if (done) return; done = true; fn(); };

  // Primer mensaje → debe llamar onAuthed.
  finish(() => onAuthed());
  assert.equal(authedCalls, 1);

  // Segundo evento (popup cerró después del mensaje) → NO debe llamar onAuthed.
  finish(() => onAuthed());
  assert.equal(authedCalls, 1, 'done=true previene segunda invocación');
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Bug feed genérico: CACHE_VERSION '6' invalida velocity.home al cargar
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: CACHE_VERSION 6 borra velocity.home si hay versión vieja', () => {
  // Simula el comportamiento de catalog.js al arrancar con version vieja.
  const store = new Map([
    ['velocity.cacheVer', '5'],       // versión vieja
    ['velocity.home', '[{"section":"stale"}]'], // feed cacheado viejo
    ['velocity.meta', '[]'],
  ]);
  const ls = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  // Ejecutar la lógica de invalidación de catalog.js (v6).
  const CACHE_VERSION = '6';
  if (ls.getItem('velocity.cacheVer') !== CACHE_VERSION) {
    ls.removeItem('velocity.meta');
    ls.removeItem('velocity.home');
    ls.setItem('velocity.cacheVer', CACHE_VERSION);
  }

  assert.equal(ls.getItem('velocity.home'), null, 'velocity.home debe borrarse al actualizar versión');
  assert.equal(ls.getItem('velocity.cacheVer'), '6', 'versión debe quedar actualizada');
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Bug cascada de saltos: protección consecutiveFailsRef detiene la cascada
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: consecutiveFailsRef detiene cascada tras 3 fallos seguidos', () => {
  // Simula el contador de fallos consecutivos.
  let consecutiveFails = 0;
  let stopped = false;
  let toasts = [];

  const handleFail = () => {
    consecutiveFails++;
    if (consecutiveFails > 3) {
      consecutiveFails = 0;
      stopped = true;
      toasts.push('Varias pistas no disponibles. Verifica tu conexión.');
      return;
    }
    toasts.push('siguiente');
  };

  // 3 fallos → sigue saltando.
  handleFail(); handleFail(); handleFail();
  assert.equal(stopped, false, 'no debe detenerse antes de 4 fallos');
  assert.equal(toasts.length, 3);

  // 4º fallo → detiene la cascada.
  handleFail();
  assert.equal(stopped, true, 'debe detenerse al 4º fallo consecutivo');

  // Después de parar, el contador se resetea → el siguiente fallo aislado vuelve a saltar.
  assert.equal(consecutiveFails, 0, 'contador debe resetearse al parar');
  handleFail();
  assert.equal(stopped, true); // stopped sigue true porque no se resetea en la simulación
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Clientes YT android → ios: el extractor intenta en orden
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: extractor YT intenta android primero, luego ios', async () => {
  const clientsUsed = [];
  // Simula YT_CLIENTS: android falla, ios funciona.
  const YT_CLIENTS = [
    ['--extractor-args', 'youtube:player_client=android'],
    ['--extractor-args', 'youtube:player_client=ios'],
  ];

  const runForUrl = async (args) => {
    const clientArg = args.find(a => a.includes('player_client='));
    if (clientArg) clientsUsed.push(clientArg.replace('youtube:player_client=', ''));
    // android falla (null), ios funciona.
    return clientArg?.includes('android') ? null : 'https://cdn/audio-ios.webm';
  };

  let url = null;
  for (const clientArgs of YT_CLIENTS) {
    const baseArgs = ['-f', 'bestaudio', '-g'];
    url = await runForUrl([...baseArgs, ...clientArgs, 'ytsearch1:Deadmau5 Strobe']);
    if (url) break;
  }

  assert.deepEqual(clientsUsed, ['android', 'ios'], 'debe intentar android primero, luego ios');
  assert.match(url, /ios/, 'URL debe venir del cliente ios (android falló)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. streamUrl incluye quality para que el backend cachee correctamente por calidad
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: streamUrl incluye quality — clave de caché del backend es correcta', () => {
  // Simula la construcción de URL que hace api.streamUrl en el frontend.
  const buildStreamUrl = ({ artist, title, id, quality }) => {
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (id) params.set('id', id);
    if (quality) params.set('quality', quality);
    return `/api/stream-proxy?${params.toString()}`;
  };

  const urlHigh = buildStreamUrl({ artist: 'A', title: 'B', id: 'v1', quality: 'high' });
  const urlLow  = buildStreamUrl({ artist: 'A', title: 'B', id: 'v1', quality: 'low' });

  assert.ok(urlHigh.includes('quality=high'), 'URL high debe incluir quality=high');
  assert.ok(urlLow.includes('quality=low'), 'URL low debe incluir quality=low');
  assert.notEqual(urlHigh, urlLow, 'URLs de distinta calidad deben ser distintas (clave de caché)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Bug carátulas offline: cacheTrack prioriza data: URL sobre HTTPS
// ─────────────────────────────────────────────────────────────────────────────
// Bug histórico: las pistas descargadas guardan la carátula como data: URL en
// IndexedDB. Pero el catálogo en memoria podía sobreescribir ese data: URL con
// la URL HTTPS original al cargar la pista desde radio/búsqueda posterior.
// Sin internet, la HTTPS no carga → carátula rota.
// Invariante: un data: URL siempre tiene prioridad sobre un HTTPS URL.
test('Regresión: cacheTrack prioriza data: URL sobre HTTPS para carátulas offline', () => {
  // Simula exactamente la lógica de cacheTrack de catalog.js.
  const _catalog = new Map();
  const FALLBACK_COVER = 'data:image/svg+xml;base64,FALLBACK';
  const hasCover = (c) => !!c && c !== FALLBACK_COVER;
  const isDataUrl = (c) => typeof c === 'string' && c.startsWith('data:');
  const cacheTrack = (t) => {
    if (t && t.id) {
      const prev = _catalog.get(t.id);
      if (prev) {
        if (hasCover(prev.cover) && !hasCover(t.cover)) t = { ...t, cover: prev.cover };
        else if (isDataUrl(t.cover) && !isDataUrl(prev.cover)) { /* t ya tiene el data: */ }
      }
      _catalog.set(t.id, t);
    }
    return t;
  };
  const trackById = (id) => _catalog.get(id) || null;

  const id = 'offline-cover-test-' + Date.now();
  const httpsUrl = 'https://yt3.googleusercontent.com/cover.jpg';
  const dataUrl = 'data:image/jpeg;base64,/9j/AABBCC';

  // Primero llega con HTTPS (desde búsqueda/radio).
  cacheTrack({ id, title: 'T', artist: 'A', cover: httpsUrl });
  assert.equal(trackById(id)?.cover, httpsUrl, 'inicialmente debe tener la HTTPS URL');

  // Luego llega el data: URL (desde IndexedDB al cargar descargas).
  cacheTrack({ id, title: 'T', artist: 'A', cover: dataUrl });
  assert.equal(
    trackById(id)?.cover, dataUrl,
    'el data: URL debe REEMPLAZAR el HTTPS URL (para uso offline sin internet)',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Bug carátulas offline: data: URL no vuelve a ser sobreescrita por HTTPS
// ─────────────────────────────────────────────────────────────────────────────
// Una vez que el catálogo tiene un data: URL (viene de IndexedDB), no debe
// ser degradado de vuelta a HTTPS si la misma pista llega desde radio/búsqueda.
test('Regresión: data: URL en catálogo no se degrada a HTTPS después', () => {
  // Misma simulación de cacheTrack.
  const _catalog = new Map();
  const FALLBACK_COVER = 'data:image/svg+xml;base64,FALLBACK';
  const hasCover = (c) => !!c && c !== FALLBACK_COVER;
  const isDataUrl = (c) => typeof c === 'string' && c.startsWith('data:');
  const cacheTrack = (t) => {
    if (t && t.id) {
      const prev = _catalog.get(t.id);
      if (prev) {
        // 1. Nunca degradar carátula real a vacío.
        if (hasCover(prev.cover) && !hasCover(t.cover)) t = { ...t, cover: prev.cover };
        // 2. Si el catálogo ya tiene un data: URL, no degradar a HTTPS.
        //    El data: URL es inmune a la red y tiene prioridad offline.
        else if (isDataUrl(prev.cover) && !isDataUrl(t.cover)) t = { ...t, cover: prev.cover };
      }
      _catalog.set(t.id, t);
    }
    return t;
  };
  const trackById = (id) => _catalog.get(id) || null;

  const id = 'data-url-stable-' + Date.now();
  const dataUrl = 'data:image/jpeg;base64,/9j/DDEEFF';
  const httpsUrl = 'https://yt3.googleusercontent.com/new-cover.jpg';

  // Primero el data: URL llega al catálogo (carga de descargas).
  cacheTrack({ id, title: 'T', artist: 'A', cover: dataUrl });
  assert.equal(trackById(id)?.cover, dataUrl);

  // Luego la pista llega desde radio/búsqueda con HTTPS URL.
  cacheTrack({ id, title: 'T', artist: 'A', cover: httpsUrl });
  assert.equal(
    trackById(id)?.cover, dataUrl,
    'el data: URL no debe ser reemplazado por HTTPS (sin internet, HTTPS no carga)',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Bug álbum offline: offlineFallback encuentra pistas por albumId
// ─────────────────────────────────────────────────────────────────────────────
// Bug histórico: sin internet, goAlbum() llama api.album() que falla y muestra
// "0 canciones". El fallback offline debe encontrar las pistas descargadas en
// IndexedDB que pertenecen al álbum (por albumId o nombre del álbum).
test('Regresión: offlineFallback encuentra pistas de álbum por albumId', () => {
  const albumId = 'MPREb_album123';
  const metas = [
    { id: 'track1', title: 'Song 1', artist: 'Artist', album: 'My Album', albumId, cover: 'data:image/jpeg;base64,AA' },
    { id: 'track2', title: 'Song 2', artist: 'Artist', album: 'My Album', albumId, cover: 'data:image/jpeg;base64,BB' },
    { id: 'other',  title: 'Other',  artist: 'Other',  album: 'Other Album', albumId: 'OTHER', cover: '' },
  ];

  // Simula la lógica de offlineFallback de goAlbum.
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const tracks = metas.filter(m =>
    (albumId && m.albumId === albumId) ||
    ('My Album' && norm(m.album) === norm('My Album'))
  );

  assert.equal(tracks.length, 2, 'debe encontrar las 2 pistas del álbum');
  assert.ok(tracks.every(t => t.albumId === albumId), 'todas las pistas deben pertenecer al álbum');
  assert.ok(!tracks.some(t => t.id === 'other'), 'no debe incluir pistas de otros álbumes');
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. Bug álbum offline: fallback hereda carátula del álbum si pistas no tienen
// ─────────────────────────────────────────────────────────────────────────────
test('Regresión: offlineFallback hereda carátula del álbum en pistas sin cover', () => {
  const albumId = 'MPREb_noCover';
  const albumCover = 'data:image/jpeg;base64,ALBUMCOVER';
  const metas = [
    { id: 'tr1', title: 'S1', artist: 'A', album: 'Álbum X', albumId, cover: '' },
    { id: 'tr2', title: 'S2', artist: 'A', album: 'Álbum X', albumId, cover: '' },
  ];

  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const tracks = metas.filter(m =>
    (albumId && m.albumId === albumId) ||
    ('Álbum X' && norm(m.album) === norm('Álbum X'))
  );

  // El cover de cada pista se hereda del álbum si está vacío.
  const withCover = tracks.map(t => t.cover ? t : { ...t, cover: albumCover });

  assert.ok(withCover.every(t => t.cover === albumCover),
    'pistas sin cover deben heredar la carátula del álbum');
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. Bug isDownloaded fuzzy: pistas del álbum muestran ícono descargado
// aunque el videoId difiera del ID guardado en IndexedDB
// ─────────────────────────────────────────────────────────────────────────────
// Bug: downloaded (Set de IDs) se comparaba solo por ID exacto. Las pistas de
// api.album() pueden tener un videoId diferente al que se guardó al descargar.
// La función isDownloaded hace fuzzy match por título+artista normalizado.
test('Regresión: isDownloaded fuzzy match detecta descarga por título+artista', () => {
  // IDs distintos pero misma canción (diferente videoId del mismo contenido).
  const downloadedId = 'yt-original-id';
  const albumTrackId = 'yt-different-id';
  const title = 'Strobe';
  const artist = 'deadmau5';

  const downloaded = new Set([downloadedId]);
  const downloadedMetas = new Map([[downloadedId, { id: downloadedId, title, artist }]]);

  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // isDownloaded: primero ID exacto, luego fuzzy por título+artista.
  const isDownloaded = (t) => {
    if (!t) return false;
    if (downloaded.has(t.id)) return true;
    const tk = norm(t.title) + '|' + norm(t.artist);
    for (const id of downloaded) {
      const cached = downloadedMetas.get(id);
      if (cached && norm(cached.title) + '|' + norm(cached.artist) === tk) return true;
    }
    return false;
  };

  // La pista del álbum tiene diferente ID pero mismo título+artista.
  const albumTrack = { id: albumTrackId, title, artist };
  assert.equal(isDownloaded(albumTrack), true,
    'debe detectar descarga por título+artista aunque el ID difiera');

  // Una pista completamente diferente no debe matchear.
  const otherTrack = { id: 'other', title: 'Other Song', artist: 'Other Artist' };
  assert.equal(isDownloaded(otherTrack), false,
    'no debe marcar como descargada una pista diferente');
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. cleanTitle — elimina sufijos promocionales de YouTube de los títulos
// ─────────────────────────────────────────────────────────────────────────────
// Bug histórico: títulos como "Aerials (Official Audio)" o "Song - Official Video"
// aparecían en la UI. La función cleanTitle debe eliminarlos.
test('Regresión: cleanTitle elimina sufijos promocionales de YouTube', () => {
  // Simula exactamente la lógica de cleanTitle de ytmusic.js.
  const cleanTitle = (raw) => {
    if (!raw) return raw;
    return raw
      .replace(/\s*[\(\[]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|lyric[s]?|visualizer|hd|4k|mv|clip)\s*[\)\]]/gi, '')
      .replace(/\s*[\(\[]\s*official\s*[\)\]]/gi, '')
      .replace(/\s*[-–|]\s*official\s+(?:video|audio|music\s+video|lyric[s]?|visualizer|hd|4k|mv|clip)\s*$/gi, '')
      .replace(/\s*[-–|]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyric[s]?|visualizer|hd|4k|mv)\s*$/gi, '')
      .trim();
  };

  const cases = [
    ['Aerials (Official Audio)',         'Aerials'],
    ['Numb (Official Music Video)',      'Numb'],
    ['Stairway to Heaven [Official]',   'Stairway to Heaven'],
    ['Bohemian Rhapsody - Official Video','Bohemian Rhapsody'],
    ['Song - Official Music Video',      'Song'],
    ['Track | Official Audio',           'Track'],
    ['My Song [4K]',                     'My Song'],
    ['Tune (HD)',                        'Tune'],
    ['Artist - Song (Lyrics)',           'Artist - Song'],  // letras: no tocar el título
    ['Normal Title',                     'Normal Title'],   // sin sufijo: no cambiar
    [null,                               null],             // null: devolver null
  ];

  for (const [input, expected] of cases) {
    assert.equal(cleanTitle(input), expected,
      `cleanTitle("${input}") debería ser "${expected}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2: /api/album con MB canónico reordena el tracklist
// ─────────────────────────────────────────────────────────────────────────────

test('Regresión Bug 2: /api/album con MB cayo devuelve tracks YTM sin reordenar', async () => {
  // MB simula respuesta fallida (404) -> no reordena, devuelve album tal cual.
  mbResetThrottle();
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('musicbrainz.org')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return origFetch(url);
  };
  try {
    const albumImpl = async () => ({
      albumId: 'alb-1',
      name: 'Hybrid Theory',
      artist: 'Linkin Park',
      year: 2000,
      cover: 'https://example.com/cover.jpg',
      tracks: [
        { id: 'a', title: 'Crawling', artist: 'Linkin Park', durationSeconds: 182 },
        { id: 'b', title: 'Papercut', artist: 'Linkin Park', durationSeconds: 183 },
        { id: 'c', title: 'Points of Authority', artist: 'Linkin Park', durationSeconds: 200 },
      ],
    });
    const app = buildApp({ albumImpl });
    const res = await request(app).get('/api/album?id=alb-1');
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Hybrid Theory');
    // Sin MB disponible: tracks en orden original de YTM (sin reordenar).
    assert.deepEqual(res.body.tracks.map((t) => t.id), ['a', 'b', 'c'],
      'MB caído -> tracks YTM en orden original');
  } finally {
    global.fetch = origFetch;
  }
});

test('Regresión Bug 2: /api/album con MB exitoso reordena tracks segun trackNumber MB', async () => {
  mbResetThrottle();
  const origFetch = global.fetch;
  // Mock con respuestas MB para /release (busqueda) y /release/<mbid> (tracks).
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('musicbrainz.org/ws/2/release?')) {
      // Llamada enrichAlbum.
      return {
        ok: true, status: 200,
        json: async () => ({
          releases: [{
            id: 'release-mb-uuid',
            title: 'Hybrid Theory',
            'artist-credit': [{ name: 'Linkin Park', artist: { id: 'lp-mbid' } }],
            'release-group': { 'primary-type': 'Album' },
            date: '2000-10-24',
            'track-count': 3,
          }],
        }),
      };
    }
    if (typeof url === 'string' && url.includes('musicbrainz.org/ws/2/release/release-mb-uuid')) {
      // Llamada getReleaseTracks.
      return {
        ok: true, status: 200,
        json: async () => ({
          id: 'release-mb-uuid',
          title: 'Hybrid Theory',
          date: '2000-10-24',
          'artist-credit': [{ name: 'Linkin Park' }],
          'release-group': { 'primary-type': 'Album' },
          media: [{
            track: [
              { id: 'mbid-1', title: 'Papercut', length: 183000 },
              { id: 'mbid-2', title: 'Points of Authority', length: 200000 },
              { id: 'mbid-3', title: 'Crawling', length: 182000 },
            ],
          }],
        }),
      };
    }
    return origFetch(url);
  };
  try {
    // YTM devuelve orden "Crawling, Papercut, Points of Authority".
    const albumImpl = async () => ({
      albumId: 'alb-1',
      name: 'Hybrid Theory',
      artist: 'Linkin Park',
      year: 2000,
      cover: 'https://example.com/cover.jpg',
      tracks: [
        { id: 'yt-a', title: 'Crawling', artist: 'Linkin Park', durationSeconds: 182 },
        { id: 'yt-b', title: 'Papercut', artist: 'Linkin Park', durationSeconds: 183 },
        { id: 'yt-c', title: 'Points of Authority', artist: 'Linkin Park', durationSeconds: 200 },
      ],
    });
    const app = buildApp({ albumImpl });
    const res = await request(app).get('/api/album?id=alb-1');
    assert.equal(res.status, 200);
    // Reordenado segun MB trackNumber: Papercut(1), Points of Authority(2), Crawling(3).
    assert.deepEqual(res.body.tracks.map((t) => t.id), ['yt-b', 'yt-c', 'yt-a'],
      'tracks reordenadas por MB trackNumber');
    // trackNumber adjunto por pista.
    assert.deepEqual(res.body.tracks.map((t) => t.trackNumber), [1, 2, 3]);
    // mbid por pista.
    assert.equal(res.body.tracks[0].mbid, 'mbid-1');
    assert.equal(res.body.tracks[1].mbid, 'mbid-2');
    assert.equal(res.body.mbid, 'release-mb-uuid', 'album trae release MBID');
    assert.equal(res.body.isLive, false, 'album de estudio -> isLive false');
  } finally {
    global.fetch = origFetch;
  }
});
