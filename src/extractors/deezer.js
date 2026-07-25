/**
 * Deezer audio provider implementation.
 *
 * El proveedor mantiene aisladas las dependencias de red, autenticación y
 * parsing para que pueda probarse con dobles inyectados sin credenciales reales.
 */
import { DeezerHttpClient } from './deezerHttp.js';
import { DeezerParser } from './deezerParser.js';
import { DeezerTokenManager } from './deezerToken.js';
import {
  DEEZER_ERROR_CATEGORIES,
  classifyDeezerError,
  getDeezerErrorLogLevel,
  isRetryable,
  safeErrorContext,
  shouldRefreshAuth,
} from './deezerError.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LIMIT = 20;
const DEFAULT_QUALITY = 'MP3_320';
const DEFAULT_RECOVERY_COOLDOWN_MS = 30_000;
const QUALITY_ORDER = Object.freeze(['FLAC', 'MP3_320', 'MP3_128']);

export const DEEZER_MODES = Object.freeze({
  FULL: 'full',
  DEGRADED: 'degraded',
  DISABLED: 'disabled',
});

// Alias kept explicit for callers that name this concern "degradation modes".
export const DEGRADATION_MODES = DEEZER_MODES;
const { AUTH, RATE_LIMIT, NETWORK, API_CHANGE, NOT_FOUND } = DEEZER_ERROR_CATEGORIES;

/**
 * Implementación del proveedor Deezer.
 *
 * @param {object} [config]
 * @param {DeezerHttpClient} [config.httpClient] Cliente HTTP inyectable.
 * @param {DeezerTokenManager} [config.tokenManager] Gestor de tokens inyectable.
 * @param {DeezerParser} [config.parser] Parser inyectable.
 * @param {number} [config.timeoutMs=5000] Timeout total por operación.
 * @param {string} [config.quality=MP3_320] Calidad por defecto.
 * @param {object} [config.logger=console] Logger opcional.
 */
export class DeezerProvider {
  constructor(config = {}) {
    const options = isObject(config) ? config : {};
    this.config = options;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.defaultQuality = normalizeQuality(options.quality) || DEFAULT_QUALITY;
    this.logger = options.logger || console;
    this.recoveryCooldownMs = normalizeNonNegativeTimeout(
      options.recoveryCooldownMs ?? options.modeRecoveryMs,
      DEFAULT_RECOVERY_COOLDOWN_MS,
    );
    this.hasAuthConfiguration = hasConfiguredCredentials(options, options.tokenManager);
    this._explicitlyDisabled = options.enabled === false || options.disabled === true;
    this.mode = initialMode(options, this.hasAuthConfiguration);
    this.degradationMode = this.mode;
    this._authBlocked = this.mode === DEEZER_MODES.DEGRADED && this.hasAuthConfiguration;
    this._lastFailureAt = 0;
    this._disabledAt = this.mode === DEEZER_MODES.DISABLED ? Date.now() : 0;

    // Los dobles se aceptan por instancia; las clases predeterminadas reciben
    // solo configuración, nunca credenciales embebidas en este módulo.
    this.httpClient = options.httpClient
      || options.deezerHttpClient
      || new DeezerHttpClient({ ...options, timeoutMs: this.timeoutMs });
    this.tokenManager = options.tokenManager
      || options.deezerTokenManager
      || new DeezerTokenManager({ ...options, timeoutMs: this.timeoutMs });
    if (!this.hasAuthConfiguration) {
      this.hasAuthConfiguration = hasConfiguredCredentials(options, this.tokenManager);
    }
    this.parser = options.parser || options.deezerParser || new DeezerParser();
  }

  /** Busca pistas y siempre devuelve una colección segura para el catálogo. */
  async searchTracks(query, limit = DEFAULT_LIMIT) {
    const value = normalizeQuery(query);
    const count = normalizeLimit(limit);
    if (!value || count === 0) return [];

    try {
      const response = await this._runWithTimeout(() => this._withAuthRetry(
        (token) => this.httpClient.search(value, buildSearchOptions(count, token)),
      ));
      if (response === null || response === undefined) return [];
      const tracks = this.parser.parseSearchResponse(response);
      return Array.isArray(tracks) ? tracks.slice(0, count) : [];
    } catch (error) {
      this._observeFailure(error);
      this._log('warn', 'search failed', error);
      return [];
    }
  }

  /**
   * Resuelve la URL de stream intentando la calidad solicitada y alternativas.
   * El valor de retorno es una URL o null, igual que los extractores existentes.
   */
  async getStreamUrl(trackMetadata, quality = this.defaultQuality) {
    const id = extractTrackId(trackMetadata);
    if (id === null) return null;

    const requested = normalizeQuality(quality) || this.defaultQuality;
    const qualities = qualityFallbackOrder(requested);
    try {
      return await this._runWithTimeout(async () => {
        for (const candidate of qualities) {
          const response = await this._withAuthRetry(
            (token) => this.httpClient.getStreamUrl(id, candidate, token),
          );
          const url = selectStreamUrl(response, candidate, this.parser, requested);
          if (url) return url;
        }
        return null;
      });
    } catch (error) {
      this._observeFailure(error);
      this._log('warn', 'stream resolution failed', error);
      return null;
    }
  }

  /** Obtiene y normaliza los metadatos completos de una pista. */
  async getTrackById(deezerId) {
    const id = normalizeId(deezerId);
    if (id === null) return null;

    try {
      const response = await this._runWithTimeout(() => this._withAuthRetry(
        () => this.httpClient.getTrack(id),
      ));
      if (response === null || response === undefined) return null;
      return this.parser.parseTrackResponse(response) || null;
    } catch (error) {
      this._observeFailure(error);
      this._log('warn', 'track lookup failed', error);
      return null;
    }
  }

  /** Obtiene metadatos de álbum; la respuesta conserva el formato de Deezer. */
  async getAlbum(deezerId) {
    return this._getRawResource('album', deezerId, 'getAlbum');
  }

  /** Obtiene metadatos de artista; la respuesta conserva el formato de Deezer. */
  async getArtist(deezerId) {
    return this._getRawResource('artist', deezerId, 'getArtist');
  }

  async _getRawResource(operation, deezerId, method) {
    const id = normalizeId(deezerId);
    if (id === null) return null;
    try {
      const response = await this._runWithTimeout(() => this._withAuthRetry(
        () => this.httpClient[method](id),
      ));
      return response === undefined ? null : response;
    } catch (error) {
      this._observeFailure(error);
      this._log('warn', `${operation} lookup failed`, error);
      return null;
    }
  }

  /** Returns the current safe mode without exposing credentials or errors. */
  getMode() {
    this._maybeRecover();
    return this.mode;
  }

  getStatus() {
    return {
      mode: this.getMode(),
      available: this.mode !== DEEZER_MODES.DISABLED,
      authConfigured: this.hasAuthConfiguration,
    };
  }

  isAvailable() {
    return this.getMode() !== DEEZER_MODES.DISABLED;
  }

  /**
   * Executes a provider operation while applying the mode state machine.
   * Auth failures get one refresh attempt, then the operation is retried
   * without a token in degraded mode so public endpoints remain usable.
   */
  async _withAuthRetry(operation) {
    if (!this._ensureAvailable()) return null;

    const publicOnly = this.mode === DEEZER_MODES.DEGRADED && this._authBlocked;
    const firstToken = publicOnly ? null : await this._getToken();
    const first = await this._execute(operation, firstToken);
    if (first.ok) {
      this._recordSuccess(first.value, firstToken);
      return first.value;
    }

    const firstCategory = classifyDeezerError(first.error);
    if (shouldRefreshAuth(firstCategory)) {
      await this._invalidateToken();
      const refreshedToken = await this._refreshToken();
      if (refreshedToken) {
        const refreshed = await this._execute(operation, refreshedToken);
        if (refreshed.ok) {
          this._authBlocked = false;
          this._setMode(DEEZER_MODES.FULL);
          this._recordSuccess(refreshed.value, refreshedToken);
          return refreshed.value;
        }
        const refreshedCategory = classifyDeezerError(refreshed.error);
        if (!shouldRefreshAuth(refreshedCategory)) {
          this._observeFailure(refreshed.error);
          return null;
        }
      }

      // Credentials are unavailable or still rejected: keep the provider in
      // degraded mode and make one public-endpoint attempt without auth.
      this._authBlocked = true;
      this._lastFailureAt = Date.now();
      this._setMode(DEEZER_MODES.DEGRADED);
      const publicAttempt = await this._execute(operation, null);
      if (publicAttempt.ok) {
        this._recordSuccess(publicAttempt.value, null);
        return publicAttempt.value;
      }
      this._observeFailure(publicAttempt.error);
      return null;
    }

    this._observeFailure(first.error);
    return null;
  }

  async _execute(operation, token) {
    try {
      const value = await operation(token);
      // Deezer can return an HTTP 2xx JSON error envelope. Treat it as a
      // failure before parsing so API/auth failures still update the mode.
      const category = value === null || value === undefined
        ? null
        : classifyDeezerError(value);
      if (category && category !== DEEZER_ERROR_CATEGORIES.UNKNOWN) {
        return { ok: false, error: value };
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  _ensureAvailable() {
    this._maybeRecover();
    return this.mode !== DEEZER_MODES.DISABLED;
  }

  _maybeRecover() {
    if (this._explicitlyDisabled) return;
    if (this.mode === DEEZER_MODES.DEGRADED
      && this._authBlocked
      && this.hasAuthConfiguration
      && this._lastFailureAt
      && Date.now() - this._lastFailureAt >= this.recoveryCooldownMs) {
      this._authBlocked = false;
      this._setMode(DEEZER_MODES.FULL);
      return;
    }
    if (this.mode !== DEEZER_MODES.DISABLED || !this._disabledAt) return;
    if (Date.now() - this._disabledAt < this.recoveryCooldownMs) return;
    // A later request is a bounded recovery probe. API changes may have been
    // fixed server-side; do not permanently remove the fallback.
    this._authBlocked = false;
    this._setMode(this.hasAuthConfiguration ? DEEZER_MODES.FULL : DEEZER_MODES.DEGRADED);
    this._disabledAt = 0;
  }

  _recordSuccess(value, token) {
    // A null response is an unavailable result, not evidence that the API is
    // healthy, so it must not re-enable a disabled provider.
    if (value === null || value === undefined) return;
    this._lastFailureAt = 0;
    if (!this._authBlocked && this.mode !== DEEZER_MODES.DISABLED) {
      this._setMode(this.hasAuthConfiguration && token ? DEEZER_MODES.FULL : this.mode);
    }
  }

  _observeFailure(error) {
    const category = classifyDeezerError(error);
    if (category === NOT_FOUND) {
      this._log('info', 'resource not found', error, category);
      return category;
    }

    this._lastFailureAt = Date.now();
    if (category === AUTH) {
      this._authBlocked = true;
      this._setMode(DEEZER_MODES.DEGRADED);
    } else if (category === API_CHANGE) {
      // A schema/endpoint failure is unsafe for the fallback until a later
      // recovery probe confirms that the upstream contract is usable again.
      this._setMode(DEEZER_MODES.DISABLED);
    } else if (category === RATE_LIMIT || category === NETWORK || isRetryable(category)) {
      this._setMode(DEEZER_MODES.DEGRADED);
    }
    this._log(getDeezerErrorLogLevel(category).toLowerCase(), 'provider failure', error, category);
    return category;
  }

  _setMode(mode) {
    if (!Object.values(DEEZER_MODES).includes(mode)) return;
    this.mode = mode;
    this.degradationMode = mode;
    if (mode === DEEZER_MODES.DISABLED) {
      this._disabledAt = this._disabledAt || Date.now();
    } else {
      this._disabledAt = 0;
    }
  }

  async _getToken() {
    if (!this.tokenManager || typeof this.tokenManager.getToken !== 'function') return null;
    try { return await this.tokenManager.getToken(); } catch { return null; }
  }

  async _invalidateToken() {
    if (!this.tokenManager || typeof this.tokenManager.invalidateToken !== 'function') return;
    try { await this.tokenManager.invalidateToken(); } catch {}
  }

  async _refreshToken() {
    if (!this.tokenManager || typeof this.tokenManager.refreshToken !== 'function') return null;
    try { return await this.tokenManager.refreshToken(); } catch { return null; }
  }

  async _runWithTimeout(task) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        this._observeFailure(new Error('Deezer operation timeout'));
        resolve(null);
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(task), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  _log(level, message, error, category = null) {
    const logger = this.logger;
    const fn = logger && typeof logger[level] === 'function' ? logger[level].bind(logger) : null;
    if (!fn) return;
    try {
      const context = error === undefined
        ? undefined
        : safeErrorContext(error);
      if (category && context && !context.category) context.category = category;
      fn(`[DeezerProvider] ${message}`, context);
    } catch {}
  }
}

/** Factory útil para wiring posterior y pruebas con dependencias inyectadas. */
export function createDeezerProvider(config = {}) {
  return new DeezerProvider(config);
}

export default DeezerProvider;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimeout(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : DEFAULT_TIMEOUT_MS;
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_LIMIT;
  return Math.max(0, Math.floor(number));
}

function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id && id !== '[object Object]' ? id : null;
}

function extractTrackId(trackMetadata) {
  if (!isObject(trackMetadata)) return null;
  return normalizeId(trackMetadata.deezerId ?? trackMetadata.id ?? trackMetadata.trackId);
}

function normalizeQuality(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = isObject(value)
    ? value.format ?? value.quality ?? value.code
    : value;
  const key = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (key === '128' || key === 'MP3128' || key === 'MP3' || key === 'MP3_LOW') return 'MP3_128';
  if (key === '320' || key === 'MP3320' || key === 'MP3_HIGH' || key === 'MP3_HQ') return 'MP3_320';
  if (key === 'FLAC_1411' || key === 'LOSSLESS') return 'FLAC';
  return QUALITY_ORDER.includes(key) ? key : null;
}

function qualityFallbackOrder(requested) {
  const index = QUALITY_ORDER.indexOf(requested);
  if (index < 0) return [DEFAULT_QUALITY, 'MP3_320', 'MP3_128'];

  // Try requested quality first, then try better qualities (closest better first),
  // finally try worse qualities (closest worse first)
  const betterQualities = QUALITY_ORDER.slice(0, index).reverse(); // Mejores calidades del más cercano al más lejano
  const worseQualities = QUALITY_ORDER.slice(index + 1); // Peores calidades del más cercano al más lejano

  // Order: requested → closest better qualities → closest worse qualities
  // Esto asegura monotonicidad: cuando se solicita una calidad más alta,
  // se obtiene una calidad igual o mejor
  return [requested, ...betterQualities, ...worseQualities];
}

function buildSearchOptions(limit, token) {
  const options = { limit };
  // The token is optional and is only passed to the injected client; the
  // default HTTP client serializes safe options without logging its value.
  if (typeof token === 'string' && token) options.access_token = token;
  return options;
}

function selectStreamUrl(response, requestedQuality, parser, originalQuality) {
  // Handle different response structures
  if (!response) return null;

  // Case 1: Response has a direct stream URL
  if (response.stream && typeof response.stream === 'string') {
    return response.stream;
  }

  // Case 2: Response has nested stream data
  const entries = collectStreamEntries(response);
  if (entries.length > 0) {
    const order = qualityFallbackOrder(originalQuality || requestedQuality);
    for (const quality of order) {
      const match = entries.find((entry) => !entry.quality || entry.quality === quality);
      if (match?.url) return match.url;
    }
    // If an unfamiliar Deezer format was returned, preserve a usable URL rather
    // than crashing; the endpoint already applied the requested quality filter.
    return entries[0]?.url || null;
  }

  // Case 3: Response is from gateway API with different structure
  if (response.results && typeof response.results === 'object') {
    // Try to extract stream URL from gateway response
    const candidates = [
      response.results.DATA?.MEDIA?.FORMATS,
      response.results.streamUrl,
      response.results.stream_url,
      response.results.url,
      response.results.link,
      response.results.preview,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        // Find the requested quality
        for (const format of candidate) {
          const formatQuality = parser.normalizeQualityFormat(format.format || format.quality);
          if (formatQuality === requestedQuality && (format.url || format.media || format.link)) {
            return format.url || format.media || format.link;
          }
        }
        // Return first available
        const first = candidate[0];
        if (first && (first.url || first.media || first.link)) {
          return first.url || first.media || first.link;
        }
      } else if (typeof candidate === 'string' && candidate.startsWith('http')) {
        return candidate;
      }
    }
  }

  return null;
}

function collectStreamEntries(value, entries = [], seen = new Set()) {
  if (value === null || value === undefined) return entries;
  if (typeof value === 'string') {
    if (isUrl(value)) entries.push({ url: value, quality: null });
    return entries;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStreamEntries(item, entries, seen);
    return entries;
  }
  if (!isObject(value) || seen.has(value)) return entries;
  seen.add(value);

  const url = value.url ?? value.streamUrl ?? value.stream_url ?? value.link ?? value.source;
  if (typeof url === 'string' && isUrl(url)) {
    entries.push({
      url,
      quality: normalizeQuality(value.format ?? value.quality ?? value.code ?? value.type),
    });
  }

  // Deezer responses vary between data/results/streams/formats containers.
  for (const key of ['data', 'results', 'streams', 'formats', 'qualities', 'stream']) {
    if (value[key] !== undefined) collectStreamEntries(value[key], entries, seen);
  }
  return entries;
}

function isUrl(value) {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeNonNegativeTimeout(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function initialMode(options, hasCredentials) {
  if (options.enabled === false || options.disabled === true) return DEEZER_MODES.DISABLED;
  const requested = options.mode ?? options.degradationMode;
  if (Object.values(DEEZER_MODES).includes(requested)) return requested;
  return hasCredentials ? DEEZER_MODES.FULL : DEEZER_MODES.DEGRADED;
}

/**
 * Detects whether credentials are configured without copying, returning, or
 * logging their values. The token manager may expose only its in-memory
 * credential list; this helper reduces it to a boolean immediately.
 */
function hasConfiguredCredentials(options, tokenManager) {
  const values = [
    options?.arlToken,
    options?.arlTokens,
    options?.credentials,
    tokenManager?.credentials,
  ];
  return values.some((value) => containsCredential(value));
}

function containsCredential(value) {
  if (Array.isArray(value)) return value.some((item) => containsCredential(item));
  if (value && typeof value === 'object') {
    return containsCredential(value.arlToken ?? value.arl ?? value.token);
  }
  return typeof value === 'string' && value.trim().length > 0;
}
