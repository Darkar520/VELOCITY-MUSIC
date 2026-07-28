// Regresión — SSRF por redirect en el Stream_Proxy.
//
// La allowlist de `stream` valida el destino INICIAL. El proxy seguía los
// redirects con el modo automático de fetch, así que un destino permitido
// (soundcloud.com es contenido de terceros: un open-redirect es plausible) podía
// llevar la petición del servidor a una dirección interna.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REDIRECTS,
  isInternalAddress,
  isSafeRedirectTarget,
  isRedirectStatus,
  resolveRedirect,
} from '../src/lib/redirectPolicy.js';
import { createStreamProxyHandler } from '../src/services/streamProxy.js';

// ── Política pura ─────────────────────────────────────────────

test('redirectPolicy: IPs internas literales se bloquean', () => {
  for (const host of [
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '[::1]', 'fd00::1', 'fe80::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isInternalAddress(host), true, host);
  }
});

test('redirectPolicy: IPs públicas y hostnames no se bloquean por rango', () => {
  for (const host of ['8.8.8.8', '172.32.0.1', '192.169.0.1', 'rr1.googlevideo.com', 'cf-media.sndcdn.com', '']) {
    assert.equal(isInternalAddress(host), false, host);
  }
});

test('redirectPolicy: saltos a destinos internos o esquemas no web se rechazan', () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1:5432/',
    'http://[::1]:3000/api/admin/stats',
    'https://10.0.0.5/secreto',
    'file:///etc/passwd',
    'gopher://8.8.8.8/x',
    'no-una-url',
    '',
  ]) {
    assert.equal(isSafeRedirectTarget(url), false, url);
  }
});

test('redirectPolicy: los saltos legítimos de CDN se permiten', () => {
  for (const url of [
    'https://rr3---sn-uxaxj5caxjg-nwvk.googlevideo.com/videoplayback?x=1',
    'https://cf-media.sndcdn.com/abc.128.mp3',
    'http://cdn.example.com/audio.webm',
  ]) {
    assert.equal(isSafeRedirectTarget(url), true, url);
  }
});

test('redirectPolicy: Location relativo se resuelve contra la URL actual', () => {
  const r = resolveRedirect('https://cf-media.sndcdn.com/a/b.mp3', '/c/d.mp3');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://cf-media.sndcdn.com/c/d.mp3');
});

test('redirectPolicy: Location ausente o interno se señala con motivo', () => {
  assert.deepEqual(resolveRedirect('https://x.test/a', null), { ok: false, reason: 'no_location' });
  assert.deepEqual(
    resolveRedirect('https://x.test/a', 'http://169.254.169.254/'),
    { ok: false, reason: 'blocked' },
  );
});

test('redirectPolicy: isRedirectStatus cubre los 3xx con Location', () => {
  for (const s of [301, 302, 303, 307, 308]) assert.equal(isRedirectStatus(s), true, String(s));
  for (const s of [200, 206, 304, 403, 500]) assert.equal(isRedirectStatus(s), false, String(s));
});

// ── Comportamiento del proxy ──────────────────────────────────

/** Respuesta mínima con la forma que consume el handler. */
function res(status, headers = {}, body = null) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n) => map.get(String(n).toLowerCase()) ?? null }, body };
}

/** `res` de Express mínimo: registra estado y cuerpo JSON. */
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    writeHead(code) { this.statusCode = code; this.headersSent = true; return this; },
    end() { return this; },
  };
}

const REQ = { query: { artist: 'A', title: 'B' }, headers: {} };

test('proxy: un redirect a una IP interna no se sigue → 502', async () => {
  const visited = [];
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://cf-media.sndcdn.com/track' }),
    fetchImpl: async (url) => {
      visited.push(url);
      if (url === 'https://cf-media.sndcdn.com/track') {
        return res(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      }
      return res(200, { 'content-type': 'audio/mpeg' }, null);
    },
  });
  const r = fakeRes();
  await handler(REQ, r);
  assert.equal(r.statusCode, 502);
  assert.deepEqual(visited, ['https://cf-media.sndcdn.com/track'], 'no debe pedir la IP interna');
});

test('proxy: un redirect legítimo del CDN sí se sigue y sirve el audio', async () => {
  const visited = [];
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://cf-media.sndcdn.com/track' }),
    fetchImpl: async (url) => {
      visited.push(url);
      if (url === 'https://cf-media.sndcdn.com/track') {
        return res(302, { location: 'https://rr1.googlevideo.com/videoplayback' });
      }
      return res(206, { 'content-type': 'audio/webm', 'content-range': 'bytes 0-1/2' }, null);
    },
  });
  const r = fakeRes();
  await handler(REQ, r);
  assert.equal(r.statusCode, 206);
  assert.deepEqual(visited, [
    'https://cf-media.sndcdn.com/track',
    'https://rr1.googlevideo.com/videoplayback',
  ]);
});

test('proxy: cadena de redirects infinita se corta en MAX_REDIRECTS', async () => {
  let calls = 0;
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://cf-media.sndcdn.com/0' }),
    fetchImpl: async () => {
      calls += 1;
      return res(302, { location: `https://cf-media.sndcdn.com/${calls}` });
    },
  });
  const r = fakeRes();
  await handler(REQ, r);
  assert.equal(r.statusCode, 502);
  assert.equal(calls, MAX_REDIRECTS + 1, 'un fetch inicial + MAX_REDIRECTS saltos');
});

test('proxy: un 3xx sin Location no se trata como audio', async () => {
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://cf-media.sndcdn.com/track' }),
    fetchImpl: async () => res(302, {}),
  });
  const r = fakeRes();
  await handler(REQ, r);
  assert.equal(r.statusCode, 502);
});

test('proxy: sin redirects el comportamiento no cambia', async () => {
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://rr1.googlevideo.com/audio.webm' }),
    fetchImpl: async () => res(200, { 'content-type': 'audio/webm' }, null),
  });
  const r = fakeRes();
  await handler(REQ, r);
  assert.equal(r.statusCode, 200);
});
