import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizeText } from '../lib/normalize.js';

export const DEFAULT_CACHE_TTL_SECONDS = 60 * 60 * 5; // 18000 (5h)
export const MIN_TTL_SECONDS = 1;
export const MAX_TTL_SECONDS = 604800 * 2; // 14 días
export const MAX_ENTRIES = 25000;

/**
 * Caché de streams clave→valor con TTL y expulsión LRU.
 *
 * - `set` sin TTL → 14400 s; TTL explícito acotado a [1, 604800].
 * - `get` elimina y no devuelve valor si la entrada caducó; marca la entrada
 *   como usada recientemente (para LRU); clave inexistente → null sin mutar
 *   ninguna otra entrada.
 * - Al superar `MAX_ENTRIES` se expulsa la entrada leída menos recientemente
 *   antes de añadir la nueva.
 *
 * Implementación LRU: aprovecha que `Map` conserva el orden de inserción. Al
 * leer o reinsertar una clave la movemos al final (más reciente); la primera
 * clave del iterador es por tanto la menos recientemente usada.
 *
 * Requisitos: 3.1, 3.3, 3.4, 3.5, 3.6, 3.8, 15.8
 */
export class StreamCache {
  /**
   * @param {object} [options]
   * @param {string} [options.persistPath] Ruta de archivo para persistir en disco.
   *   Si se omite, la caché es solo en memoria (comportamiento previo).
   * @param {number} [options.persistDebounceMs] Debounce de escritura (por defecto 3000).
   */
  constructor(options = {}) {
    /** @type {Map<string, { value: string, expiresAt: number }>} */
    this.cache = new Map();
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
          // Descartar entradas expiradas o malformadas al cargar.
          if (v && typeof v.value === 'string' && typeof v.expiresAt === 'number' && v.expiresAt > now) {
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

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Marcar como usada más recientemente: reinsertar al final del Map.
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS) {
    const ttl = clampTtl(ttlSeconds);
    const expiresAt = Date.now() + ttl * 1000;

    // Si la clave ya existe, eliminarla para reinsertarla como más reciente.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= MAX_ENTRIES) {
      // Expulsar la entrada leída menos recientemente (primera del iterador).
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
    this._scheduleSave();
  }

  /** Clave normalizada para un par (artista, título). */
  keyFor(artist, title) {
    return `${normalizeText(artist)}:${normalizeText(title)}`;
  }

  size() {
    return this.cache.size;
  }
}

function clampTtl(ttlSeconds) {
  const n = Number(ttlSeconds);
  if (!Number.isFinite(n)) return DEFAULT_CACHE_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(n)));
}
