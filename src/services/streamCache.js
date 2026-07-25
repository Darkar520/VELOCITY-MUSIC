import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizeText } from '../lib/normalize.js';

export const DEFAULT_CACHE_TTL_SECONDS = 60 * 60 * 5; // 18000 (5h)
export const DEEZER_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
// Alias explícito para callers que expresan el TTL en horas.
export const DEEZER_TTL_SECONDS = DEEZER_CACHE_TTL_SECONDS;
export const MIN_TTL_SECONDS = 1;
export const MAX_TTL_SECONDS = 604800 * 2; // 14 días
export const MAX_ENTRIES = 25000;

/**
 * Caché de streams clave→valor con TTL, expulsión LRU y persistencia opcional.
 *
 * `get(key)` conserva deliberadamente el contrato histórico y devuelve solo la
 * URL string (o null). El proveedor es metadato interno: puede especificarse
 * con `set(key, value, { provider, ttlSeconds })` y no cambia a los callers
 * existentes que pasan un TTL numérico.
 */
export class StreamCache {
  /**
   * @param {object} [options]
   * @param {string} [options.persistPath] Ruta de archivo para persistir en disco.
   *   Si se omite, la caché es solo en memoria (comportamiento previo).
   * @param {number} [options.persistDebounceMs] Debounce de escritura (por defecto 3000).
   */
  constructor(options = {}) {
    /** @type {Map<string, { value: string, expiresAt: number, provider?: string }>} */
    this.cache = new Map();
    /** @type {Map<string, { hits: number, misses: number }>} */
    this._providerStats = new Map();
    this.persistPath = options.persistPath || null;
    this._debounceMs = options.persistDebounceMs ?? 3000;
    this._saveTimer = null;
    if (this.persistPath) this._load();
  }

  // ── Persistencia en disco (opt-in) ──
  _load() {
    try {
      if (!existsSync(this.persistPath)) return;
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
      const now = Date.now();
      if (data && Array.isArray(data.entries)) {
        for (const [k, v] of data.entries) {
          // provider es opcional para conservar archivos creados por versiones previas.
          if (
            v &&
            typeof v.value === 'string' &&
            typeof v.expiresAt === 'number' &&
            v.expiresAt > now &&
            (v.provider === undefined || typeof v.provider === 'string')
          ) {
            this.cache.set(k, v);
          }
        }
      }
    } catch { /* archivo ilegible: arrancar con caché vacía */ }
  }

  _scheduleSave() {
    if (!this.persistPath || this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush(); }, this._debounceMs);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /** Escribe la caché a disco de forma atómica (solo entradas vigentes). */
  flush() {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const now = Date.now();
      const entries = [];
      for (const [k, v] of this.cache) if (v.expiresAt > now) entries.push([k, v]);
      const tmp = `${this.persistPath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ entries }), 'utf8');
      renameSync(tmp, this.persistPath);
    } catch { /* no romper el servicio si falla el guardado */ }
  }

  /**
   * Devuelve la URL string para mantener compatibilidad con todos los callers.
   * `provider` opcional permite atribuir un miss cuando la clave no existe.
   */
  get(key, options = {}) {
    const item = this.cache.get(key);
    if (!item) {
      this._recordMiss(options?.provider || inferProvider(key));
      return null;
    }

    const provider = item.provider || options?.provider || inferProvider(key);
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this._recordMiss(provider);
      this._scheduleSave();
      return null;
    }

    this._recordHit(provider);
    // Marcar como usada más recientemente: reinsertar al final del Map.
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  /**
   * Devuelve una copia de la entrada incluyendo metadatos. No sustituye a get().
   */
  getEntry(key, options = {}) {
    const value = this.get(key, options);
    if (value === null) return null;
    const item = this.cache.get(key);
    return item ? { ...item } : null;
  }

  /**
   * Almacena una URL.
   *
   * Formas compatibles:
   *   set(key, value)
   *   set(key, value, ttlSeconds)
   *   set(key, value, { provider: 'deezer', ttlSeconds })
   *   set(key, value, { provider: 'deezer', ttl: ttlSeconds })
   *   set(key, value, ttlSeconds, provider)
   *
   * Una entrada Deezer sin TTL explícito recibe 24 horas. También se reconoce
   * la convención `deezer:` usada por AudioResolver para no romper su wiring
   * actual antes de que empiece a pasar metadatos explícitos.
   */
  set(key, value, ttlOrOptions = undefined, providerArg = undefined) {
    const inferredProvider = inferProvider(key);
    const config = normalizeSetOptions(ttlOrOptions, providerArg, inferredProvider);
    const ttl = clampTtl(config.ttlSeconds);
    const expiresAt = Date.now() + ttl * 1000;
    const item = { value, expiresAt };
    if (config.provider) item.provider = config.provider;

    // Si la clave ya existe, eliminarla para reinsertarla como más reciente.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= MAX_ENTRIES) {
      // Expulsar la entrada leída menos recientemente (primera del iterador).
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) this.cache.delete(lruKey);
    }

    this.cache.set(key, item);
    this._scheduleSave();
  }

  /**
   * Invalida una URL Deezer que falló. Las entradas de otros proveedores no se
   * eliminan accidentalmente; `failedUrl`, si se proporciona, debe coincidir.
   * Devuelve true cuando se eliminó una entrada.
   */
  invalidateFailedUrl(key, failedUrl = undefined) {
    const item = this.cache.get(key);
    if (!item || (item.provider || inferProvider(key)) !== 'deezer') return false;
    if (failedUrl !== undefined && item.value !== failedUrl) return false;
    this.cache.delete(key);
    this._scheduleSave();
    return true;
  }

  /** Alias semántico para integradores que llaman a la operación invalidateUrl. */
  invalidateUrl(key, failedUrl = undefined) {
    return this.invalidateFailedUrl(key, failedUrl);
  }

  /**
   * Estadísticas de lecturas agrupadas por proveedor. `entries` es el número
   * actual de entradas vigentes y no se mezcla con los contadores históricos.
   */
  getStatsByProvider() {
    const providers = new Set(this._providerStats.keys());
    for (const [key, item] of this.cache) providers.add(providerName(item, key));

    const result = {};
    for (const provider of providers) {
      const counters = this._providerStats.get(provider) || { hits: 0, misses: 0 };
      result[provider] = {
        entries: this._countEntries(provider),
        hits: counters.hits,
        misses: counters.misses,
        hitRatio: ratio(counters.hits, counters.misses),
      };
    }
    return result;
  }

  /** Devuelve las estadísticas de un proveedor o todas si no se especifica. */
  getProviderStats(provider = undefined) {
    const stats = this.getStatsByProvider();
    return provider === undefined ? stats : (stats[provider] || emptyProviderStats());
  }

  /** Alias público para callers que usan el nombre cacheStats. */
  getCacheStats() {
    return this.getStatsByProvider();
  }

  /** Hit ratio [0, 1] de un proveedor; sin lecturas devuelve 0. */
  getHitRatioByProvider(provider) {
    const stats = this.getProviderStats(provider);
    return stats.hitRatio;
  }

  /** Alias para el nombre singular usado por algunos integradores. */
  getProviderHitRatio(provider) {
    return this.getHitRatioByProvider(provider);
  }

  /** Clave normalizada para un par (artista, título). */
  keyFor(artist, title) {
    return `${normalizeText(artist)}:${normalizeText(title)}`;
  }

  size() {
    return this.cache.size;
  }

  _countEntries(provider) {
    let count = 0;
    for (const [key, item] of this.cache) {
      if (providerName(item, key) === provider) count++;
    }
    return count;
  }

  _recordHit(provider) {
    const counters = this._providerStatsFor(provider);
    counters.hits++;
  }

  _recordMiss(provider) {
    const counters = this._providerStatsFor(provider);
    counters.misses++;
  }

  _providerStatsFor(provider) {
    const name = provider || 'unknown';
    let counters = this._providerStats.get(name);
    if (!counters) {
      counters = { hits: 0, misses: 0 };
      this._providerStats.set(name, counters);
    }
    return counters;
  }
}

function normalizeSetOptions(ttlOrOptions, providerArg, inferredProvider) {
  if (ttlOrOptions && typeof ttlOrOptions === 'object') {
    const provider = normalizeProvider(ttlOrOptions.provider) || inferredProvider;
    const ttlSeconds = ttlOrOptions.ttlSeconds ?? ttlOrOptions.ttl ??
      (provider === 'deezer' ? DEEZER_CACHE_TTL_SECONDS : DEFAULT_CACHE_TTL_SECONDS);
    return { provider, ttlSeconds };
  }

  const provider = normalizeProvider(providerArg) || inferredProvider;
  const ttlSeconds = ttlOrOptions === undefined
    ? (provider === 'deezer' ? DEEZER_CACHE_TTL_SECONDS : DEFAULT_CACHE_TTL_SECONDS)
    : ttlOrOptions;
  return { provider, ttlSeconds };
}

function normalizeProvider(provider) {
  if (typeof provider !== 'string') return null;
  const normalized = provider.trim().toLowerCase();
  return normalized || null;
}

function inferProvider(key) {
  return typeof key === 'string' && key.startsWith('deezer:') ? 'deezer' : null;
}

function providerName(item, key) {
  return item?.provider || inferProvider(key) || 'unknown';
}

function emptyProviderStats() {
  return { entries: 0, hits: 0, misses: 0, hitRatio: 0 };
}

function ratio(hits, misses) {
  const total = hits + misses;
  return total === 0 ? 0 : hits / total;
}

function clampTtl(ttlSeconds) {
  const n = Number(ttlSeconds);
  if (!Number.isFinite(n)) return DEFAULT_CACHE_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(n)));
}
