import { dedupeTracks } from '../services/metadataService.js';

const DEFAULT_LIMIT = 20;

/**
 * Crea el adaptador de catálogo de Deezer para metadataService.
 *
 * La búsqueda se inyecta para que este módulo pueda probarse sin red:
 * `createDeezerCatalog({ provider })`, `createDeezerCatalog({ searchTracks })`
 * o pasando directamente un objeto que implemente `searchTracks`.
 *
 * @param {object|function} [dependency]
 * @returns {(query: string, limit?: number) => Promise<object[]>}
 */
export function createDeezerCatalog(dependency = {}) {
  const searchTracks = resolveSearchTracks(dependency);

  return async function deezerCatalog(query, limit = DEFAULT_LIMIT) {
    const normalizedQuery = normalizeQuery(query);
    const normalizedLimit = normalizeLimit(limit);
    if (!searchTracks || !normalizedQuery || normalizedLimit === 0) return [];

    try {
      const rawResults = await searchTracks(normalizedQuery, normalizedLimit);
      if (!Array.isArray(rawResults)) return [];

      // Deezer participa aquí únicamente como catálogo. El stream se resuelve
      // después mediante Audio_Resolver y nunca se filtra una URL de audio.
      const catalogResults = rawResults
        .map(toCatalogTrack)
        .filter(Boolean);
      return dedupeTracks(catalogResults).slice(0, normalizedLimit);
    } catch {
      // El catálogo es opcional: un fallo de Deezer no debe romper la búsqueda.
      return [];
    }
  };
}

function resolveSearchTracks(dependency) {
  if (typeof dependency === 'function') return dependency;
  if (!isRecord(dependency)) return null;

  if (typeof dependency.searchTracks === 'function') {
    return dependency.searchTracks.bind(dependency);
  }
  if (typeof dependency.provider?.searchTracks === 'function') {
    return dependency.provider.searchTracks.bind(dependency.provider);
  }
  if (typeof dependency.deezerProvider?.searchTracks === 'function') {
    return dependency.deezerProvider.searchTracks.bind(dependency.deezerProvider);
  }
  return null;
}

function toCatalogTrack(raw) {
  if (!isRecord(raw)) return null;

  const {
    streamUrl: _streamUrl,
    stream_url: _streamUrlSnake,
    audioUrl: _audioUrl,
    audio_url: _audioUrlSnake,
    audio: _audio,
    preview: _preview,
    previewUrl: _previewUrl,
    preview_url: _previewUrlSnake,
    ...metadata
  } = raw;

  return {
    ...metadata,
    provider: 'deezer',
    streamUrl: null,
  };
}

function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : DEFAULT_LIMIT;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
