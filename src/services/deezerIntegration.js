/**
 * Adaptadores de integración de Deezer para el pipeline existente.
 *
 * Este módulo solo hace wiring: no modifica el resolver, no expone tokens y no
 * realiza llamadas de red por sí mismo. Deezer se mantiene como proveedor
 * opcional para uso educativo/testing no comercial.
 */
import { DeezerProvider } from '../extractors/deezer.js';
import { loadDeezerConfig, validateConfig } from '../extractors/deezerConfig.js';
import { normalizeText } from '../lib/normalize.js';

const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Inicializa Deezer sin permitir que una configuración inválida derribe el
 * servidor. La ausencia de ARL no impide crear el proveedor: sus clientes
 * pueden usar endpoints públicos y devolverán []/null si no están disponibles.
 *
 * @param {object} [config] Configuración cargada o dobles de prueba.
 * @returns {DeezerProvider|object|null} proveedor o null si está deshabilitado
 */
export function setupDeezerProvider(config) {
  try {
    if (isProvider(config)) return config;

    const options = config === undefined ? loadDeezerConfig() : config;
    if (!isObject(options)) {
      logWarning(options, 'Deezer disabled: configuration is not an object.');
      return null;
    }
    if (options.enabled === false) return null;
    if (isProvider(options.provider)) return options.provider;
    if (isProvider(options.deezerProvider)) return options.deezerProvider;

    // La validación se usa para detectar configuración incompleta sin incluir
    // valores sensibles en logs. Los defaults del provider mantienen el modo
    // degradado operativo cuando falta el ARL.
    const validationErrors = validateConfig(options);
    if (validationErrors.length > 0) {
      logWarning(options, `Deezer running in degraded mode: ${validationErrors[0]}`);
    }

    if (typeof options.providerFactory === 'function') {
      const provider = options.providerFactory(options);
      return isProvider(provider) ? provider : null;
    }

    return new DeezerProvider(options);
  } catch (error) {
    logWarning(config, 'Deezer provider initialization failed; continuing without fallback.', error);
    return null;
  }
}

/**
 * Crea el adaptador que consume Audio_Resolver.
 *
 * La firma deliberadamente coincide con el resolver real:
 * `{ artist, title, quality }` -> URL HTTP(S) o null.
 *
 * @param {DeezerProvider|object} [providerOrConfig]
 * @returns {(request: {artist:string,title:string,quality?:string}) => Promise<string|null>}
 */
export function createDeezerExtractor(providerOrConfig) {
  const provider = providerOrConfig === undefined
    ? setupDeezerProvider()
    : isProvider(providerOrConfig)
      ? providerOrConfig
      : setupDeezerProvider(providerOrConfig);

  return async function deezerExtractor(request = {}) {
    if (!isProvider(provider)) return null;

    const artist = cleanText(request.artist);
    const title = cleanText(request.title);
    if (!artist || !title) return null;

    try {
      const query = `${artist} ${title}`.trim();
      const tracks = await provider.searchTracks(query, DEFAULT_SEARCH_LIMIT);
      const candidate = matchDeezerTrack(tracks, artist, title);
      if (!candidate) return null;
      return await provider.getStreamUrl(candidate, request.quality);
    } catch {
      // El fallback es opcional: errores de Deezer nunca deben propagarse al
      // resolver ni desplazar la respuesta degradada histórica.
      return null;
    }
  };
}

/**
 * Crea el catálogo de Deezer para Metadata_Service.
 *
 * Es catalog-only: nunca solicita streams y garantiza que los resultados no
 * transporten una URL de audio aunque el proveedor devuelva una accidentalmente.
 *
 * @param {DeezerProvider|object} [providerOrConfig]
 * @returns {(query:string, limit?:number) => Promise<object[]>}
 */
export function createDeezerCatalog(providerOrConfig) {
  const provider = providerOrConfig === undefined
    ? setupDeezerProvider()
    : isCatalogProvider(providerOrConfig)
      ? providerOrConfig
      : setupDeezerProvider(providerOrConfig);

  return async function deezerCatalog(query, limit = DEFAULT_SEARCH_LIMIT) {
    if (!isCatalogProvider(provider)) return [];
    const normalizedQuery = cleanText(query);
    if (!normalizedQuery) return [];

    try {
      const tracks = await provider.searchTracks(normalizedQuery, normalizeLimit(limit));
      return (Array.isArray(tracks) ? tracks : [])
        .filter(isObject)
        .map(stripAudioFields);
    } catch {
      return [];
    }
  };
}

/**
 * Inyecta el extractor en cualquier forma de resolver actualmente soportada:
 * una función `resolve(params, ctx)` o un objeto con método `.resolve()`.
 * El resolver original no se muta.
 */
export function extendAudioResolver(resolver, deezerExtractor) {
  const extractor = typeof deezerExtractor === 'function'
    ? deezerExtractor
    : async () => null;

  if (typeof resolver === 'function') {
    return function enhancedAudioResolver(params, context) {
      return resolver.call(this, params, withDeezerExtractor(context, extractor));
    };
  }

  if (isObject(resolver) && typeof resolver.resolve === 'function') {
    return {
      ...resolver,
      resolve(params, context) {
        return resolver.resolve.call(resolver, params, withDeezerExtractor(context, extractor));
      },
    };
  }

  // Invalid wiring is treated as unavailable rather than throwing during
  // startup; the caller can continue with its existing resolver reference.
  return resolver;
}

function withDeezerExtractor(context, extractor) {
  return {
    ...(isObject(context) ? context : {}),
    deezerExtractorImpl: extractor,
  };
}

function matchDeezerTrack(tracks, artist, title) {
  if (!Array.isArray(tracks)) return null;
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  if (!normalizedArtist || !normalizedTitle) return null;

  return tracks.find((track) => {
    if (!isObject(track)) return false;
    const candidateArtist = normalizeText(track.artist ?? track.artistName ?? track.author);
    const candidateTitle = normalizeText(track.title ?? track.name);
    return candidateArtist.includes(normalizedArtist)
      && candidateTitle.includes(normalizedTitle);
  }) ?? null;
}

function stripAudioFields(track) {
  const {
    streamUrl: _streamUrl,
    stream_url: _stream_url,
    audioUrl: _audioUrl,
    audio_url: _audio_url,
    url: _url,
    ...metadata
  } = track;
  return { ...metadata, streamUrl: null };
}

function isProvider(value) {
  return isObject(value)
    && typeof value.searchTracks === 'function'
    && typeof value.getStreamUrl === 'function';
}

function isCatalogProvider(value) {
  return isObject(value) && typeof value.searchTracks === 'function';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(100, Math.floor(number)));
}

function logWarning(config, message, error) {
  const logger = isObject(config) ? config.logger : null;
  if (!logger || typeof logger.warn !== 'function') return;
  try {
    logger.warn(message, error ? { error: error.name || 'unknown' } : undefined);
  } catch {
    // Logging must never turn safe degradation into an initialization failure.
  }
}
