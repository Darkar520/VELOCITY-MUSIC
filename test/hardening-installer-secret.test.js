// Regresión P0 — dos fallos que dependían de que `NODE_ENV` estuviera definido.
//
// 1. `/api/setup/extractor/install` solo exigía ADMIN_KEY si
//    `NODE_ENV === 'production'`. Ese endpoint DESCARGA UN BINARIO al host, así
//    que un despliegue sin esa variable (Docker/PaaS, y este repo: el .env no la
//    define, la fija el guardián) lo dejaba invocable desde Internet.
// 2. El guard del secreto comparaba solo el literal `dev-secret-change-me`, así
//    que `JWT_SECRET=1234` pasaba y firmaba tokens JWT *y* URLs de stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp, MIN_SECRET_LENGTH } from '../src/app.js';
import { StreamCache } from '../src/services/streamCache.js';
import { createMemoryUserRepo } from '../src/repositories/memory.js';

const STRONG_SECRET = 'z'.repeat(MIN_SECRET_LENGTH);

/** App mínima; `installExtractorImpl` cuenta invocaciones reales. */
function buildApp(overrides = {}) {
  return createApp({
    cache: new StreamCache(),
    catalogImpl: async () => [],
    extractorImpl: async () => 'https://cdn.example.com/audio.webm',
    getActiveMode: () => 'full',
    userRepo: createMemoryUserRepo(),
    jwtSecret: STRONG_SECRET,
    staticDir: null,
    ...overrides,
  });
}

/** Ejecuta `fn` con un entorno concreto y restaura el anterior. */
async function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── 1. Installer del extractor ────────────────────────────────

test('installer: sin NODE_ENV y sin clave NO instala (antes quedaba abierto)', async () => {
  await withEnv({ NODE_ENV: undefined, ADMIN_KEY: 'clave-admin-suficientemente-larga' }, async () => {
    let installs = 0;
    const app = buildApp({
      installExtractorImpl: async () => {
        installs += 1;
        return { installed: true };
      },
    });
    const res = await request(app).post('/api/setup/extractor/install');
    assert.equal(res.status, 401, 'debe exigir ADMIN_KEY aunque NODE_ENV no esté definido');
    assert.equal(installs, 0, 'no debe ejecutarse la instalación del binario');
  });
});

test('installer: NODE_ENV=development tampoco abre el endpoint', async () => {
  await withEnv({ NODE_ENV: 'development', ADMIN_KEY: 'clave-admin-suficientemente-larga' }, async () => {
    let installs = 0;
    const app = buildApp({
      installExtractorImpl: async () => {
        installs += 1;
        return { installed: true };
      },
    });
    await request(app).post('/api/setup/extractor/install').expect(401);
    assert.equal(installs, 0);
  });
});

test('installer: clave incorrecta → 401 y sin instalar', async () => {
  await withEnv({ NODE_ENV: undefined, ADMIN_KEY: 'clave-admin-suficientemente-larga' }, async () => {
    let installs = 0;
    const app = buildApp({
      installExtractorImpl: async () => {
        installs += 1;
        return { installed: true };
      },
    });
    await request(app)
      .post('/api/setup/extractor/install')
      .set('X-Admin-Key', 'incorrecta')
      .expect(401);
    assert.equal(installs, 0);
  });
});

test('installer: sin ADMIN_KEY configurada queda deshabilitado (fail-closed)', async () => {
  await withEnv({ NODE_ENV: undefined, ADMIN_KEY: undefined }, async () => {
    let installs = 0;
    const app = buildApp({
      installExtractorImpl: async () => {
        installs += 1;
        return { installed: true };
      },
    });
    await request(app).post('/api/setup/extractor/install').expect(503);
    assert.equal(installs, 0);
  });
});

test('installer: con ADMIN_KEY correcta sigue funcionando', async () => {
  const key = 'clave-admin-suficientemente-larga';
  await withEnv({ NODE_ENV: undefined, ADMIN_KEY: key }, async () => {
    let installs = 0;
    const app = buildApp({
      installExtractorImpl: async () => {
        installs += 1;
        return { installed: true };
      },
    });
    const res = await request(app)
      .post('/api/setup/extractor/install')
      .set('X-Admin-Key', key)
      .expect(200);
    assert.equal(installs, 1);
    assert.equal(res.body.installed, true);
  });
});

// ── 2. Fuerza del secreto compartido ──────────────────────────

test('secreto: en producción un JWT_SECRET corto es rechazado al arrancar', async () => {
  await withEnv({ NODE_ENV: 'production', JWT_SECRET: '1234', ALLOWED_ORIGIN: 'https://x.test' }, async () => {
    assert.throws(
      () => buildApp({ jwtSecret: '1234' }),
      /JWT_SECRET/,
      'un secreto adivinable no debe poder firmar JWT ni URLs de stream',
    );
  });
});

test('secreto: en producción el literal de dev sigue rechazado', async () => {
  await withEnv({ NODE_ENV: 'production', JWT_SECRET: undefined, ALLOWED_ORIGIN: 'https://x.test' }, async () => {
    assert.throws(() => buildApp({ jwtSecret: undefined }), /JWT_SECRET/);
  });
});

test('secreto: en producción un secreto largo arranca', async () => {
  await withEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET, ALLOWED_ORIGIN: 'https://x.test' }, async () => {
    assert.ok(buildApp({ jwtSecret: STRONG_SECRET }));
  });
});

test('secreto: fuera de producción no se impone longitud (dev/tests)', async () => {
  await withEnv({ NODE_ENV: undefined, JWT_SECRET: undefined }, async () => {
    assert.ok(buildApp({ jwtSecret: 'test-secret' }));
  });
});
