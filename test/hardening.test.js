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
