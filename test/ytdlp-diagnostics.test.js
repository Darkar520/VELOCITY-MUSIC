import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyYtDlpFailure,
  createYtDlpExtractor,
  getYtDlpLoad,
  getYtDlpDiagnostics,
  probeYtDlp,
  selectAlternateVideoCandidates,
  YtDlpError,
  YTDLP_PROBE_TIMEOUT_MS,
} from '../src/extractors/ytdlp.js';

test('sonda fría permite más de cuatro segundos y publica el resultado recuperado', async () => {
  const budgets = [];
  const ok = await probeYtDlp({
    retries: 0,
    probeOnce: async (timeoutMs) => {
      budgets.push(timeoutMs);
      // Modela el umbral observado en staging sin depender de un binario real.
      return { ok: timeoutMs > 4000, version: 'test-version', timedOut: timeoutMs <= 4000 };
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(budgets, [YTDLP_PROBE_TIMEOUT_MS]);
  assert.ok(YTDLP_PROBE_TIMEOUT_MS >= 10000 && YTDLP_PROBE_TIMEOUT_MS <= 12000);
  const diagnostics = await getYtDlpDiagnostics();
  assert.equal(diagnostics.probeStatus, 'ok');
  assert.equal(diagnostics.version, 'test-version');
});

test('sonda limita los reintentos y el presupuesto solicitado', async () => {
  const budgets = [];
  const ok = await probeYtDlp({
    retries: 100,
    delayMs: 0,
    timeoutMs: 60000,
    probeOnce: async (timeoutMs) => {
      budgets.push(timeoutMs);
      return { ok: false, version: null, timedOut: true };
    },
  });
  assert.equal(ok, false);
  assert.deepEqual(budgets, [12000, 12000]);
});

test('yt-dlp failure classifier distinguishes access, transient, runtime, and timeout causes', () => {
  const cases = [
    ['This song is only available to YouTube Music Premium members', 'YT_PREMIUM_REQUIRED', false],
    ['Sign in to confirm you are not a bot', 'YT_AUTH_REQUIRED', false],
    ['This video is not available in your country', 'YT_GEO_RESTRICTED', false],
    ['HTTP Error 429: Too Many Requests', 'YT_RATE_LIMITED', true],
    ['[PYI-11256:ERROR] Failed to extract Cryptodome\\Cipher\\_ARC4.pyd: decompression resulted in return code -1!', 'YT_DLP_BINARY_BROKEN', false],
    ['No supported JavaScript runtime could be found', 'YT_RUNTIME_UNAVAILABLE', false],
    ['Requested format is not available', 'YT_FORMAT_UNAVAILABLE', true],
  ];
  for (const [output, code, retryable] of cases) {
    const result = classifyYtDlpFailure({ output });
    assert.equal(result.code, code);
    assert.equal(result.retryable, retryable);
    assert.ok(result.message.length > 10);
  }
  assert.equal(classifyYtDlpFailure({ timedOut: true }).code, 'YT_EXTRACTOR_TIMEOUT');
});

test('alternate video candidates require exact title and matching artist credits', () => {
  const candidates = selectAlternateVideoCandidates({
    artist: 'Skrillex, Boys Noize, & Dylan Brady',
    title: 'ZEET NOISE',
    videoId: 'premium-id',
    candidates: [
      { id: 'public-a', title: 'Skrillex, Boys Noize & Dylan Brady - ZEET NOISE', uploader: 'No Paradise Records' },
      { id: 'remix', title: 'Skrillex, Boys Noize & Dylan Brady - ZEET NOISE (LZN EDIT)', uploader: 'LZN' },
      { id: 'wrong-artist', title: 'Skrillex - ZEET NOISE', uploader: 'Random Upload' },
      { id: 'premium-id', title: 'Skrillex, Boys Noize & Dylan Brady - ZEET NOISE', uploader: 'YouTube Music' },
      { id: 'other-song', title: 'Skrillex, Boys Noize & Dylan Brady - Supersonic', uploader: 'Skrillex' },
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.id), ['public-a']);
});

test('el fallback reintenta la búsqueda con términos invertidos si la primera no devuelve candidatos', async () => {
  const searchQueries = [];
  const extract = createYtDlpExtractor({
    logger: { warn() {} },
    runLines: async (args) => {
      searchQueries.push(args[0]);
      if (searchQueries.length === 1) return [];
      return [JSON.stringify({
        id: 'public-a',
        title: 'Skrillex, Boys Noize & Dylan Brady - ZEET NOISE',
        uploader: 'No Paradise Records',
      })];
    },
    runUrl: async (args) => {
      if (args.some((arg) => String(arg).includes('ywdvEkWMdEA'))) {
        throw new YtDlpError({
          code: 'YT_PREMIUM_REQUIRED',
          message: 'Premium',
          retryable: false,
        }, { client: 'default' });
      }
      return 'https://cdn.example.test/zeet-noise.webm';
    },
  });

  const url = await extract({
    artist: 'Skrillex, Boys Noize, & Dylan Brady',
    title: 'ZEET NOISE',
    videoId: 'ywdvEkWMdEA',
    quality: 'high',
  }, { timeoutMs: 18000 });

  assert.equal(url, 'https://cdn.example.test/zeet-noise.webm');
  assert.equal(searchQueries.length, 2);
  assert.match(searchQueries[0], /Skrillex.*ZEET NOISE/);
  assert.match(searchQueries[1], /ZEET NOISE.*Skrillex/);
});

test('yt-dlp load snapshot exposes bounded process and queue capacity', () => {
  const load = getYtDlpLoad();
  assert.ok(Number.isInteger(load.activeProcesses) && load.activeProcesses >= 0);
  assert.ok(Number.isInteger(load.queuedRequests) && load.queuedRequests >= 0);
  assert.ok(load.maxConcurrent >= 1 && load.maxConcurrent <= 16);
  assert.equal(load.maxQueued, load.maxConcurrent * 8);
});

test('public video lookup avoids another executable and retains strict matching', async () => {
  const attempts = [];
  const extract = createYtDlpExtractor({
    logger: { warn() {} },
    searchVideos: async (_query, limit, { signal, timeoutMs }) => {
      assert.equal(limit, 8);
      assert.equal(signal.aborted, false);
      assert.ok(timeoutMs <= 2000);
      return [
        { id: 'remix', title: 'Artist - Song (Remix)', artist: 'Artist' },
        { id: 'public-id', title: 'Artist - Song', artist: 'Artist' },
      ];
    },
    runLines: async () => assert.fail('HTTP candidates must not start a search executable'),
    runUrl: async (args) => {
      const target = args.at(-1);
      attempts.push(target);
      if (target.includes('restricted-id')) throw new YtDlpError({
        code: 'YT_PREMIUM_REQUIRED', message: 'Premium', retryable: false,
      });
      assert.ok(target.includes('public-id'));
      return 'https://cdn.example.test/song.webm';
    },
  });
  assert.equal(await extract({ artist: 'Artist', title: 'Song', videoId: 'restricted-id' }),
    'https://cdn.example.test/song.webm');
  assert.equal(attempts.length, 2);
});

test('cancel during public HTTP lookup aborts it without starting another extractor', async () => {
  const parent = new AbortController();
  let attempts = 0;
  let searchAborted = false;
  const extract = createYtDlpExtractor({
    logger: { warn() {} },
    runUrl: async () => {
      attempts++;
      throw new YtDlpError({ code: 'YT_PREMIUM_REQUIRED', message: 'Premium', retryable: false });
    },
    searchVideos: async (_query, _limit, { signal }) => {
      signal.addEventListener('abort', () => { searchAborted = true; }, { once: true });
      parent.abort();
      return [];
    },
    runLines: async () => assert.fail('must not launch a process after cancellation'),
  });
  await assert.rejects(extract({ artist: 'Artist', title: 'Song', videoId: 'restricted-id' }, {
    signal: parent.signal, timeoutMs: 18000,
  }), { code: 'YT_RESOLUTION_CANCELLED' });
  assert.equal(attempts, 1);
  assert.equal(searchAborted, true);
});

test('una extracción fría de 9 s puede terminar dentro del presupuesto total de 18 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const calls = [];
  const extract = createYtDlpExtractor({
    logger: { warn() {} },
    runUrl: async (_args, timeoutMs, { client }) => {
      calls.push(client);
      t.mock.timers.tick(Math.min(timeoutMs, 9000));
      if (timeoutMs < 9000) {
        throw new YtDlpError(classifyYtDlpFailure({ timedOut: true }));
      }
      return 'https://cdn.example.test/audio.webm';
    },
  });

  const url = await extract({ artist: 'Artist', title: 'Song', videoId: 'public-id' }, { timeoutMs: 18000 });
  assert.equal(url, 'https://cdn.example.test/audio.webm');
  assert.deepEqual(calls, ['default']);
  assert.equal(Date.now(), 109000);
});

test('un intento que agota el plazo total no reinicia otros clientes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  let attempts = 0;
  const extract = createYtDlpExtractor({
    logger: { warn() {} },
    runUrl: async (_args, timeoutMs) => {
      attempts++;
      t.mock.timers.tick(timeoutMs);
      throw new YtDlpError(classifyYtDlpFailure({ timedOut: true }));
    },
  });

  await assert.rejects(
    extract({ artist: 'Artist', title: 'Song' }, { timeoutMs: 18000 }),
    { code: 'YT_EXTRACTOR_TIMEOUT' },
  );
  assert.equal(attempts, 1);
  assert.equal(Date.now(), 118000);
});

test('cancelar durante la extracción impide lanzar clientes o búsquedas adicionales', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const extract = createYtDlpExtractor({
    logger: { warn() {} },
    runUrl: async (_args, _timeoutMs, { signal }) => {
      attempts++;
      assert.equal(signal, controller.signal);
      controller.abort();
      throw new YtDlpError(classifyYtDlpFailure({ cancelled: true }));
    },
    runLines: async () => assert.fail('No debe buscar tras cancelar'),
  });

  await assert.rejects(
    extract({ artist: 'Artist', title: 'Song', videoId: 'public-id' }, {
      timeoutMs: 18000, signal: controller.signal,
    }),
    { code: 'YT_RESOLUTION_CANCELLED' },
  );
  assert.equal(attempts, 1);
});
