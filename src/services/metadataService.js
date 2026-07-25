import { normalizeText } from '../lib/normalize.js';

/**
 * Metadata_Service — catálogo de YouTube Music.
 *
 * Consulta YouTube Music (vía un wrapper inyectable) y mapea los resultados a
 * registros Track_Metadata normalizados.
 *
 * El acceso al catálogo se inyecta mediante `catalogImpl` para poder probar la
 * lógica sin red ni dependencias de Python (ytmusicapi) / Node
 * (youtube-music-api). `catalogImpl(query, limit)` debe devolver una lista de
 * resultados crudos del catálogo.
 *
 * Requisitos: 1.1–1.9
 */

export const SEARCH_TIMEOUT_MS = 15000;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const MIN_LIMIT = 1;
export const MAX_QUERY_LENGTH = 256;

/** Error tipado para que la capa de transporte mapee al código HTTP correcto. */
export class MetadataError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MetadataError';
    this.status = status;
  }
}

/**
 * Normaliza el límite solicitado: ausente → 30; explícito → acotado a [1, 30].
 */
export function resolveLimit(limit) {
  if (limit === undefined || limit === null || limit === '') return DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)));
}

/**
 * Eleva la portada a alta resolución (1200x1200) cuando es posible.
 * YouTube Music sirve portadas con un sufijo de tamaño `=wXXX-hXXX`/`=sXXX` o,
 * en el caso de imágenes estilo iTunes, `100x100bb.jpg`. Cubrimos ambos.
 */
export function highResolutionArtwork(url) {
  if (!url || typeof url !== 'string') return null;
  // Estilo Google/YouTube: ...=w120-h120-l90-rj → =w1200-h1200 (conserva flags)
  if (/=w\d+-h\d+/.test(url)) {
    return url.replace(/=w\d+-h\d+/, '=w1200-h1200');
  }
  // Google: =s120 → =s1200
  if (/=s\d+/.test(url)) {
    return url.replace(/=s\d+/, '=s1200');
  }
  // Deezer: ...-500x500-... → ...-1200x1200-...
  if (/-\d+x\d+(?=-|\.|$)/i.test(url)) {
    return url.replace(/-\d+x\d+(?=-|\.|$)/i, '-1200x1200');
  }
  // Estilo iTunes/legacy: 100x100bb.jpg → 1200x1200bb.jpg
  if (/\d+x\d+bb\.(jpg|png)/i.test(url)) {
    return url.replace(/\d+x\d+bb\.(jpg|png)/i, '1200x1200bb.$1');
  }
  return url;
}

/**
 * Mapea un resultado crudo del catálogo de YouTube Music a Track_Metadata.
 * `streamUrl` → null (se resuelve bajo demanda por el Audio_Resolver);
 * cualquier otro campo ausente → null.
 */
export function mapYouTubeMusicTrack(raw = {}) {
  const source = isRecord(raw) ? raw : {};
  const artwork =
    source.artworkUrl ?? source.thumbnail ?? source.thumbnailUrl ?? source.cover ?? null;

  return {
    id: source.id ?? source.videoId ?? null,
    title: source.title ?? source.name ?? null,
    artist: source.artist ?? source.artistName ?? source.author ?? null,
    artistId: source.artistId ?? null,
    album: source.album ?? source.collectionName ?? null,
    albumId: source.albumId ?? null,
    durationMs: source.durationMs ?? source.duration_ms ?? toMs(source.durationSeconds) ?? null,
    artworkUrl: artwork ? highResolutionArtwork(artwork) : null,
    streamUrl: null,
    releaseDate: source.releaseDate ?? source.release_date ?? null,
    genre: source.genre ?? source.primaryGenreName ?? null,
    isrc: extractIsrc(source),
    // `source` is retained for catalog-only SoundCloud entries; normal YT
    // entries are explicitly marked so callers can preserve provider priority.
    provider: source.provider ?? source.source ?? 'youtube',
  };
}

/**
 * Mapea una pista cruda de Deezer a Track_Metadata. Este adaptador es de
 * catálogo únicamente: nunca copia una URL de audio al resultado.
 *
 * `artworkProxy`/`artworkProxyUrl`/`artworkProxyBaseUrl` son opciones opt-in
 * para instalaciones que ya tengan una ruta de proxy compatible. Si no se
 * proporciona ninguna, se conserva la URL HTTPS de Deezer.
 */
export function mapDeezerTrack(raw = {}, options = {}) {
  const source = isRecord(raw) ? raw : {};
  const album = isRecord(source.album) ? source.album : {};
  const artist = isRecord(source.artist) ? source.artist : {};
  const artwork = firstNonEmpty(
    source.artworkUrl,
    source.cover_xl,
    source.cover_big,
    source.cover_medium,
    source.cover_small,
    source.cover,
    album.cover_xl,
    album.cover_big,
    album.cover_medium,
    album.cover_small,
    album.cover,
    artist.picture_xl,
    artist.picture_big,
    artist.picture_medium,
    artist.picture,
  );
  const artworkUrl = artwork
    ? applyArtworkProxy(highResolutionArtwork(artwork), options)
    : null;

  return {
    id: source.id ?? source.trackId ?? source.deezerId ?? null,
    title: firstNonEmpty(source.title, source.name),
    artist: firstNonEmpty(source.artistName, source.artist, source.author, source.artists, artist.name),
    artistId: source.artistId ?? artist.id ?? null,
    album: firstNonEmpty(source.albumName, source.collectionName, source.album, album.title, album.name),
    albumId: source.albumId ?? album.id ?? null,
    durationMs: source.durationMs ?? source.duration_ms
      ?? toMs(source.durationSeconds ?? source.duration) ?? null,
    artworkUrl,
    streamUrl: null,
    releaseDate: firstNonEmpty(source.releaseDate, source.release_date, album.release_date),
    genre: firstNonEmpty(source.genre, source.genreName, album.genre),
    isrc: extractIsrc(source),
    provider: 'deezer',
  };
}

function toMs(seconds) {
  if (seconds === undefined || seconds === null || seconds === '') return null;
  if (typeof seconds === 'string' && seconds.includes(':')) {
    const parts = seconds.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    return Math.round(parts.reduce((total, part) => total * 60 + part, 0) * 1000);
  }
  const n = Number(seconds);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

/**
 * Busca pistas en YouTube Music y devuelve registros Track_Metadata.
 *
 * @throws {MetadataError} 400 si la consulta es inválida; 502 si el catálogo
 *   falla, es inalcanzable o no responde en SEARCH_TIMEOUT_MS.
 */
export async function searchTracks(query, opts = {}) {
  const {
    limit,
    catalogImpl,
    deezerCatalogImpl,
    timeoutMs = SEARCH_TIMEOUT_MS,
    artworkProxy,
    artworkProxyUrl,
    artworkProxyBaseUrl,
  } = opts;

  const q = String(query ?? '').trim();
  if (!q) {
    throw new MetadataError(400, 'El parámetro de búsqueda "q" es obligatorio.');
  }
  if (q.length > MAX_QUERY_LENGTH) {
    throw new MetadataError(
      400,
      `La consulta supera la longitud máxima de ${MAX_QUERY_LENGTH} caracteres.`,
    );
  }

  if (typeof catalogImpl !== 'function') {
    throw new MetadataError(502, 'El catálogo de YouTube Music no está disponible.');
  }

  const effectiveLimit = resolveLimit(limit);
  let youtubeRaw = [];
  let youtubeFailed = false;
  try {
    youtubeRaw = await withTimeout(catalogImpl(q, effectiveLimit), timeoutMs);
  } catch {
    youtubeFailed = true;
  }

  // Deezer es una expansión de catálogo opt-in, no un extractor de audio.
  // Sus errores no ocultan resultados válidos de YouTube Music.
  let deezerRaw = [];
  if (typeof deezerCatalogImpl === 'function') {
    try {
      deezerRaw = await withTimeout(deezerCatalogImpl(q, effectiveLimit), timeoutMs);
    } catch {
      deezerRaw = [];
    }
  }

  if (youtubeFailed && typeof deezerCatalogImpl !== 'function') {
    throw new MetadataError(502, 'El catálogo de YouTube Music no está disponible.');
  }

  const mappedYouTube = (Array.isArray(youtubeRaw) ? youtubeRaw : []).map(mapYouTubeMusicTrack);
  const artworkOptions = { artworkProxy, artworkProxyUrl, artworkProxyBaseUrl };
  const mappedDeezer = (Array.isArray(deezerRaw) ? deezerRaw : [])
    .map((track) => mapDeezerTrack(track, artworkOptions));

  if (typeof deezerCatalogImpl !== 'function') return mappedYouTube;

  // La concatenación determina la prioridad: YouTube Music siempre gana
  // frente a Deezer cuando ambas entradas representan la misma pista. No
  // deduplicamos YT consigo mismo para conservar el contrato histórico.
  const youtubeKeys = new Set(mappedYouTube.flatMap(trackKeys));
  const uniqueDeezer = dedupeTracks(mappedDeezer).filter(
    (track) => !trackKeys(track).some((key) => youtubeKeys.has(key)),
  );
  return [...mappedYouTube, ...uniqueDeezer].slice(0, effectiveLimit);
}

/**
 * Deduplica preservando la primera aparición. Se comparan identificadores,
 * ISRC y, como último recurso, título+artista normalizados.
 */
export function dedupeTracks(tracks = []) {
  const seen = new Set();
  const result = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const keys = trackKeys(track);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    result.push(track);
  }
  return result;
}

function trackKeys(track) {
  if (!isRecord(track)) return [];
  const keys = [];
  for (const field of ['id', 'trackId', 'videoId', 'deezerId', 'providerId', 'catalogId']) {
    const value = normalizeKeyValue(track[field]);
    if (value) keys.push(`id:${value}`);
  }
  const isrc = normalizeKeyValue(track.isrc ?? track.isrcCode ?? track.trackIsrc);
  if (isrc) keys.push(`isrc:${isrc}`);

  const title = normalizeTitle(track.title ?? track.name);
  const artist = normalizeKeyValue(track.artist ?? track.artistName ?? track.author);
  if (title && artist) keys.push(`song:${artist}|${title}`);
  return keys;
}

function normalizeTitle(value) {
  // Align with the existing server dedupe: parenthesized/bracketed suffixes
  // such as "(Remastered)" do not create a second catalog entry.
  return normalizeKeyValue(value).replace(/\s*[([{].*$/, '').trim();
}

function normalizeKeyValue(value) {
  const normalized = normalizeText(value);
  return normalized === '[object object]' ? '' : normalized;
}

function extractIsrc(source) {
  if (!isRecord(source)) return null;
  const external = isRecord(source.externalIds)
    ? source.externalIds
    : isRecord(source.external_ids)
      ? source.external_ids
      : {};
  return firstNonEmpty(source.isrc, source.isrcCode, source.trackIsrc, external.isrc);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const names = value.map((item) => firstNonEmpty(
        item?.name,
        item?.title,
        item?.artist,
      )).filter(Boolean);
      if (names.length) return names.join(', ');
      continue;
    }
    if (isRecord(value)) {
      const nested = firstNonEmpty(value.name, value.title, value.label);
      if (nested) return nested;
      continue;
    }
    return String(value);
  }
  return null;
}

function applyArtworkProxy(url, options = {}) {
  if (!url) return null;
  const proxy = options.artworkProxy;
  if (typeof proxy === 'function') {
    try {
      const proxied = proxy(url);
      return typeof proxied === 'string' && proxied ? proxied : url;
    } catch {
      return url;
    }
  }

  const template = firstNonEmpty(options.artworkProxyUrl, options.artworkProxyBaseUrl);
  if (!template) return url;
  const encoded = encodeURIComponent(url);
  if (template.includes('{url}')) return template.replaceAll('{url}', encoded);
  const parameter = /(?:^|\/)img\/?$/i.test(template) ? 'u' : 'url';
  return `${template}${template.includes('?') ? '&' : '?'}${parameter}=${encoded}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
