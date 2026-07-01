import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  validateProxyParams,
  buildResponseHeaders,
  classifyUpstreamStatus,
  createStreamProxyHandler,
} from '../src/services/streamProxy.js';

const RUNS = { numRuns: 100 };

// Mock mínimo de res de Express para capturar la respuesta.
function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: null,
    headersSent: false,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      this.headersSent = true;
      return this;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
      this.headersSent = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

// Feature: velocity-music-streaming, Property 17: El proxy preserva las cabeceras
// de audio relevantes. Content-Type del upstream, Accept-Ranges: bytes, y
// Content-Range/Content-Length cuando el upstream los provee.
// Validates: Requirements 4.1, 4.3, 4.4
test('Property 17: preserva cabeceras de audio relevantes', () => {
  fc.assert(
    fc.property(
      fc.record({
        'content-type': fc.option(fc.constantFrom('audio/webm', 'audio/mp4', 'audio/aac'), {
          nil: undefined,
        }),
        'content-range': fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        'content-length': fc.option(fc.integer({ min: 0 }).map(String), { nil: undefined }),
      }),
      (up) => {
        const getHeader = (name) => up[name];
        const h = buildResponseHeaders(getHeader);
        assert.equal(h['Accept-Ranges'], 'bytes');
        assert.equal(h['Content-Type'], up['content-type'] || 'audio/mp4');
        if (up['content-range']) {
          assert.equal(h['content-range'], up['content-range']);
        } else {
          assert.ok(!('content-range' in h));
        }
        if (up['content-length']) {
          assert.equal(h['content-length'], up['content-length']);
        }
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 18: El proxy reenvía la cabecera
// Range sin modificar.
// Validates: Requirements 4.2
test('Property 18: reenvía Range sin modificar', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 100000 }),
      fc.integer({ min: 100001, max: 999999 }),
      async (start, end) => {
        const rangeValue = `bytes=${start}-${end}`;
        let forwarded;
        const fetchImpl = async (_url, init) => {
          forwarded = init.headers.Range;
          return {
            status: 206,
            headers: new Map([['content-type', 'audio/webm']]),
            body: null,
          };
        };
        const handler = createStreamProxyHandler({
          resolveUrl: async () => ({ url: 'https://cdn/audio' }),
          fetchImpl,
        });
        const req = { query: { artist: 'A', title: 'B' }, headers: { range: rangeValue } };
        await handler(req, makeRes());
        assert.equal(forwarded, rangeValue);
      },
    ),
    RUNS,
  );
});

// Feature: velocity-music-streaming, Property 19: Validación de entrada del
// proxy. Para todo par inválido → 400 y no inicia petición upstream.
// Validates: Requirements 4.5
test('Property 19: validación de entrada del proxy', async () => {
  // validateProxyParams puro
  fc.assert(
    fc.property(
      fc.oneof(fc.constant(''), fc.constant('   '), fc.string({ minLength: 257, maxLength: 300 })),
      fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length >= 1),
      (badArtist, okTitle) => {
        const v = validateProxyParams(badArtist, okTitle);
        assert.equal(v.ok, false);
      },
    ),
    RUNS,
  );

  // El handler no llama a fetch cuando la validación falla.
  let fetchCalled = false;
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://x' }),
    fetchImpl: async () => {
      fetchCalled = true;
      return { status: 200, headers: new Map(), body: null };
    },
  });
  const res = makeRes();
  await handler({ query: { artist: '  ', title: 'B' }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(fetchCalled, false);
});

// Feature: velocity-music-streaming, Property 20: Mapeo de fallos upstream del
// proxy a 502/504. Código != 200/206 → 502; timeout/fallo de conexión → 504.
// Validates: Requirements 4.6, 4.7
test('Property 20: mapeo de fallos upstream a 502/504', async () => {
  // classifyUpstreamStatus puro.
  fc.assert(
    fc.property(fc.integer({ min: 100, max: 599 }), (status) => {
      const cls = classifyUpstreamStatus(status);
      if (status === 200 || status === 206) {
        assert.equal(cls.pass, true);
      } else {
        assert.equal(cls.pass, false);
        assert.equal(cls.status, 502);
      }
    }),
    RUNS,
  );

  // Código inesperado → 502.
  const res502 = makeRes();
  await createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://x' }),
    fetchImpl: async () => ({ status: 403, headers: new Map(), body: null }),
  })({ query: { artist: 'A', title: 'B' }, headers: {} }, res502);
  assert.equal(res502.statusCode, 502);

  // Fallo de conexión / abort → 504.
  const res504 = makeRes();
  await createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://x' }),
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  })({ query: { artist: 'A', title: 'B' }, headers: {} }, res504);
  assert.equal(res504.statusCode, 504);
});

// Unit (7.6 del plan): error tras enviar cabeceras → termina sin estado adicional.
// Validates: Requirements 4.8
test('Unit: error tras cabeceras enviadas termina sin estado', async () => {
  const res = makeRes();
  // body cuyo pipe lanzará no aplica aquí; simulamos headersSent + error en fetch
  // posterior no es trivial. Validamos la rama headersSent del handler:
  res.headersSent = true;
  // Forzamos un fetch que lanza tras marcar headersSent.
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://x' }),
    fetchImpl: async () => {
      throw new Error('caída tras cabeceras');
    },
  });
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, res);
  // Como headersSent ya era true, no se envía nuevo estado; se termina la respuesta.
  assert.equal(res.ended, true);
});
