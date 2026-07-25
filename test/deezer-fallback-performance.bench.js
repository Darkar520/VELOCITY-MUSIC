/*
 * NON-PRODUCTIVE BENCHMARK — Task 12.3 only.
 * Deterministic synthetic mocks; no network, credentials, or external APIs.
 * Run directly: node --expose-gc test/deezer-fallback-performance.bench.js
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from '../src/services/audioResolver.js';
import { StreamCache } from '../src/services/streamCache.js';

const CONFIG = Object.freeze({
  providerSamples: 256,
  cacheSamples: 256,
  concurrency: 32,
  concurrencyBatches: 128,
  memoryEntries: 10_000,
  memoryCycles: 20,
  youtubeDelayMs: 2,
  deezerDelayMs: 3,
});
const REPORT_PATH = new URL('./deezer-fallback-performance.report.md', import.meta.url);
const URL_PREFIX = 'https://synthetic.invalid/audio/';

const delay = (milliseconds) => new Promise((resolve_) => setTimeout(resolve_, milliseconds));
const trackFor = (index) => ({ artist: `Synthetic Artist ${index}`, title: `Synthetic Track ${index}` });
const urlFor = (provider, index) => `${URL_PREFIX}${provider}/${index}.mp3`;

function percentile(values, percentage) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percentage / 100) * ordered.length));
  return ordered[rank - 1];
}

function summary(samples, totalElapsedMs = undefined) {
  const errors = samples.filter((sample) => sample.error).length;
  const durations = samples.filter((sample) => !sample.error).map((sample) => sample.ms);
  const elapsedMs = totalElapsedMs ?? samples.reduce((sum, sample) => sum + sample.ms, 0);
  return {
    samples: samples.length,
    successfulSamples: durations.length,
    errors,
    errorRate: samples.length ? errors / samples.length : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    minMs: durations.length ? Math.min(...durations) : null,
    maxMs: durations.length ? Math.max(...durations) : null,
    throughputPerSecond: elapsedMs > 0 ? samples.length / (elapsedMs / 1000) : null,
  };
}

async function timed(operation) {
  const start = performance.now();
  try {
    const result = await operation();
    return { ms: performance.now() - start, result, error: null };
  } catch (error) {
    return { ms: performance.now() - start, result: null, error: String(error?.message || error) };
  }
}

function assertResolution(result, expectedProvider = undefined) {
  const providerMismatch = expectedProvider !== undefined && result?.provider !== expectedProvider;
  if (!result || result.status !== 302 || providerMismatch) {
    throw new Error(`unexpected resolution result: ${JSON.stringify(result)}`);
  }
}

function youtubeMock() {
  return async ({ title }) => {
    await delay(CONFIG.youtubeDelayMs);
    const index = Number(title.match(/(\d+)$/)?.[1]);
    return urlFor('youtube', index);
  };
}

function deezerFallbackMock() {
  return async ({ title }) => {
    await delay(CONFIG.deezerDelayMs);
    const index = Number(title.match(/(\d+)$/)?.[1]);
    return urlFor('deezer', index);
  };
}

async function measureProviderResolution(provider) {
  const samples = [];
  const youtube = provider === 'youtube' ? youtubeMock() : async () => null;
  const deezer = provider === 'deezer' ? deezerFallbackMock() : undefined;
  for (let index = 0; index < CONFIG.providerSamples + 20; index += 1) {
    const measurement = await timed(async () => {
      const result = await resolve(trackFor(index), {
        cache: new StreamCache(),
        mode: 'full',
        extractorImpl: youtube,
        deezerExtractorImpl: deezer,
      });
      assertResolution(result, provider === 'deezer' ? 'deezer' : undefined);
      return result;
    });
    if (index >= 20) samples.push(measurement);
  }
  return summary(samples);
}

async function measureCacheColdWarm() {
  const coldSamples = [];
  const warmSamples = [];
  let warmHits = 0;
  const youtube = async () => null;
  const deezer = deezerFallbackMock();

  for (let index = 0; index < CONFIG.cacheSamples + 20; index += 1) {
    const cache = new StreamCache();
    const track = trackFor(index);
    const cold = await timed(async () => {
      const result = await resolve(track, {
        cache,
        mode: 'full',
        extractorImpl: youtube,
        deezerExtractorImpl: deezer,
      });
      assertResolution(result, 'deezer');
      if (result.fromCache) throw new Error('cold request unexpectedly hit cache');
      return result;
    });
    const warm = await timed(async () => {
      const result = await resolve(track, {
        cache,
        mode: 'full',
        extractorImpl: youtube,
        deezerExtractorImpl: deezer,
      });
      assertResolution(result, 'deezer');
      if (!result.fromCache) throw new Error('warm request missed cache');
      return result;
    });
    if (warm.result?.fromCache) warmHits += 1;
    if (index >= 20) {
      coldSamples.push(cold);
      warmSamples.push(warm);
    }
  }

  return {
    coldMissResolution: summary(coldSamples),
    warmHitResolution: summary(warmSamples),
    warmHitCount: warmHits - 20,
    cacheEffectiveness: (warmHits - 20) / CONFIG.cacheSamples,
  };
}

async function measureConcurrentResolutions() {
  const samples = [];
  const cache = new StreamCache();
  const youtube = async ({ title }) => {
    const index = Number(title.match(/(\d+)$/)?.[1]);
    await delay(CONFIG.youtubeDelayMs);
    return index % 11 === 0 ? null : urlFor('youtube', index);
  };
  const deezer = async ({ title }) => {
    const index = Number(title.match(/(\d+)$/)?.[1]);
    await delay(CONFIG.deezerDelayMs);
    return index % 53 === 0 ? null : urlFor('deezer', index);
  };
  let successful = 0;
  let degraded = 0;
  let thrown = 0;
  const batchStart = performance.now();

  for (let batch = 0; batch < CONFIG.concurrencyBatches; batch += 1) {
    const requests = Array.from({ length: CONFIG.concurrency }, (_, offset) => {
      const index = batch * CONFIG.concurrency + offset;
      return timed(async () => resolve(trackFor(index), {
        cache,
        mode: 'full',
        extractorImpl: youtube,
        deezerExtractorImpl: deezer,
      }));
    });
    const results = await Promise.all(requests);
    for (const measurement of results) {
      samples.push(measurement);
      if (measurement.error) {
        thrown += 1;
      } else if (measurement.result?.status === 302) {
        successful += 1;
      } else {
        degraded += 1;
      }
    }
  }

  const elapsedMs = performance.now() - batchStart;
  return {
    configuration: {
      concurrency: CONFIG.concurrency,
      batches: CONFIG.concurrencyBatches,
      totalRequests: CONFIG.concurrency * CONFIG.concurrencyBatches,
      sharedCache: true,
      deterministicFailureRules: 'YouTube fails when index%11===0; Deezer fails when index%53===0',
    },
    latency: summary(samples, elapsedMs),
    successful,
    degraded,
    thrown,
    failureRate: (degraded + thrown) / samples.length,
    elapsedMs,
    throughputPerSecond: samples.length / (elapsedMs / 1000),
    finalCacheEntries: cache.size(),
  };
}

function memorySnapshot(cache) {
  const memory = process.memoryUsage();
  return {
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    rssBytes: memory.rss,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    cacheEntries: cache.size(),
  };
}

function forceGc() {
  if (typeof global.gc === 'function') global.gc();
}

async function measureMemory() {
  const cache = new StreamCache();
  const forcedGc = typeof global.gc === 'function';
  forceGc();
  const initial = memorySnapshot(cache);
  let peak = { ...initial };
  const postGcCheckpoints = [];

  for (let cycle = 0; cycle <= CONFIG.memoryCycles; cycle += 1) {
    for (let index = 0; index < CONFIG.memoryEntries; index += 1) {
      cache.set(`deezer:memory:${index}`, urlFor('deezer-memory', index), {
        provider: 'deezer',
        ttlSeconds: 3600,
      });
      if (index % 1000 === 0) {
        const current = memorySnapshot(cache);
        if (current.heapUsedBytes > peak.heapUsedBytes) peak = current;
        if (current.rssBytes > peak.rssBytes) peak = { ...peak, rssBytes: current.rssBytes };
      }
    }
    forceGc();
    const checkpoint = memorySnapshot(cache);
    postGcCheckpoints.push(checkpoint);
    if (checkpoint.heapUsedBytes > peak.heapUsedBytes) peak = checkpoint;
    if (checkpoint.rssBytes > peak.rssBytes) peak = { ...peak, rssBytes: checkpoint.rssBytes };
  }

  forceGc();
  const final = memorySnapshot(cache);
  const baseline = postGcCheckpoints[0];
  const retainedGrowthBytes = final.heapUsedBytes - baseline.heapUsedBytes;
  const cacheBoundRespected = final.cacheEntries <= CONFIG.memoryEntries;
  const abnormalGrowthSignal = !cacheBoundRespected || retainedGrowthBytes > 10 * 1024 * 1024;

  return {
    configuration: {
      entries: CONFIG.memoryEntries,
      updateCycles: CONFIG.memoryCycles,
      cacheTtlSeconds: 3600,
      forcedGc,
      growthSignalRule: 'signal if cache exceeds configured entries or post-GC heap grows >10 MiB after first fill',
    },
    initial,
    baselineAfterFirstFill: baseline,
    final,
    peak,
    retainedGrowthBytes,
    cacheBoundRespected,
    abnormalGrowthSignal,
  };
}

function formatMs(value) {
  return value === null ? 'n/a' : `${value.toFixed(3)} ms`;
}

function formatBytes(value) {
  return `${value} B (${(value / 1024 / 1024).toFixed(3)} MiB)`;
}

function formatRate(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(3)}%`;
}

function latencyRow(label, data) {
  return `| ${label} | ${data.samples} | ${formatMs(data.p50Ms)} | ${formatMs(data.p95Ms)} | ${formatMs(data.p99Ms)} | ${data.throughputPerSecond.toFixed(2)} | ${data.errors} | ${formatRate(data.errorRate)} |`;
}

function renderReport(results) {
  const memory = results.memory;
  return `# Task 12.3 — deterministic performance report

> NON-PRODUCTIVE TEST ARTIFACT. Generated from synthetic in-process mocks only. No Deezer, YouTube Music, external API, network, or credentials were used.

## Reproducibility

- Command: \`node --expose-gc test/deezer-fallback-performance.bench.js\`
- Node: \`${process.version}\`
- Provider samples: ${CONFIG.providerSamples} measured samples per provider, after 20 warm-up calls.
- Cache samples: ${CONFIG.cacheSamples} cold/warm pairs, after 20 warm-up pairs.
- Synthetic delays: YouTube Music ${CONFIG.youtubeDelayMs} ms; Deezer fallback ${CONFIG.deezerDelayMs} ms.
- URLs, artists, titles, failures, concurrency, cache keys, and TTLs are synthetic and deterministic.

## Resolution and cache latency

| Scenario | Samples | p50 | p95 | p99 | Throughput (ops/s) | Errors | Error rate |
|---|---:|---:|---:|---:|---:|---:|---:|
${latencyRow('YouTube Music mock success', results.youtube)}
${latencyRow('Deezer mock fallback success', results.deezer)}
${latencyRow('StreamCache cold miss + resolution', results.cache.coldMissResolution)}
${latencyRow('StreamCache warm hit', results.cache.warmHitResolution)}

Cache warm hits: ${results.cache.warmHitCount}/${CONFIG.cacheSamples} (${(results.cache.cacheEffectiveness * 100).toFixed(3)}%). The warm path was verified by \`fromCache: true\`; the cold path by \`fromCache: false\`.

## Concurrent resolutions

- Configuration: ${results.concurrency.configuration.concurrency} concurrent requests per batch, ${results.concurrency.configuration.batches} batches, ${results.concurrency.configuration.totalRequests} total requests, one shared in-memory cache.
- Deterministic failure rules: ${results.concurrency.configuration.deterministicFailureRules}.
- Wall-clock elapsed: ${results.concurrency.elapsedMs.toFixed(3)} ms.
- Throughput: ${results.concurrency.throughputPerSecond.toFixed(2)} requests/s.
- Per-request latency: p50 ${formatMs(results.concurrency.latency.p50Ms)}, p95 ${formatMs(results.concurrency.latency.p95Ms)}, p99 ${formatMs(results.concurrency.latency.p99Ms)}; samples ${results.concurrency.latency.samples}.
- Successful resolutions: ${results.concurrency.successful}; degraded resolutions: ${results.concurrency.degraded}; thrown errors: ${results.concurrency.thrown}.
- Failure/error rate: ${formatRate(results.concurrency.failureRate)}. Final cache entries: ${results.concurrency.finalCacheEntries}.

## Memory with cache enabled

- Configuration: ${memory.configuration.entries} synthetic Deezer entries, ${memory.configuration.updateCycles} update cycles over the same keys, TTL ${memory.configuration.cacheTtlSeconds}s, forced GC ${memory.configuration.forcedGc ? 'enabled' : 'unavailable'}.
- Initial heap/rss: ${formatBytes(memory.initial.heapUsedBytes)} / ${formatBytes(memory.initial.rssBytes)}.
- Baseline after first fill heap/rss: ${formatBytes(memory.baselineAfterFirstFill.heapUsedBytes)} / ${formatBytes(memory.baselineAfterFirstFill.rssBytes)}.
- Final heap/rss: ${formatBytes(memory.final.heapUsedBytes)} / ${formatBytes(memory.final.rssBytes)}.
- Peak observed heap/rss: ${formatBytes(memory.peak.heapUsedBytes)} / ${formatBytes(memory.peak.rssBytes)}.
- Retained post-GC heap change after warm-up: ${formatBytes(memory.retainedGrowthBytes)}.
- Cache bound respected: ${memory.cacheBoundRespected ? 'yes' : 'no'} (${memory.final.cacheEntries} entries).
- Abnormal-growth signal: **${memory.abnormalGrowthSignal ? 'DETECTED' : 'not detected'}**. Rule: cache must stay within the configured entry count and post-GC heap growth after first fill must not exceed 10 MiB.

## Limits and regression interpretation

The benchmark establishes a reproducible synthetic baseline, not a production SLA. The measured provider difference includes the configured mock delays and resolver/cache overhead; it does not represent real provider latency. Any future run should use the same command and configuration, then compare p95/p99, cache warm-hit rate, concurrent failure rate, throughput, and post-GC retained growth against this report.

<details><summary>Machine-readable result</summary>

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`
</details>
`;
}

async function main() {
  const results = {
    configuration: CONFIG,
    youtube: await measureProviderResolution('youtube'),
    deezer: await measureProviderResolution('deezer'),
    cache: await measureCacheColdWarm(),
    concurrency: await measureConcurrentResolutions(),
    memory: await measureMemory(),
  };
  const report = renderReport(results);
  writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(report);
}

if (process.argv[1]?.endsWith('deezer-fallback-performance.bench.js')) {
  await main();
}
