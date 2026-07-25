/**
 * Deezer session token lifecycle manager.
 *
 * ARL credentials are accepted at runtime (normally from environment
 * configuration) and are kept in memory only. This integration is intended
 * for educational/testing use; never put credentials in source control or
 * include them in logs.
 */
import { createHash } from 'node:crypto';

const DEFAULT_REFRESH_THRESHOLD_SECONDS = 300;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_AUTH_URL = 'https://www.deezer.com/ajax/gw-light.php';
const AUTH_USER_AGENT = 'VelocityMusic/1.0 (Educational Use)';

// Shared only inside this Node process. The credential fingerprint is used as
// the key so the ARL itself is not retained as a Map key or exposed by tools.
const sharedStates = new Map();

/**
 * Manages the Deezer session token lifecycle.
 *
 * @example
 * const manager = new DeezerTokenManager({
 *   arlToken: process.env.DEEZER_ARL_TOKEN,
 *   refreshThresholdSeconds: 300,
 * });
 */
export class DeezerTokenManager {
  /**
   * @param {object} options
   * @param {string|string[]|object[]} options.arlToken One ARL or credentials
   *   to rotate. Objects may use `arlToken`, `arl`, or `token`.
   * @param {number} [options.refreshThresholdSeconds=300]
   * @param {string|string[]} [options.arlTokens] Additional ARLs to rotate.
   * @param {string} [options.authUrl] Override for the Deezer gateway URL.
   * @param {number} [options.timeoutMs=5000] Authentication request timeout.
   * @param {Function} [options.fetchImpl] Fetch implementation for callers/tests.
   */
  constructor({
    arlToken,
    refreshThresholdSeconds = DEFAULT_REFRESH_THRESHOLD_SECONDS,
    arlTokens,
    authUrl = DEFAULT_AUTH_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
    ...options
  } = {}) {
    this.credentials = normalizeCredentials(arlToken, arlTokens, options.credentials);
    this.refreshThresholdSeconds = toNonNegativeNumber(
      refreshThresholdSeconds,
      DEFAULT_REFRESH_THRESHOLD_SECONDS,
    );
    this.authUrl = typeof authUrl === 'string' && authUrl.trim() ? authUrl : DEFAULT_AUTH_URL;
    this.timeoutMs = toPositiveNumber(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;

    const fingerprint = fingerprintCredentials(this.credentials);
    let state = sharedStates.get(fingerprint);
    if (!state) {
      state = createState();
      sharedStates.set(fingerprint, state);
    }
    this._state = state;
  }

  /**
   * Returns a non-expired token, refreshing it proactively near expiry.
   * Resolves `null` when no configured credential can authenticate.
   * @returns {Promise<string|null>}
   */
  async getToken() {
    if (this._state.token && !this.shouldRefreshToken(this._state)) {
      return this._state.token;
    }
    return this.refreshToken();
  }

  /**
   * Obtains a session token and rotates through credentials after failures.
   * Concurrent refreshes share one in-flight promise to avoid duplicate auth.
   * @returns {Promise<string|null>}
   */
  async refreshToken() {
    if (this._state.refreshPromise) return this._state.refreshPromise;

    this._state.refreshPromise = this._refreshFromCredentials()
      .catch(() => null)
      .finally(() => {
        this._state.refreshPromise = null;
      });

    return this._state.refreshPromise;
  }

  /**
   * Checks local token state and expiry. The token is not included in errors
   * or logs; remote auth failures are handled by the next API request.
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async validateToken(token) {
    if (typeof token !== 'string' || !token) return false;
    if (token !== this._state.token || this._state.invalidated) return false;
    return !this.isExpired(this._state);
  }

  /** Marks the current token invalid so the next getToken() must refresh. */
  async invalidateToken() {
    this._state.invalidated = true;
    this._state.token = null;
    this._state.issuedAt = 0;
    this._state.expiresAt = 0;
    return true;
  }

  /**
   * Public timing helper used by callers/tests and by getToken().
   * Accepts a token record (`expiresAt`, `issuedAt`/`expiresIn`) or a token
   * string already held by this manager.
   */
  shouldRefreshToken(tokenRecord, now = Date.now()) {
    const record = typeof tokenRecord === 'string'
      ? tokenRecord === this._state.token ? this._state : null
      : tokenRecord;
    if (!record || !record.token || record.invalidated) return true;

    const expiresAt = resolveExpiresAt(record);
    if (!expiresAt) return false;
    return now >= expiresAt - this.refreshThresholdSeconds * 1000;
  }

  /** Returns whether a token record has passed its expiry time. */
  isExpired(tokenRecord, now = Date.now()) {
    const expiresAt = resolveExpiresAt(tokenRecord);
    return Boolean(expiresAt && now >= expiresAt);
  }

  async _refreshFromCredentials() {
    if (this.credentials.length === 0) return null;

    const start = normalizeIndex(this._state.credentialIndex, this.credentials.length);
    for (let offset = 0; offset < this.credentials.length; offset++) {
      const index = (start + offset) % this.credentials.length;
      const credential = this.credentials[index];
      try {
        const response = await this._requestSessionToken(credential);
        const tokenData = parseTokenResponse(response);
        if (!tokenData || !tokenData.token) continue;

        const now = Date.now();
        this._state.token = tokenData.token;
        this._state.issuedAt = now;
        this._state.expiresAt = tokenData.expiresAt ?? now + tokenData.expiresIn * 1000;
        this._state.invalidated = false;
        this._state.credentialIndex = index;
        return tokenData.token;
      } catch {
        // Do not expose credential or response data. Try the next ARL.
      }
    }

    this._state.credentialIndex = (start + 1) % this.credentials.length;
    this._state.token = null;
    this._state.invalidated = true;
    return null;
  }

  async _requestSessionToken(arlToken) {
    const fetchFn = this.fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetchFn(this.authUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: `arl=${encodeURIComponent(arlToken)}`,
          'User-Agent': AUTH_USER_AGENT,
        },
        body: JSON.stringify({ method: 'user.get', input: 3, api_version: '1.0', api_token: '' }),
        signal: controller.signal,
      });
      if (!response || response.ok === false) return null;
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function createState() {
  return {
    token: null,
    issuedAt: 0,
    expiresAt: 0,
    invalidated: true,
    credentialIndex: 0,
    refreshPromise: null,
  };
}

function normalizeCredentials(primary, additional, configured) {
  const values = [
    ...asArray(primary),
    ...asArray(additional),
    ...asArray(configured),
  ];
  const credentials = [];
  const seen = new Set();
  for (const value of values) {
    const credential = typeof value === 'string'
      ? value.trim()
      : value && typeof value === 'object'
        ? String(value.arlToken ?? value.arl ?? value.token ?? '').trim()
        : '';
    if (credential && !seen.has(credential)) {
      seen.add(credential);
      credentials.push(credential);
    }
  }
  return credentials;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function fingerprintCredentials(credentials) {
  return createHash('sha256').update(credentials.join('\u0000')).digest('hex');
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeIndex(value, length) {
  const index = Number.isInteger(value) ? value : 0;
  return ((index % length) + length) % length;
}

function resolveExpiresAt(record) {
  if (Number.isFinite(record?.expiresAt) && record.expiresAt > 0) {
    return record.expiresAt;
  }
  if (Number.isFinite(record?.issuedAt) && Number.isFinite(record?.expiresIn)) {
    return record.issuedAt + Math.max(0, Number(record.expiresIn)) * 1000;
  }
  return 0;
}

function parseTokenResponse(payload) {
  if (!payload) return null;
  const result = payload.results && typeof payload.results === 'object'
    ? payload.results
    : payload;
  const token = firstString(
    result.token,
    result.sessionToken,
    result.session_token,
    result.access_token,
    result.accessToken,
    result.USER_TOKEN,
    payload.token,
    payload.sessionToken,
    payload.access_token,
  );
  if (!token) return null;

  const expiresIn = toPositiveNumber(
    result.expiresIn ?? result.expires_in ?? result.ttl ?? payload.expiresIn ?? payload.expires_in,
    DEFAULT_TOKEN_LIFETIME_SECONDS,
  );
  const rawExpiresAt = result.expiresAt ?? result.expires_at ?? payload.expiresAt ?? payload.expires_at;
  const expiresAt = toAbsoluteTimestamp(rawExpiresAt);
  return { token, expiresIn, expiresAt };
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0) ?? null;
}

function toAbsoluteTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  // Unix timestamps are normally seconds; JavaScript timestamps are millis.
  return number < 1e12 ? number * 1000 : number;
}
