// Regresión P0 — SSRF vía el parámetro `stream`.
//
// Antes: el Audio_Resolver aceptaba cualquier URL http(s) en `stream` y la
// devolvía como URL final, que el Stream_Proxy hace `fetch` desde el servidor y
// que además se guardaba en el Stream_Cache compartido (envenenamiento).
// Ahora: solo hosts de la allowlist (SoundCloud), y solo https.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedStreamUrl } from '../src/lib/streamUrlPolicy.js';
import { resolve, ResolveError } from '../src/services/audioResolver.js';

// ── Política de hosts ─────────────────────────────────────────

test('streamUrlPolicy: acepta los hosts de SoundCloud sobre https', () => {
  for (const url of [
    'https://soundcloud.com/artista/pista',
    'https://api.soundcloud.com/tracks/123/stream',
    'https://sndcdn.com/x',
    'https://cf-media.sndcdn.com/abc.128.mp3',
  ]) {
    assert.equal(isAllowedStreamUrl(url), true, url);
  }
});

test('streamUrlPolicy: rechaza destinos internos (el vector de SSRF)', () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://127.0.0.1:5432/',
    'http://localhost:3000/api/admin/stats',
    'https://10.0.0.5/secreto',
    'http://[::1]:3000/',
  ]) {
    assert.equal(isAllowedStreamUrl(url), false, url);
  }
});

test('streamUrlPolicy: rechaza hosts que solo se parecen a los permitidos', () => {
  for (const url of [
    'https://soundcloud.com.evil.tld/x',   // sufijo como subdominio
    'https://notsoundcloud.com/x',         // sin punto delimitador
    'https://sndcdn.com.attacker.io/x',
    'https://evil.tld/?redirect=soundcloud.com',
    'https://evil.tld/#sndcdn.com',
    'https://evil.tld/soundcloud.com',     // el host es lo único que cuenta
  ]) {
    assert.equal(isAllowedStreamUrl(url), false, url);
  }
});

test('streamUrlPolicy: exige https y descarta esquemas no web', () => {
  assert.equal(isAllowedStreamUrl('http://soundcloud.com/x'), false);
  assert.equal(isAllowedStreamUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedStreamUrl('gopher://soundcloud.com/x'), false);
  assert.equal(isAllowedStreamUrl('data:audio/mp3;base64,AAAA'), false);
});

test('streamUrlPolicy: entradas no-URL y no-string → false', () => {
  for (const v of ['', '   ', 'no-es-una-url', null, undefined, 42, {}, ['https://sndcdn.com/x']]) {
    assert.equal(isAllowedStreamUrl(v), false, String(v));
  }
});

// ── Comportamiento del resolver ───────────────────────────────

/** StreamCache mínimo: solo lo que usa el resolver. */
function makeCache() {
  const map = new Map();
  return {
    map,
    keyFor: (a, t) => `${a}:${t}`.toLowerCase(),
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, v),
  };
}

test('resolver: un `stream` no permitido no se devuelve ni se cachea', async () => {
  const cache = makeCache();
  let extractorCalls = 0;

  await assert.rejects(
    resolve(
      { artist: 'Bad Bunny', title: 'Titi Me Pregunto', stream: 'http://169.254.169.254/latest/meta-data/' },
      {
        cache,
        mode: 'full',
        // Sin extractor: si el stream se hubiera aceptado, habría 302 en vez de 404.
        extractorImpl: undefined,
      },
    ),
    (err) => err instanceof ResolveError && err.status === 404,
  );

  assert.equal(extractorCalls, 0);
  assert.equal(cache.map.size, 0, 'el Stream_Cache no debe guardar el destino rechazado');
});

test('resolver: un `stream` no permitido cae a los extractores, no cortocircuita', async () => {
  const cache = makeCache();
  const res = await resolve(
    { artist: 'A', title: 'B', stream: 'http://127.0.0.1:5432/' },
    {
      cache,
      mode: 'full',
      extractorImpl: async () => 'https://rr1.googlevideo.com/audio.webm',
    },
  );
  assert.equal(res.status, 302);
  assert.equal(res.url, 'https://rr1.googlevideo.com/audio.webm');
  assert.equal(cache.map.get('a:b'), 'https://rr1.googlevideo.com/audio.webm');
});

test('resolver: un `stream` de SoundCloud sigue funcionando sin invocar extractores', async () => {
  const cache = makeCache();
  let extractorCalls = 0;
  const res = await resolve(
    { artist: 'Indie', title: 'Demo', stream: 'https://soundcloud.com/indie/demo' },
    {
      cache,
      mode: 'full',
      extractorImpl: async () => {
        extractorCalls += 1;
        return 'https://rr1.googlevideo.com/otro.webm';
      },
    },
  );
  assert.equal(res.status, 302);
  assert.equal(res.url, 'https://soundcloud.com/indie/demo');
  assert.equal(res.fromCache, false);
  assert.equal(extractorCalls, 0, 'la URL explícita permitida evita yt-dlp');
  assert.equal(cache.map.get('indie:demo'), 'https://soundcloud.com/indie/demo');
});
