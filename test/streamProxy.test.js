import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Writable } from 'node:stream';
import {
  validateProxyParams,
  buildResponseHeaders,
  classifyUpstreamStatus,
  createStreamProxyHandler,
  planUpstreamRange,
  parseContentRange,
  RANGE_CHUNK_BYTES,
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

// res tipo Writable que acumula el cuerpo (para el modo 'full' que hace pipe).
function makeStreamingRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
  });
  res.statusCode = null; res.body = null; res.headers = null; res.headersSent = false;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; res.headersSent = true; };
  res.writeHead = (c, h) => { res.statusCode = c; res.headers = h; res.headersSent = true; };
  res.chunks = chunks;
  return res;
}

// Body web a partir de un Buffer (lo que devuelve fetch de Node).
function webBody(buf) {
  return new Response(buf).body;
}

function contentRange(start, end, total) {
  return { start, end, total };
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

// Feature: velocity-music-streaming, Property 18 (actualizada 2026-08):
// Los Range ACOTADOS y dentro del límite de chunk se reenvían sin modificar;
// los abiertos o grandes se acotan a RANGE_CHUNK_BYTES porque googlevideo
// (cliente android_vr) responde 403 a rangos abiertos y a chunks > ~1 MiB.
test('Property 18: Range acotado pequeño se reenvía sin modificar', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 100000 }),
      fc.integer({ min: 1, max: RANGE_CHUNK_BYTES }),
      async (start, len) => {
        const end = start + len - 1;
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

// ── planUpstreamRange: casos concretos de la normalización ──
test('planUpstreamRange: normalización de rangos de cliente', () => {
  assert.deepEqual(planUpstreamRange(undefined), { kind: 'full' });
  assert.deepEqual(planUpstreamRange(''), { kind: 'full' });
  assert.deepEqual(planUpstreamRange('bytes=0-'), {
    kind: 'bounded', range: `bytes=0-${RANGE_CHUNK_BYTES - 1}`,
  });
  assert.deepEqual(planUpstreamRange('bytes=100000-'), {
    kind: 'bounded', range: `bytes=100000-${100000 + RANGE_CHUNK_BYTES - 1}`,
  });
  assert.deepEqual(planUpstreamRange('bytes=0-1023'), { kind: 'passthrough', range: 'bytes=0-1023' });
  assert.deepEqual(planUpstreamRange(`bytes=0-${RANGE_CHUNK_BYTES - 1}`), {
    kind: 'passthrough', range: `bytes=0-${RANGE_CHUNK_BYTES - 1}`,
  });
  // Un byte más que el chunk → se acota.
  assert.deepEqual(planUpstreamRange(`bytes=0-${RANGE_CHUNK_BYTES}`), {
    kind: 'bounded', range: `bytes=0-${RANGE_CHUNK_BYTES - 1}`,
  });
  // Rango acotado enorme (petición típica de Chrome) → acotado.
  assert.deepEqual(planUpstreamRange('bytes=0-15728640'), {
    kind: 'bounded', range: `bytes=0-${RANGE_CHUNK_BYTES - 1}`,
  });
  // Sufijo y basura → passthrough (lo decide el upstream).
  assert.deepEqual(planUpstreamRange('bytes=-500'), { kind: 'passthrough', range: 'bytes=-500' });
  assert.deepEqual(planUpstreamRange('garbage'), { kind: 'passthrough', range: 'garbage' });
});

// Propiedad: para cualquier rango con start válido, el plan nunca deja un
// rango abierto o mayor que RANGE_CHUNK_BYTES hacia upstream.
test('planUpstreamRange PBT: nunca envía rangos abiertos ni chunks grandes', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 10 ** 9 }), fc.integer({ min: 0, max: 10 ** 9 }), (a, b) => {
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (const range of [`bytes=${start}-`, `bytes=${start}-${end}`]) {
        const plan = planUpstreamRange(range);
        assert.ok(plan.kind === 'passthrough' || plan.kind === 'bounded');
        const m = /^bytes=(\d+)-(\d+)$/.exec(plan.range);
        assert.ok(m, `el plan debe ser un rango acotado, fue ${plan.range}`);
        const planStart = Number(m[1]);
        const planEnd = Number(m[2]);
        assert.equal(planStart, start, 'el start debe conservarse');
        assert.ok(planEnd - planStart + 1 <= RANGE_CHUNK_BYTES, 'el chunk no debe superar el límite');
      }
    }),
    RUNS,
  );
});

// ── parseContentRange ──
test('parseContentRange: parses válido, null ante basura', () => {
  assert.deepEqual(parseContentRange('bytes 0-524287/3810167'), contentRange(0, 524287, 3810167));
  assert.deepEqual(parseContentRange('bytes */3810167'), { start: null, end: null, total: 3810167 });
  assert.deepEqual(parseContentRange('bytes 0-524287/*'), { start: 0, end: 524287, total: null });
  assert.equal(parseContentRange('bytes 5-3/10'), null);
  assert.equal(parseContentRange('garbage'), null);
  assert.equal(parseContentRange(null), null);
});

// ── Handler: rangos abiertos del navegador → chunk acotado upstream ──
test('Handler: bytes=0- del navegador se acota a un chunk y se responde 206', async () => {
  let forwarded;
  const fetchImpl = async (_url, init) => {
    forwarded = init.headers.Range;
    return {
      status: 206,
      headers: new Map([
        ['content-type', 'audio/webm'],
        ['content-range', `bytes 0-${RANGE_CHUNK_BYTES - 1}/3000000`],
        ['content-length', String(RANGE_CHUNK_BYTES)],
      ]),
      body: null,
    };
  };
  const handler = createStreamProxyHandler({ resolveUrl: async () => ({ url: 'https://cdn/audio' }), fetchImpl });
  const res = makeRes();
  await handler({ query: { artist: 'A', title: 'B' }, headers: { range: 'bytes=0-' } }, res);
  assert.equal(forwarded, `bytes=0-${RANGE_CHUNK_BYTES - 1}`);
  assert.equal(res.statusCode, 206);
});

// ── Handler: seek del navegador (bytes=N-) → chunk acotado desde N ──
test('Handler: seek bytes=1500000- se acota a un chunk desde 1500000', async () => {
  let forwarded;
  const fetchImpl = async (_url, init) => {
    forwarded = init.headers.Range;
    return {
      status: 206,
      headers: new Map([
        ['content-type', 'audio/webm'],
        ['content-range', `bytes 1500000-${1500000 + RANGE_CHUNK_BYTES - 1}/3000000`],
      ]),
      body: null,
    };
  };
  const handler = createStreamProxyHandler({ resolveUrl: async () => ({ url: 'https://cdn/audio' }), fetchImpl });
  const res = makeRes();
  await handler({ query: { artist: 'A', title: 'B' }, headers: { range: 'bytes=1500000-' } }, res);
  assert.equal(forwarded, `bytes=1500000-${1500000 + RANGE_CHUNK_BYTES - 1}`);
  assert.equal(res.statusCode, 206);
});

// ── Handler: sin Range (descargas/prebuffer) → encadena chunks y responde 200
// con el cuerpo completo ──
test('Handler: sin Range encadena chunks acotados y entrega el cuerpo completo como 200', async () => {
  const chunk = RANGE_CHUNK_BYTES;
  const total = 2 * chunk + 1234;
  const bodies = [Buffer.alloc(chunk, 1), Buffer.alloc(chunk, 2), Buffer.alloc(1234, 3)];
  const fetchedRanges = [];
  const fetchImpl = async (_url, init) => {
    const range = init.headers.Range;
    fetchedRanges.push(range);
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(m[1]);
    const end = Number(m[2]);
    const i = Math.floor(start / chunk);
    const body = bodies[i];
    const realEnd = Math.min(end, start + body.length - 1);
    return {
      status: 206,
      headers: new Map([
        ['content-type', 'audio/webm'],
        ['content-range', `bytes ${start}-${realEnd}/${total}`],
        ['content-length', String(body.length)],
      ]),
      body: webBody(body),
    };
  };
  const handler = createStreamProxyHandler({ resolveUrl: async () => ({ url: 'https://cdn/audio' }), fetchImpl });
  const res = makeStreamingRes();
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(fetchedRanges.length, 3, '3 chunks para 2×512KiB + 1234B');
  assert.equal(fetchedRanges[0], `bytes=0-${chunk - 1}`);
  assert.equal(fetchedRanges[1], `bytes=${chunk}-${2 * chunk - 1}`);
  assert.equal(fetchedRanges[2], `bytes=${2 * chunk}-${3 * chunk - 1}`);
  const joined = Buffer.concat(res.chunks);
  assert.equal(joined.length, total, 'el cuerpo entregado debe ser el archivo completo');
});

// ── Handler: sin Range y upstream que ignora Range (CDN normal) → 200 tal cual ──
test('Handler: sin Range con upstream 200 se sirve tal cual (compatibilidad)', async () => {
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return { status: 200, headers: new Map([['content-type', 'audio/webm']]), body: null };
  };
  const handler = createStreamProxyHandler({ resolveUrl: async () => ({ url: 'https://cdn/audio' }), fetchImpl });
  const res = makeRes();
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(fetchCount, 1, 'un solo fetch cuando el upstream responde 200');
});

// ── Handler: 403 en el primer chunk sin Range → reintento forceRefresh ──
test('Handler: 403 en modo full dispara reintento con forceRefresh', async () => {
  let resolveCount = 0;
  let forced = false;
  const resolveUrl = async (_params, opts = {}) => {
    resolveCount += 1;
    if (opts.forceRefresh) forced = true;
    return { url: resolveCount === 1 ? 'https://cdn/expired' : 'https://cdn/fresh' };
  };
  const fetchImpl = async (url) => ({
    status: url.includes('expired') ? 403 : 206,
    headers: new Map([
      ['content-type', 'audio/webm'],
      ['content-range', `bytes 0-${RANGE_CHUNK_BYTES - 1}/${RANGE_CHUNK_BYTES}`],
    ]),
    body: url.includes('expired') ? null : webBody(Buffer.alloc(RANGE_CHUNK_BYTES, 7)),
  });
  const handler = createStreamProxyHandler({ resolveUrl, fetchImpl, timeoutMs: 5000 });
  const res = makeStreamingRes();
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, res);
  assert.equal(resolveCount, 2);
  assert.equal(forced, true);
  assert.equal(res.statusCode, 200);
  assert.equal(Buffer.concat(res.chunks).length, RANGE_CHUNK_BYTES);
});

// Feature: velocity-music-streaming, Property 19: Validación de entrada del
// proxy. Para todo par inválido → 400 y no inicia petición upstream.
// Validates: Requirements 4.5
test('Property 19: validación de entrada del proxy', async () => {
  // validateProxyParams puro
  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant(''),
        fc.constant('   '),
        // String de 257+ chars que sigue siendo inválido DESPUÉS de trim:
        // garantizamos que no sean solo espacios añadiendo caracteres no-espacio.
        fc.string({ minLength: 1, maxLength: 44 }).map(s => s.replace(/\s/g, 'x') + 'x'.repeat(256)),
      ),
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
  res.headersSent = true;
  const handler = createStreamProxyHandler({
    resolveUrl: async () => ({ url: 'https://x' }),
    fetchImpl: async () => {
      throw new Error('caída tras cabeceras');
    },
  });
  await handler({ query: { artist: 'A', title: 'B' }, headers: {} }, res);
  assert.equal(res.ended, true);
});
