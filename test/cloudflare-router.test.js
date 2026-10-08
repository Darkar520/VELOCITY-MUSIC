import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../cloudflare-worker/router.js';

test('Cloudflare: streaming conserva Range y evita caché del audio firmado', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (request, options) => {
    calls.push({ request, options });
    return new Response('audio', { status: 206, headers: { 'content-range': 'bytes 50-54/100' } });
  });
  const response = await router.fetch(new Request('https://velocitymusic.uk/api/stream-proxy?sig=test', {
    headers: { Range: 'bytes=50-', 'If-Range': 'etag' },
  }), {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.headers.get('range'), 'bytes=50-');
  assert.equal(calls[0].request.headers.get('if-range'), 'etag');
  assert.equal(calls[0].request.cache, 'no-store');
  assert.equal(calls[0].options.cf.cacheEverything, false);
  assert.equal(calls[0].options.cf.cacheTtl, 0);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, no-transform');
  assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('content-range'), 'bytes 50-54/100');
  assert.equal(await response.text(), 'audio');
});

test('Cloudflare: las demás rutas API conservan su enrutamiento', async (t) => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (request) => {
    forwarded = request;
    return new Response('ok');
  });
  await router.fetch(new Request('https://velocitymusic.uk/api/example'), {});
  assert.equal(forwarded.url, 'https://velocitymusic.uk/api/example');
  assert.equal(forwarded.method, 'GET');
});

test('Cloudflare: los assets estáticos siguen en Pages', async (t) => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (request) => {
    forwarded = request;
    return new Response('asset');
  });
  const response = await router.fetch(new Request('https://velocitymusic.uk/assets/app.js'), {});
  assert.equal(forwarded.url, 'https://velocity-music.pages.dev/assets/app.js');
  assert.equal(await response.text(), 'asset');
});
