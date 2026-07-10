import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { StreamCache } from '../src/services/streamCache.js';
import {
  createMemoryUserRepo,
  createMemoryPlaylistRepo,
  createMemoryFavoritesRepo,
  createMemoryHistoryRepo,
  createMemoryTrackRepo,
} from '../src/repositories/memory.js';

// statsRepo mínimo (solo para registrar las rutas admin en las pruebas).
const fakeStatsRepo = {
  async incr() {}, async recordSearch() {},
  async userActivity() { return null; },
  async summary() { return { totals: {}, users: [] }; },
};

function buildApp(overrides = {}) {
  return createApp({
    cache: new StreamCache(),
    catalogImpl: async (q) => [{ id: 'v1', title: `${q} song`, artist: 'Tester', durationSeconds: 200 }],
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

// Hardening: cabeceras de seguridad presentes en las respuestas.
test('Hardening: cabeceras de seguridad presentes', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/status').expect(200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-powered-by'], undefined);
});

// Hardening: sin ADMIN_KEY configurada, el panel admin está deshabilitado (503),
// nunca accesible con clave débil.
test('Hardening: panel admin deshabilitado sin ADMIN_KEY', async () => {
  const prev = process.env.ADMIN_KEY;
  delete process.env.ADMIN_KEY;
  try {
    const app = buildApp({ statsRepo: fakeStatsRepo });
    const res = await request(app).get('/api/admin/stats?key=velocity-admin');
    assert.equal(res.status, 503);
  } finally {
    if (prev !== undefined) process.env.ADMIN_KEY = prev;
  }
});

// Hardening: con ADMIN_KEY fuerte, clave incorrecta → 401 (no 503, no 200).
test('Hardening: ADMIN_KEY fuerte rechaza clave incorrecta con 401', async () => {
  const prev = process.env.ADMIN_KEY;
  process.env.ADMIN_KEY = 'una-clave-fuerte-de-prueba';
  try {
    const app = buildApp({ statsRepo: fakeStatsRepo });
    await request(app).get('/api/admin/stats?key=incorrecta').expect(401);
  } finally {
    if (prev !== undefined) process.env.ADMIN_KEY = prev; else delete process.env.ADMIN_KEY;
  }
});

// P0: en production, install del extractor exige ADMIN_KEY.
test('Hardening: POST /api/setup/extractor/install en production sin key → 503/401', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevKey = process.env.ADMIN_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.ADMIN_KEY;
  try {
    const app = buildApp({
      installExtractorImpl: async () => ({ installed: true }),
    });
    const res = await request(app).post('/api/setup/extractor/install');
    assert.ok(res.status === 503 || res.status === 401);
    assert.notEqual(res.status, 200);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevKey !== undefined) process.env.ADMIN_KEY = prevKey; else delete process.env.ADMIN_KEY;
  }
});

test('Hardening: POST /api/setup/extractor/install en production con ADMIN_KEY → 200', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevKey = process.env.ADMIN_KEY;
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_KEY = 'clave-admin-test-ok';
  try {
    const app = buildApp({
      installExtractorImpl: async () => ({ installed: true, path: '/tmp/yt-dlp' }),
      setActiveMode: async () => {},
    });
    await request(app)
      .post('/api/setup/extractor/install')
      .set('X-Admin-Key', 'clave-admin-test-ok')
      .expect(200);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevKey !== undefined) process.env.ADMIN_KEY = prevKey; else delete process.env.ADMIN_KEY;
  }
});

// P0: stream-proxy y resolve no son anónimos.
test('Hardening: stream-proxy sin firma y resolve sin JWT → 401', async () => {
  const app = buildApp();
  await request(app).get('/api/stream-proxy').query({ artist: 'A', title: 'B' }).expect(401);
  await request(app).get('/api/resolve').query({ artist: 'A', title: 'B' }).expect(401);
});
