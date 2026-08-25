import test from 'node:test';
import assert from 'node:assert/strict';
import { DeezerHttpClient } from '../src/extractors/deezerHttp.js';

const silentLogger = { warn() {} };

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('DeezerHttpClient.search devuelve la respuesta JSON de una búsqueda exitosa', async () => {
  const calls = [];
  const payload = { data: [{ id: 123, title: 'Around the World' }], total: 1 };
  const client = new DeezerHttpClient({
    baseUrl: 'https://deezer.test/',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(payload);
    },
    logger: silentLogger,
  });

  const result = await client.search(' Daft Punk ', { limit: 1 });

  assert.deepEqual(result, payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/search/track');
  assert.equal(calls[0].url.searchParams.get('q'), 'Daft Punk');
  assert.equal(calls[0].url.searchParams.get('limit'), '1');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('DeezerHttpClient reintenta 429 con backoff exponencial', async () => {
  const statuses = [429, 429, 200];
  const calls = [];
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    delays.push(delay);
    return realSetTimeout(callback, delay === 250 || delay === 500 ? 0 : delay, ...args);
  };

  try {
    const client = new DeezerHttpClient({
      retryAttempts: 2,
      fetchImpl: async () => {
        calls.push(calls.length + 1);
        const status = statuses.shift();
        return jsonResponse({ data: ['ok'] }, status);
      },
      logger: silentLogger,
    });

    const result = await client.search('test');

    assert.deepEqual(result, { data: ['ok'] });
    assert.equal(calls.length, 3);
    assert.deepEqual(delays.filter((delay) => delay === 250 || delay === 500), [250, 500]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('DeezerHttpClient devuelve null cuando el timeout aborta la petición', async () => {
  let calls = 0;
  let signal;
  const client = new DeezerHttpClient({
    timeoutMs: 10,
    retryAttempts: 3,
    fetchImpl: async (_url, init) => {
      calls += 1;
      signal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('request aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
    logger: silentLogger,
  });

  const result = await client.getTrack('123');

  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('DeezerHttpClient devuelve null para un ID de pista inválido sin llamar a fetch', async () => {
  let calls = 0;
  const client = new DeezerHttpClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ id: 1 });
    },
    logger: silentLogger,
  });

  const result = await client.getTrack({});

  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('DeezerHttpClient conserva streams completos del gateway con calidad solicitada', async () => {
  let requestBody;
  const client = new DeezerHttpClient({
    baseUrl: 'https://deezer.test',
    gatewayUrl: 'https://gateway.test',
    fetchImpl: async (url, options) => {
      assert.ok(url.toString().includes('gateway.test'), 'no debe consultarse la API pública como preview');
      requestBody = options?.body ? JSON.parse(options.body) : null;
      return jsonResponse({ results: { streamUrl: 'https://cdn.test/audio.mp3' } });
    },
    logger: silentLogger,
  });

  const result = await client.getStreamUrl('42', 'MP3_320', 'test-arl-token');

  // With ARL token, it should try gateway API
  assert.deepEqual(result, { stream: 'https://cdn.test/audio.mp3', format: 'MP3_320' });
  assert.equal(requestBody?.method, 'song.getData');
  assert.equal(requestBody?.input?.SNG_ID, '42');
});

test('DeezerHttpClient no sustituye un stream completo por el preview público', async () => {
  let calls = 0;
  const client = new DeezerHttpClient({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ preview: 'https://cdn.test/preview.mp3' });
    },
    logger: silentLogger,
  });

  const result = await client.getStreamUrl('42', 'MP3_320');

  assert.equal(result, null);
  assert.equal(calls, 0, 'sin gateway no debe consultar /track solo para obtener un preview');
});
test('DeezerHttpClient ignora formatos PREVIEW devueltos por el gateway', async () => {
  let calls = 0;
  const client = new DeezerHttpClient({
    gatewayUrl: 'https://gateway.test',
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        results: {
          DATA: { MEDIA: { FORMATS: [{ format: 'PREVIEW', url: 'https://cdn.test/preview.mp3' }] } },
        },
      });
    },
    logger: silentLogger,
  });

  const result = await client.getStreamUrl('42', 'MP3_320', 'test-arl-token');

  assert.equal(result, null);
  assert.equal(calls, 3, 'solo debe probar los métodos del gateway, nunca degradar a /track');
});
