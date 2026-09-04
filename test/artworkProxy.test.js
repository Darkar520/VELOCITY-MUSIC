import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';

const REMOTE_ARTWORK = 'https://yt3.googleusercontent.com/art=w512-h512-l90-rj';
const VIDEO_ID = 'jSNvyzsNEaQ';
const FALLBACK_ARTWORK = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;

function imageResponse(status, type = 'image/jpeg', bytes = [1, 2, 3]) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? type : null },
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

function buildApp(fetchImpl) {
  return createApp({
    fetchImpl,
    getActiveMode: () => 'full',
    staticDir: null,
  });
}

test('Proxy de carátulas conserva la imagen oficial cuando el upstream responde', async () => {
  const calls = [];
  const app = buildApp(async (target) => {
    calls.push(String(target));
    return imageResponse(200, 'image/png', [9, 8, 7]);
  });

  const res = await request(app).get('/img').query({ u: REMOTE_ARTWORK, id: VIDEO_ID }).expect(200);

  assert.equal(res.headers['content-type'], 'image/png');
  assert.deepEqual([...res.body], [9, 8, 7]);
  assert.deepEqual(calls, [REMOTE_ARTWORK]);
});
test('Proxy de carátulas usa la miniatura del video si Google devuelve 400', async () => {
  const calls = [];
  const app = buildApp(async (target) => {
    const url = String(target);
    calls.push(url);
    return url === REMOTE_ARTWORK
      ? imageResponse(400)
      : imageResponse(200, 'image/jpeg', [4, 5, 6]);
  });

  const res = await request(app).get('/img').query({ u: REMOTE_ARTWORK, id: VIDEO_ID }).expect(200);

  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.deepEqual([...res.body], [4, 5, 6]);
  assert.deepEqual(calls, [REMOTE_ARTWORK, FALLBACK_ARTWORK]);
});

test('Proxy de carátulas no convierte un id inválido en una URL de fallback', async () => {
  const calls = [];
  const app = buildApp(async (target) => {
    calls.push(String(target));
    return imageResponse(400);
  });

  await request(app)
    .get('/img')
    .query({ u: REMOTE_ARTWORK, id: 'https://169.254.169.254/' })
    .expect(502);

  assert.deepEqual(calls, [REMOTE_ARTWORK]);
});
