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
  const artwork =
    raw.artworkUrl ?? raw.thumbnail ?? raw.thumbnailUrl ?? raw.cover ?? null;

  return {
    id: raw.id ?? raw.videoId ?? null,
    title: raw.title ?? raw.name ?? null,
    artist: raw.artist ?? raw.artistName ?? raw.author ?? null,
    artistId: raw.artistId ?? null,
    album: raw.album ?? raw.collectionName ?? null,
    albumId: raw.albumId ?? null,
    durationMs: raw.durationMs ?? raw.duration_ms ?? toMs(raw.durationSeconds) ?? null,
    artworkUrl: artwork ? highResolutionArtwork(artwork) : null,
    streamUrl: null,
    releaseDate: raw.releaseDate ?? raw.release_date ?? null,
    genre: raw.genre ?? raw.primaryGenreName ?? null,
  };
}

function toMs(seconds) {
  if (seconds === undefined || seconds === null) return null;
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
  const { limit, catalogImpl, timeoutMs = SEARCH_TIMEOUT_MS } = opts;

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

  let rawResults;
  try {
    rawResults = await withTimeout(catalogImpl(q, effectiveLimit), timeoutMs);
  } catch {
    throw new MetadataError(502, 'El catálogo de YouTube Music no está disponible.');
  }

  return (Array.isArray(rawResults) ? rawResults : []).map(mapYouTubeMusicTrack);
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
