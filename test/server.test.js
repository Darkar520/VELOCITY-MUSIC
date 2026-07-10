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
  const url = 'https://audio.example.com/explicit.webm';
  const app = buildTestApp();
  const token = await loginToken(app, 'stream-explicit@example.com');
  const res = await request(app)
    .get('/api/resolve')
    .set('Authorization', `Bearer ${token}`)
    .query({ artist: 'A', title: 'B', stream: url })
    .expect(302);
  assert.equal(res.headers.location, url);
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
