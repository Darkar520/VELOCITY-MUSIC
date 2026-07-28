// Un 500 sin traza convierte depurar en adivinar: `wrap()` mapeaba toda
// excepción no tipada a `{ error: 'Error interno.' }` y descartaba el error.
// Estas pruebas fijan que ahora se registra, sin filtrar nada al cliente y sin
// dejar credenciales (exp/sig, ADMIN_KEY) en el log.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { formatErrorLog, logServerError } from '../src/lib/logError.js';
import { createApp } from '../src/app.js';
import { StreamCache } from '../src/services/streamCache.js';
import { createMemoryUserRepo } from '../src/repositories/memory.js';

/** Logger de prueba: captura las líneas en vez de escribir en consola. */
function fakeLogger() {
  const lines = [];
  return { lines, error: (l) => lines.push(String(l)) };
}

// ── Formateo ──────────────────────────────────────────────────

test('formatErrorLog: incluye método, ruta, estado y mensaje', () => {
  const line = formatErrorLog({
    method: 'get',
    path: '/api/playlists',
    status: 500,
    err: new Error('boom'),
    now: new Date('2026-07-27T12:00:00.000Z'),
  });
  assert.match(line, /^\[error\] 2026-07-27T12:00:00\.000Z GET \/api\/playlists → 500: boom$/);
});

test('formatErrorLog: no registra el query string de rutas sensibles', () => {
  for (const path of [
    '/api/stream-proxy?artist=A&exp=1&sig=SECRETO',
    '/api/stream-sign?artist=A&sig=SECRETO',
    '/api/admin/stats?key=CLAVE',
    '/api/setup/extractor/install?key=CLAVE',
  ]) {
    const line = formatErrorLog({ method: 'GET', path, err: new Error('x') });
    assert.ok(!line.includes('SECRETO'), line);
    assert.ok(!line.includes('CLAVE'), line);
    assert.ok(!line.includes('?'), line);
  }
});

test('formatErrorLog: tolera errores no-Error y contexto ausente', () => {
  assert.match(formatErrorLog({ err: 'texto suelto' }), /500: texto suelto/);
  assert.match(formatErrorLog({}), /- - → 500: error desconocido/);
});

test('logServerError: emite la línea y el stack', () => {
  const logger = fakeLogger();
  logServerError({ logger, method: 'POST', path: '/api/x', err: new Error('fallo') });
  assert.equal(logger.lines.length, 2);
  assert.match(logger.lines[0], /POST \/api\/x → 500: fallo/);
  assert.match(logger.lines[1], /at /);
});

test('logServerError: sin stack registra solo la línea', () => {
  const logger = fakeLogger();
  logServerError({ logger, method: 'GET', path: '/api/y', err: 'plano' });
  assert.equal(logger.lines.length, 1);
});

// ── Integración: el 500 deja rastro y no filtra detalles ──────

/** Captura console.error durante `fn`. */
async function withCapturedConsole(fn) {
  const original = console.error;
  const captured = [];
  console.error = (...args) => captured.push(args.map(String).join(' '));
  try {
    return { result: await fn(), captured };
  } finally {
    console.error = original;
  }
}

function buildApp(overrides = {}) {
  return createApp({
    cache: new StreamCache(),
    catalogImpl: async () => [],
    extractorImpl: async () => null,
    getActiveMode: () => 'full',
    userRepo: createMemoryUserRepo(),
    jwtSecret: 'test-secret',
    staticDir: null,
    ...overrides,
  });
}

// `wrap()` es el camino de los handlers async: un fallo NO tipado debe quedar
// registrado y responder 500 genérico. Antes se perdía por completo.
test('wrap(): un error inesperado responde 500 genérico y registra la causa', async () => {
  const prevKey = process.env.ADMIN_KEY;
  process.env.ADMIN_KEY = 'clave-admin-suficientemente-larga';
  try {
    const statsRepo = {
      async incr() {}, async recordSearch() {},
      async userActivity() { return null; },
      async summary() { throw new Error('detalle-interno-no-publicable'); },
    };
    const { result: res, captured } = await withCapturedConsole(() => request(buildApp({ statsRepo }))
      .get('/api/admin/stats')
      .set('X-Admin-Key', 'clave-admin-suficientemente-larga'));

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Error interno.' });
    assert.ok(
      !JSON.stringify(res.body).includes('detalle-interno-no-publicable'),
      'el cliente no debe ver el detalle interno',
    );
    assert.ok(
      captured.some((l) => l.includes('detalle-interno-no-publicable')),
      'la causa debe quedar en el log del servidor',
    );
    assert.ok(captured.some((l) => l.includes('/api/admin/stats')), 'debe registrarse la ruta');
  } finally {
    if (prevKey !== undefined) process.env.ADMIN_KEY = prevKey; else delete process.env.ADMIN_KEY;
  }
});

// El manejador global cubre `next(err)` de middleware (aquí express.json con un
// body malformado). Debe conservar el 4xx: convertirlo en 500 culparía al
// servidor de un error del cliente, y además llenaría el log de ruido.
test('manejador global: un body JSON malformado sigue siendo 4xx y no se registra', async () => {
  const { result: res, captured } = await withCapturedConsole(() => request(buildApp())
    .post('/api/tracks')
    .set('Content-Type', 'application/json')
    .send('{"tracks": ['));

  assert.ok(res.status >= 400 && res.status < 500, `estado ${res.status}`);
  assert.equal(typeof res.body.error, 'string', 'la respuesta debe ser JSON, no HTML');
  assert.equal(captured.length, 0, 'un 4xx no debe generar log de error de servidor');
});
