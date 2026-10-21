const SAFE_CODE = /^[A-Z0-9_-]{1,64}$/;
const RECENT_REQUEST_TTL_MS = 60_000;
const MAX_RECENT_REQUESTS = 500;

/** In-memory aggregate playback counters. Request identities are retained only
 * in a bounded 60-second window to count exact repeats; snapshots are aggregate. */
export function createPlaybackMetrics({ now = Date.now } = {}) {
  const preparations = { requests: 0, successes: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0, statuses: {} };
  const proxy = {
    requests: 0,
    rangeRequests: 0,
    duplicateConcurrentRequests: 0,
    repeatedRequests: 0,
    bodyBytesWritten: 0,
    retryAttempts: 0,
    failedResponses: 0,
    abortedResponses: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    statuses: {},
  };
  const playbackErrorsByCode = {};
  const activeTracks = new Map();
  const recentRequests = new Map();

  const recordStatus = (target, statusCode) => {
    const status = Number.isInteger(Number(statusCode)) ? String(Number(statusCode)) : 'unknown';
    target.statuses[status] = (target.statuses[status] || 0) + 1;
  };

  return {
    startPrepare() {
      preparations.requests += 1;
      const startedAt = now();
      let finished = false;
      return {
        finish(statusCode) {
          if (finished) return;
          finished = true;
          const duration = Math.max(0, now() - startedAt);
          preparations.totalDurationMs += duration;
          preparations.maxDurationMs = Math.max(preparations.maxDurationMs, duration);
          const success = Number(statusCode) >= 200 && Number(statusCode) < 400;
          preparations[success ? 'successes' : 'failures'] += 1;
          recordStatus(preparations, statusCode);
        },
      };
    },

    startProxy({ identity = '', isRange = false } = {}) {
      proxy.requests += 1;
      if (isRange) proxy.rangeRequests += 1;
      const key = String(identity);
      const startedAt = now();
      for (const [recentKey, recentAt] of recentRequests) {
        if (startedAt - recentAt <= RECENT_REQUEST_TTL_MS) break;
        recentRequests.delete(recentKey);
      }
      if (key) {
        const previousAt = recentRequests.get(key);
        if (previousAt != null && startedAt - previousAt <= RECENT_REQUEST_TTL_MS) {
          proxy.repeatedRequests += 1;
          recentRequests.delete(key);
        }
        recentRequests.set(key, startedAt);
        while (recentRequests.size > MAX_RECENT_REQUESTS) {
          recentRequests.delete(recentRequests.keys().next().value);
        }
      }
      const active = activeTracks.get(key) || 0;
      if (key && active > 0) proxy.duplicateConcurrentRequests += 1;
      if (key) activeTracks.set(key, active + 1);

      let bytesSent = 0;
      let finished = false;
      return {
        addBytes(count) {
          const bytes = Number(count);
          if (Number.isFinite(bytes) && bytes > 0) bytesSent += Math.floor(bytes);
        },
        recordRetry() { proxy.retryAttempts += 1; },
        finish({ statusCode, aborted = false } = {}) {
          if (finished) return;
          finished = true;
          const duration = Math.max(0, now() - startedAt);
          proxy.bodyBytesWritten += bytesSent;
          proxy.totalDurationMs += duration;
          proxy.maxDurationMs = Math.max(proxy.maxDurationMs, duration);
          if (Number(statusCode) >= 400) proxy.failedResponses += 1;
          if (aborted) proxy.abortedResponses += 1;
          recordStatus(proxy, statusCode);
          if (key) {
            const remaining = (activeTracks.get(key) || 1) - 1;
            if (remaining > 0) activeTracks.set(key, remaining);
            else activeTracks.delete(key);
          }
        },
      };
    },

    recordPlaybackError(code) {
      const safeCode = typeof code === 'string' && SAFE_CODE.test(code) ? code : 'UNKNOWN';
      playbackErrorsByCode[safeCode] = (playbackErrorsByCode[safeCode] || 0) + 1;
    },

    snapshot() {
      const average = (metric) => metric.requests
        ? Math.round(metric.totalDurationMs / metric.requests)
        : 0;
      return {
        preparations: {
          ...preparations,
          averageDurationMs: average(preparations),
          statuses: { ...preparations.statuses },
        },
        proxy: {
          ...proxy,
          averageDurationMs: average(proxy),
          statuses: { ...proxy.statuses },
        },
        playbackErrorsByCode: { ...playbackErrorsByCode },
      };
    },
  };
}
