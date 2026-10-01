import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyYtDlpFailure,
  getYtDlpLoad,
  getYtDlpDiagnostics,
  probeYtDlp,
  selectAlternateVideoCandidates,
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

test('yt-dlp load snapshot exposes bounded process and queue capacity', () => {
  const load = getYtDlpLoad();
  assert.ok(Number.isInteger(load.activeProcesses) && load.activeProcesses >= 0);
  assert.ok(Number.isInteger(load.queuedRequests) && load.queuedRequests >= 0);
  assert.ok(load.maxConcurrent >= 1 && load.maxConcurrent <= 16);
  assert.equal(load.maxQueued, load.maxConcurrent * 8);
});
