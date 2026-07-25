/**
 * In-process metrics for the Deezer fallback provider.
 *
 * This module deliberately has no network or persistence dependency. The singleton
 * export is convenient for application code, while `DeezerMetrics` lets tests
 * and isolated consumers create their own registry.
 */

export const DEEZER_METRIC_NAMES = Object.freeze({
  RESOLUTION_SUCCESS: 'deezer_resolution_success_total',
  RESOLUTION_DURATION: 'deezer_resolution_duration_seconds',
  CACHE_HIT_RATIO: 'deezer_cache_hit_ratio',
  AUTH_TOKEN_EXPIRY: 'deezer_auth_token_expiry_seconds',
  API_ERROR_BY_TYPE: 'deezer_api_error_by_type',
});

const COUNTER_METRICS = new Set([
  DEEZER_METRIC_NAMES.RESOLUTION_SUCCESS,
  DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE,
]);
const HISTOGRAM_METRICS = new Set([DEEZER_METRIC_NAMES.RESOLUTION_DURATION]);
const GAUGE_METRICS = new Set([
  DEEZER_METRIC_NAMES.CACHE_HIT_RATIO,
  DEEZER_METRIC_NAMES.AUTH_TOKEN_EXPIRY,
]);
const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Small synchronous metric registry suitable for request-path instrumentation.
 * Values are kept only for the lifetime of this process.
 */
export class DeezerMetrics {
  constructor() {
    this.reset();
  }

  /** Increment a counter. `labels.type` is used for API errors. */
  increment(name, amount = 1, labels = undefined) {
    assertMetricType(name, COUNTER_METRICS, 'counter');
    const value = finiteNonNegative(amount, 'counter increment');
    if (value === 0) return this.get(name);

    if (name === DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE) {
      const type = normalizeErrorType(labels?.type ?? labels);
      const byType = this._counters[name].byType;
      byType[type] = (byType[type] || 0) + value;
    } else {
      this._counters[name].value += value;
    }
    return this.get(name);
  }

  /** Observe one histogram sample in seconds. */
  observe(name, value) {
    assertMetricType(name, HISTOGRAM_METRICS, 'histogram');
    const sample = finiteNonNegative(value, 'histogram observation');
    const histogram = this._histograms[name];
    histogram.count++;
    histogram.sum += sample;
    histogram.min = Math.min(histogram.min, sample);
    histogram.max = Math.max(histogram.max, sample);
    for (const bucket of HISTOGRAM_BUCKETS) {
      if (sample <= bucket) histogram.buckets[bucket]++;
    }
    return this.get(name);
  }

  /** Set a gauge value. No value is emitted or persisted elsewhere. */
  set(name, value) {
    assertMetricType(name, GAUGE_METRICS, 'gauge');
    const gaugeValue = finiteNumber(value, 'gauge value');
    this._gauges[name] = gaugeValue;
    return gaugeValue;
  }

  /** Alias matching common metrics-client terminology. */
  inc(name, amount = 1, labels = undefined) {
    return this.increment(name, amount, labels);
  }

  /** Alias matching common metrics-client terminology. */
  setGauge(name, value) {
    return this.set(name, value);
  }

  /** Return a defensive snapshot for one metric. */
  get(name, labels = undefined) {
    if (COUNTER_METRICS.has(name)) {
      const counter = this._counters[name];
      if (name === DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE) {
        const type = labels === undefined ? undefined : normalizeErrorType(labels?.type ?? labels);
        return type === undefined ? { ...counter.byType } : (counter.byType[type] || 0);
      }
      return counter.value;
    }
    if (HISTOGRAM_METRICS.has(name)) {
      const histogram = this._histograms[name];
      return {
        count: histogram.count,
        sum: histogram.sum,
        min: histogram.count ? histogram.min : null,
        max: histogram.count ? histogram.max : null,
        average: histogram.count ? histogram.sum / histogram.count : 0,
        buckets: { ...histogram.buckets },
      };
    }
    if (GAUGE_METRICS.has(name)) return this._gauges[name];
    throw new Error(`Unknown Deezer metric: ${String(name)}`);
  }

  /** Return defensive snapshots of all five public metrics. */
  getAll() {
    return {
      [DEEZER_METRIC_NAMES.RESOLUTION_SUCCESS]: this.get(DEEZER_METRIC_NAMES.RESOLUTION_SUCCESS),
      [DEEZER_METRIC_NAMES.RESOLUTION_DURATION]: this.get(DEEZER_METRIC_NAMES.RESOLUTION_DURATION),
      [DEEZER_METRIC_NAMES.CACHE_HIT_RATIO]: this.get(DEEZER_METRIC_NAMES.CACHE_HIT_RATIO),
      [DEEZER_METRIC_NAMES.AUTH_TOKEN_EXPIRY]: this.get(DEEZER_METRIC_NAMES.AUTH_TOKEN_EXPIRY),
      [DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE]: this.get(DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE),
    };
  }

  /** Alias for integrations that call the registry snapshot `getMetrics`. */
  getMetrics() {
    return this.getAll();
  }

  /** Reset every metric to its initial in-process value. */
  reset() {
    this._counters = {
      [DEEZER_METRIC_NAMES.RESOLUTION_SUCCESS]: { value: 0 },
      [DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE]: { byType: Object.create(null) },
    };
    this._histograms = {
      [DEEZER_METRIC_NAMES.RESOLUTION_DURATION]: createHistogram(),
    };
    this._gauges = {
      [DEEZER_METRIC_NAMES.CACHE_HIT_RATIO]: 0,
      [DEEZER_METRIC_NAMES.AUTH_TOKEN_EXPIRY]: 0,
    };
  }

  /** Record a successful resolution. */
  recordResolutionSuccess(amount = 1) {
    return this.increment(DEEZER_METRIC_NAMES.RESOLUTION_SUCCESS, amount);
  }

  /** Record resolution duration in seconds. */
  observeResolutionDuration(seconds) {
    return this.observe(DEEZER_METRIC_NAMES.RESOLUTION_DURATION, seconds);
  }

  /** Set the current cache hit ratio, conventionally in the [0, 1] range. */
  setCacheHitRatio(ratio) {
    return this.set(DEEZER_METRIC_NAMES.CACHE_HIT_RATIO, ratio);
  }

  /** Set remaining authentication-token lifetime in seconds. */
  setAuthTokenExpiry(seconds) {
    return this.set(DEEZER_METRIC_NAMES.AUTH_TOKEN_EXPIRY, seconds);
  }

  /** Record an API error category without retaining an error object or secret. */
  recordApiError(type, amount = 1) {
    return this.increment(DEEZER_METRIC_NAMES.API_ERROR_BY_TYPE, amount, { type });
  }
}

export const deezerMetrics = new DeezerMetrics();

// Functional API for callers that do not need to manage a registry instance.
export const increment = (name, amount = 1, labels = undefined) =>
  deezerMetrics.increment(name, amount, labels);
export const observe = (name, value) => deezerMetrics.observe(name, value);
export const set = (name, value) => deezerMetrics.set(name, value);
export const get = (name, labels = undefined) => deezerMetrics.get(name, labels);
export const getAll = () => deezerMetrics.getAll();
export const getMetrics = () => deezerMetrics.getAll();
export const reset = () => deezerMetrics.reset();
export const recordResolutionSuccess = (amount = 1) => deezerMetrics.recordResolutionSuccess(amount);
export const observeResolutionDuration = (seconds) => deezerMetrics.observeResolutionDuration(seconds);
export const setCacheHitRatio = (ratio) => deezerMetrics.setCacheHitRatio(ratio);
export const setAuthTokenExpiry = (seconds) => deezerMetrics.setAuthTokenExpiry(seconds);
export const recordApiError = (type, amount = 1) => deezerMetrics.recordApiError(type, amount);

export const inc = increment;
export const setGauge = set;
export const getMetric = get;
export const resetMetrics = reset;

export default deezerMetrics;

function createHistogram() {
  return {
    count: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    buckets: Object.fromEntries(HISTOGRAM_BUCKETS.map((bucket) => [bucket, 0])),
  };
}

function assertMetricType(name, allowed, expected) {
  if (!allowed.has(name)) {
    throw new Error(`Metric ${String(name)} is not a ${expected} Deezer metric`);
  }
}

function finiteNumber(value, description) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${description} must be finite`);
  return number;
}

function finiteNonNegative(value, description) {
  const number = finiteNumber(value, description);
  if (number < 0) throw new RangeError(`${description} must be non-negative`);
  return number;
}

function normalizeErrorType(type) {
  const normalized = String(type ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 64);
  return normalized || 'unknown';
}
