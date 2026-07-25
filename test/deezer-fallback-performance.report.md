# Task 12.3 — deterministic performance report

> NON-PRODUCTIVE TEST ARTIFACT. Generated from synthetic in-process mocks only. No Deezer, YouTube Music, external API, network, or credentials were used.

## Reproducibility

- Command: `node --expose-gc test/deezer-fallback-performance.bench.js`
- Node: `v24.6.0`
- Provider samples: 256 measured samples per provider, after 20 warm-up calls.
- Cache samples: 256 cold/warm pairs, after 20 warm-up pairs.
- Synthetic delays: YouTube Music 2 ms; Deezer fallback 3 ms.
- URLs, artists, titles, failures, concurrency, cache keys, and TTLs are synthetic and deterministic.

## Resolution and cache latency

| Scenario | Samples | p50 | p95 | p99 | Throughput (ops/s) | Errors | Error rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| YouTube Music mock success | 256 | 11.444 ms | 16.835 ms | 17.188 ms | 96.79 | 0 | 0.000% |
| Deezer mock fallback success | 256 | 16.558 ms | 16.988 ms | 17.954 ms | 67.64 | 0 | 0.000% |
| StreamCache cold miss + resolution | 256 | 16.489 ms | 16.904 ms | 17.335 ms | 68.21 | 0 | 0.000% |
| StreamCache warm hit | 256 | 0.067 ms | 0.128 ms | 0.159 ms | 13684.79 | 0 | 0.000% |

Cache warm hits: 256/256 (100.000%). The warm path was verified by `fromCache: true`; the cold path by `fromCache: false`.

## Concurrent resolutions

- Configuration: 32 concurrent requests per batch, 128 batches, 4096 total requests, one shared in-memory cache.
- Deterministic failure rules: YouTube fails when index%11===0; Deezer fails when index%53===0.
- Wall-clock elapsed: 3279.159 ms.
- Throughput: 1249.10 requests/s.
- Per-request latency: p50 16.093 ms, p95 22.695 ms, p99 33.132 ms; samples 4096.
- Successful resolutions: 4088; degraded resolutions: 8; thrown errors: 0.
- Failure/error rate: 0.195%. Final cache entries: 4088.

## Memory with cache enabled

- Configuration: 10000 synthetic Deezer entries, 20 update cycles over the same keys, TTL 3600s, forced GC enabled.
- Initial heap/rss: 4794136 B (4.572 MiB) / 57511936 B (54.848 MiB).
- Baseline after first fill heap/rss: 8143816 B (7.767 MiB) / 60170240 B (57.383 MiB).
- Final heap/rss: 8228872 B (7.848 MiB) / 74018816 B (70.590 MiB).
- Peak observed heap/rss: 13676600 B (13.043 MiB) / 74940416 B (71.469 MiB).
- Retained post-GC heap change after warm-up: 85056 B (0.081 MiB).
- Cache bound respected: yes (10000 entries).
- Abnormal-growth signal: **not detected**. Rule: cache must stay within the configured entry count and post-GC heap growth after first fill must not exceed 10 MiB.

## Limits and regression interpretation

The benchmark establishes a reproducible synthetic baseline, not a production SLA. The measured provider difference includes the configured mock delays and resolver/cache overhead; it does not represent real provider latency. Any future run should use the same command and configuration, then compare p95/p99, cache warm-hit rate, concurrent failure rate, throughput, and post-GC retained growth against this report.

<details><summary>Machine-readable result</summary>

```json
{
  "configuration": {
    "providerSamples": 256,
    "cacheSamples": 256,
    "concurrency": 32,
    "concurrencyBatches": 128,
    "memoryEntries": 10000,
    "memoryCycles": 20,
    "youtubeDelayMs": 2,
    "deezerDelayMs": 3
  },
  "youtube": {
    "samples": 256,
    "successfulSamples": 256,
    "errors": 0,
    "errorRate": 0,
    "p50Ms": 11.443899999999758,
    "p95Ms": 16.834699999999884,
    "p99Ms": 17.187599999999975,
    "minMs": 1.3780999999999608,
    "maxMs": 17.688300000000027,
    "throughputPerSecond": 96.78858865564393
  },
  "deezer": {
    "samples": 256,
    "successfulSamples": 256,
    "errors": 0,
    "errorRate": 0,
    "p50Ms": 16.558200000000397,
    "p95Ms": 16.988499999999476,
    "p99Ms": 17.954399999999623,
    "minMs": 2.423700000000281,
    "maxMs": 19.569500000000062,
    "throughputPerSecond": 67.63725243213395
  },
  "cache": {
    "coldMissResolution": {
      "samples": 256,
      "successfulSamples": 256,
      "errors": 0,
      "errorRate": 0,
      "p50Ms": 16.488500000000386,
      "p95Ms": 16.904099999999744,
      "p99Ms": 17.335299999999734,
      "minMs": 2.297099999999773,
      "maxMs": 17.996499999999287,
      "throughputPerSecond": 68.21046306404736
    },
    "warmHitResolution": {
      "samples": 256,
      "successfulSamples": 256,
      "errors": 0,
      "errorRate": 0,
      "p50Ms": 0.06660000000010768,
      "p95Ms": 0.12769999999909487,
      "p99Ms": 0.15929999999934807,
      "minMs": 0.040600000000267755,
      "maxMs": 0.2132000000001426,
      "throughputPerSecond": 13684.790104188056
    },
    "warmHitCount": 256,
    "cacheEffectiveness": 1
  },
  "concurrency": {
    "configuration": {
      "concurrency": 32,
      "batches": 128,
      "totalRequests": 4096,
      "sharedCache": true,
      "deterministicFailureRules": "YouTube fails when index%11===0; Deezer fails when index%53===0"
    },
    "latency": {
      "samples": 4096,
      "successfulSamples": 4096,
      "errors": 0,
      "errorRate": 0,
      "p50Ms": 16.09310000000005,
      "p95Ms": 22.695300000001225,
      "p99Ms": 33.132400000000416,
      "minMs": 1.3007999999990716,
      "maxMs": 33.60289999999986,
      "throughputPerSecond": 1249.1007983785107
    },
    "successful": 4088,
    "degraded": 8,
    "thrown": 0,
    "failureRate": 0.001953125,
    "elapsedMs": 3279.1589000000004,
    "throughputPerSecond": 1249.1007983785107,
    "finalCacheEntries": 4088
  },
  "memory": {
    "configuration": {
      "entries": 10000,
      "updateCycles": 20,
      "cacheTtlSeconds": 3600,
      "forcedGc": true,
      "growthSignalRule": "signal if cache exceeds configured entries or post-GC heap grows >10 MiB after first fill"
    },
    "initial": {
      "heapUsedBytes": 4794136,
      "heapTotalBytes": 15519744,
      "rssBytes": 57511936,
      "externalBytes": 1857881,
      "arrayBuffersBytes": 10483,
      "cacheEntries": 0
    },
    "baselineAfterFirstFill": {
      "heapUsedBytes": 8143816,
      "heapTotalBytes": 25681920,
      "rssBytes": 60170240,
      "externalBytes": 1857921,
      "arrayBuffersBytes": 10483,
      "cacheEntries": 10000
    },
    "final": {
      "heapUsedBytes": 8228872,
      "heapTotalBytes": 76734464,
      "rssBytes": 74018816,
      "externalBytes": 1857921,
      "arrayBuffersBytes": 10483,
      "cacheEntries": 10000
    },
    "peak": {
      "heapUsedBytes": 13676600,
      "heapTotalBytes": 26603520,
      "rssBytes": 74940416,
      "externalBytes": 1857921,
      "arrayBuffersBytes": 10483,
      "cacheEntries": 10000
    },
    "retainedGrowthBytes": 85056,
    "cacheBoundRespected": true,
    "abnormalGrowthSignal": false
  }
}
```
</details>
