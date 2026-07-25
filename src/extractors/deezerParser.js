/**
 * Parser de respuestas de Deezer para el formato TrackMetadata de Velocity Music.
 *
 * Esta integración se mantiene para uso educativo/de pruebas y no debe usarse
 * para descarga masiva ni para fines comerciales.
 */

const QUALITY_FORMATS = Object.freeze({
  MP3_128: 'MP3_128',
  MP3_320: 'MP3_320',
  FLAC: 'FLAC',
});

const QUALITY_ALIASES = new Map([
  ['MP3_128', QUALITY_FORMATS.MP3_128],
  ['MP3-128', QUALITY_FORMATS.MP3_128],
  ['MP3128', QUALITY_FORMATS.MP3_128],
  ['128', QUALITY_FORMATS.MP3_128],
  ['MP3', QUALITY_FORMATS.MP3_128],
  ['MP3_LOW', QUALITY_FORMATS.MP3_128],
  ['MP3_320', QUALITY_FORMATS.MP3_320],
  ['MP3-320', QUALITY_FORMATS.MP3_320],
  ['MP3320', QUALITY_FORMATS.MP3_320],
  ['320', QUALITY_FORMATS.MP3_320],
  ['MP3_HIGH', QUALITY_FORMATS.MP3_320],
  ['MP3_HQ', QUALITY_FORMATS.MP3_320],
  ['FLAC', QUALITY_FORMATS.FLAC],
  ['FLAC_1411', QUALITY_FORMATS.FLAC],
  ['FLAC-1411', QUALITY_FORMATS.FLAC],
  ['LOSSLESS', QUALITY_FORMATS.FLAC],
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function flattenName(value, fallback = null) {
  if (typeof value === 'string') return value || fallback;
  if (Array.isArray(value)) {
    const names = value.map((item) => flattenName(item, '')).filter(Boolean);
    return names.length ? names.join(', ') : fallback;
  }
  if (isObject(value)) {
    return firstValue(value.name, value.title, value.label, fallback);
  }
  return fallback;
}

function flattenId(value) {
  return isObject(value) ? firstValue(value.id, value.artistId, value.albumId) : null;
}

function toDurationMs(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    return Math.round(parts.reduce((total, part) => total * 60 + part, 0) * 1000);
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000) : null;
}

function normalizeDurationMs(track) {
  if (track.durationMs !== undefined && track.durationMs !== null) {
    const milliseconds = Number(track.durationMs);
    return Number.isFinite(milliseconds) && milliseconds >= 0
      ? Math.round(milliseconds)
      : null;
  }
  return toDurationMs(firstValue(track.durationSeconds, track.duration));
}

function pickArtwork(track, album) {
  return firstValue(
    track.artworkUrl,
    track.cover_xl,
    track.cover_big,
    track.cover_medium,
    track.cover_small,
    track.cover,
    album?.cover_xl,
    album?.cover_big,
    album?.cover_medium,
    album?.cover_small,
    album?.cover,
    track.artist?.picture_xl,
    track.artist?.picture_big,
    track.artist?.picture_medium,
    track.artist?.picture,
  );
}

/**
 * Convierte una entrada de canción Deezer a un TrackMetadata completo.
 * La función acepta tanto la respuesta de Deezer como un objeto ya serializado
 * por este parser, lo que permite comprobar el round-trip sin una forma de API
 * especial.
 */
function mapTrack(raw) {
  if (!isObject(raw)) return null;
  const hasTrackFields = ['id', 'trackId', 'title', 'name', 'artist'].some((key) => key in raw);
  if (!hasTrackFields) return null;

  const album = isObject(raw.album) ? raw.album : null;
  const artist = raw.artist;
  const albumName = flattenName(raw.album, firstValue(raw.albumName, raw.collectionName));
  const artistName = flattenName(
    artist,
    firstValue(raw.artistName, raw.author, raw.artists),
  );

  return {
    id: firstValue(raw.id, raw.trackId),
    title: firstValue(raw.title, raw.name),
    artist: artistName,
    artistId: firstValue(raw.artistId, flattenId(artist)),
    album: albumName,
    albumId: firstValue(raw.albumId, flattenId(raw.album)),
    durationMs: normalizeDurationMs(raw),
    artworkUrl: pickArtwork(raw, album),
    streamUrl: firstValue(raw.streamUrl, raw.stream_url),
    releaseDate: firstValue(raw.releaseDate, raw.release_date, album?.release_date),
    genre: flattenName(raw.genre, firstValue(raw.genreName, album?.genre)),
  };
}

function searchItems(json) {
  if (Array.isArray(json)) return json;
  if (!isObject(json)) return [];
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.tracks?.data)) return json.tracks.data;
  if (Array.isArray(json.results)) return json.results;
  // This also makes serialized TrackMetadata usable in the round-trip flow.
  return json.id !== undefined || json.title !== undefined ? [json] : [];
}

export class DeezerParser {
  /**
   * @param {unknown} json Deezer search response, array, or serialized track.
   * @returns {Array<object>} TrackMetadata entries; [] for invalid responses.
   */
  parseSearchResponse(json) {
    try {
      return searchItems(json).map(mapTrack).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * @param {unknown} json Deezer track response or { data: track }.
   * @returns {object|null} TrackMetadata, or null for invalid responses.
   */
  parseTrackResponse(json) {
    try {
      if (!isObject(json)) return null;
      const raw = isObject(json.data)
        ? json.data
        : Array.isArray(json.data)
          ? json.data[0]
          : json.track;
      return mapTrack(raw ?? json);
    } catch {
      return null;
    }
  }

  /**
   * Serializa metadata sin exponer ni alterar credenciales. Un valor inválido
   * produce JSON válido para que los consumidores puedan continuar sin lanzar.
   */
  serializeTrackMetadata(track) {
    if (!isObject(track)) return 'null';
    try {
      const serialized = JSON.stringify(track);
      return typeof serialized === 'string' ? serialized : 'null';
    } catch {
      return 'null';
    }
  }

  /**
   * Normaliza códigos Deezer y alias comunes al formato interno de Velocity.
   * @param {unknown} deezerFormat
   * @returns {'MP3_128'|'MP3_320'|'FLAC'|null}
   */
  normalizeQualityFormat(deezerFormat) {
    const value = isObject(deezerFormat)
      ? firstValue(deezerFormat.format, deezerFormat.quality, deezerFormat.code)
      : deezerFormat;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const key = String(value).trim().toUpperCase().replace(/\s+/g, '_');
    return QUALITY_ALIASES.get(key) ?? null;
  }

  /**
   * Converts a Velocity quality identifier to the Deezer stream format code.
   * @param {unknown} velocityFormat
   * @returns {'MP3_128'|'MP3_320'|'FLAC'|null}
   */
  toDeezerFormat(velocityFormat) {
    return this.normalizeQualityFormat(velocityFormat);
  }
}

export default DeezerParser;
