import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { StreamCache } from '../src/services/streamCache.js';
import { signStreamParams } from '../src/lib/streamSign.js';
import {
  createMemoryUserRepo,
  createMemoryPlaylistRepo,
  createMemoryFavoritesRepo,
  createMemoryHistoryRepo,
  createMemoryTrackRepo,
} from '../src/repositories/memory.js';

const JWT_SECRET = 'test-secret';

function buildTestApp(overrides = {}) {
  return createApp({
    cache: new StreamCache(),
    catalogImpl: async (q) => [
      { id: 'v1', title: `${q} song`, artist: 'Tester', durationSeconds: 200 },
    ],
    extractorImpl: async () => 'https://cdn.example.com/audio.webm',
    getActiveMode: () => 'full',
    startTime: Date.now(),
    userRepo: createMemoryUserRepo(),
    playlistRepo: createMemoryPlaylistRepo(),
    favoritesRepo: createMemoryFavoritesRepo(),
    historyRepo: createMemoryHistoryRepo(),
    trackRepo: createMemoryTrackRepo(['v1']),
    jwtSecret: JWT_SECRET,
    staticDir: null,
    ...overrides,
  });
}

async function loginToken(app, email = 'resolve-user@example.com') {
  const creds = { email, password: 'Abcdef123!xyz' };
  await request(app).post('/api/auth/register').send(creds);
  const login = await request(app).post('/api/auth/login').send(creds).expect(200);
  return login.body.token;
}

function signedQuery(params) {
  const { exp, sig } = signStreamParams(params, JWT_SECRET);
  return { ...params, exp, sig };
}

// Smoke (5.2): /api/status responde con el esquema correcto y el modo activo.
// Nota: el límite estricto de 500 ms del Requisito 5.2 se mide en condiciones
// normales; aquí usamos un margen amplio para evitar fragilidad cuando la suite
// completa corre en paralelo y el event loop está cargado.
test('Smoke: GET /api/status responde con el esquema y modo activo', async () => {
  const app = buildTestApp();
  const t0 = Date.now();
  const res = await request(app).get('/api/status').expect(200);
  const elapsed = Date.now() - t0;
  assert.ok(['operational', 'degraded'].includes(res.body.status));
  assert.equal(res.body.resolutionMode, 'full');
  assert.equal(typeof res.body.uptimeSeconds, 'number');
  assert.ok(elapsed <= 2000);
});

test('GET /api/search valida q y mapea resultados de YouTube Music', async () => {
  const app = buildTestApp();
  await request(app).get('/api/search').expect(400);
  const res = await request(app).get('/api/search').query({ q: 'daft punk' }).expect(200);
  assert.ok(Array.isArray(res.body.results));
  assert.equal(res.body.results[0].artist, 'Tester');
  assert.equal(res.body.results[0].streamUrl, null);
});

test('GET /api/resolve sin JWT → 401', async () => {
  const app = buildTestApp();
  await request(app)
    .get('/api/resolve')
    .query({ artist: 'Daft Punk', title: 'One More Time' })
    .expect(401);
});

test('GET /api/resolve redirige a la URL del extractor (modo full)', async () => {
  const app = buildTestApp();
  const token = await loginToken(app);
  const res = await request(app)
    .get('/api/resolve')
    .set('Authorization', `Bearer ${token}`)
    .query({ artist: 'Daft Punk', title: 'One More Time' })
    .expect(302);
  assert.equal(res.headers.location, 'https://cdn.example.com/audio.webm');
});

test('GET /api/resolve usa la URL de stream explícita sin extractor', async () => {
  // El host importa: solo los de la allowlist (src/lib/streamUrlPolicy.js)
  // cortocircuitan el resolver desde el arreglo del SSRF.
  const url = 'https://cf-media.sndcdn.com/explicit.128.mp3';
  const app = buildTestApp();
  const token = await loginToken(app, 'stream-explicit@example.com');
  const res = await request(app)
    .get('/api/resolve')
    .set('Authorization', `Bearer ${token}`)
    .query({ artist: 'A', title: 'B', stream: url })
    .expect(302);
  assert.equal(res.headers.location, url);
});

// Regresión P0 (SSRF) end-to-end: el destino que elige el cliente en `stream`
// no debe salir por Location ni provocar un fetch del servidor a la red interna.
// Los tests unitarios cubren la política; este cubre el endpoint real.
test('GET /api/resolve ignora un `stream` fuera de la allowlist (SSRF)', async () => {
  const app = buildTestApp();
  const token = await loginToken(app, 'stream-ssrf@example.com');
  for (const evil of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:5432/',
    'https://soundcloud.com.evil.tld/x',
  ]) {
    const res = await request(app)
      .get('/api/resolve')
      .set('Authorization', `Bearer ${token}`)
      .query({ artist: 'Daft Punk', title: 'One More Time', stream: evil })
      .expect(302);
    // Cae al extractor del test, nunca al destino pedido por el cliente.
    assert.equal(res.headers.location, 'https://cdn.example.com/audio.webm');
    assert.notEqual(res.headers.location, evil);
  }
});

test('Modo degraded rechaza la resolución de pista completa (14.5)', async () => {
  const app = buildTestApp({ getActiveMode: () => 'degraded' });
  const token = await loginToken(app, 'degraded@example.com');
  await request(app)
    .get('/api/resolve')
    .set('Authorization', `Bearer ${token}`)
    .query({ artist: 'A', title: 'B' })
    .expect(503);
});

test('GET /api/stream-proxy sin firma → 401', async () => {
  const app = buildTestApp();
  await request(app)
    .get('/api/stream-proxy')
    .query({ artist: 'A', title: 'B' })
    .expect(401);
});

test('GET /api/stream-sign requiere JWT y devuelve exp+sig', async () => {
  const app = buildTestApp();
  await request(app).get('/api/stream-sign').query({ artist: 'A', title: 'B' }).expect(401);
  const token = await loginToken(app, 'signer@example.com');
  const res = await request(app)
    .get('/api/stream-sign')
    .set('Authorization', `Bearer ${token}`)
    .query({ artist: 'A', title: 'B', id: 'v1', quality: 'high' })
    .expect(200);
  assert.equal(typeof res.body.exp, 'number');
  assert.equal(typeof res.body.sig, 'string');
  assert.ok(res.body.sig.length > 10);
});

// Integración (14.2): flujo auth → crear lista → añadir pista → listar.
test('Flujo de biblioteca: registro, login, lista y pista', async () => {
  const app = buildTestApp();
  const creds = { email: 'user@example.com', password: 'Abcdef123!xyz' };

  await request(app).post('/api/auth/register').send(creds).expect(201);
  const login = await request(app).post('/api/auth/login').send(creds).expect(200);
  const token = login.body.token;
  assert.ok(token);

  // Sin token → 401.
  await request(app).get('/api/playlists').expect(401);

  const auth = { Authorization: `Bearer ${token}` };
  const created = await request(app)
    .post('/api/playlists')
    .set(auth)
    .send({ name: 'Favoritas del verano' })
    .expect(201);
  const playlistId = created.body.id;

  await request(app)
    .post(`/api/playlists/${playlistId}/tracks`)
    .set(auth)
    .send({ trackId: 'v1' })
    .expect(201);

  const list = await request(app).get('/api/playlists').set(auth).expect(200);
  assert.equal(list.body.playlists.length, 1);

  // Favoritos.
  await request(app).post('/api/favorites').set(auth).send({ trackId: 'v1' }).expect(200);
  const favs = await request(app).get('/api/favorites').set(auth).expect(200);
  assert.deepEqual(favs.body.favorites, ['v1']);

  // Historial.
  await request(app).post('/api/history').set(auth).send({ trackId: 'v1' }).expect(201);
  const hist = await request(app).get('/api/history').set(auth).expect(200);
  assert.equal(hist.body.history.length, 1);
});
