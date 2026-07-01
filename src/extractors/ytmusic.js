/**
 * Catálogo de YouTube Music usando ytmusic-api.
 *
 * Diferencia clave frente a yt-dlp --dump-json:
 *  - Consulta el endpoint de CANCIONES de YouTube Music (no videos genéricos).
 *  - Devuelve portadas de álbum oficial (no miniaturas de vídeo).
 *  - Respuesta en ~300 ms (llamada HTTP interna, sin proceso externo).
 *  - Resultados ordenados por relevancia musical, no por popularidad de vídeo.
 *
 * Uso personal — sin autenticación requerida (inicialización anónima).
 */

import YTMusic from 'ytmusic-api';

import { normalizeText } from '../lib/normalize.js';

let _client = null;
// Mutex de inicialización: una sola Promise compartida entre peticiones concurrentes
// que llegan en el arranque en frío. Evita crear múltiples instancias.
let _initPromise = null;

async function getClient() {
  if (_client) return _client;
  if (!_initPromise) {
    _initPromise = (async () => {
      const c = new YTMusic();
      await c.initialize();
      _client = c;
      return c;
    })();
  }
  return _initPromise;
}

// Reintentar si el cliente falla (p.ej. error en inicialización).
async function getClientSafe() {
  try {
    return await getClient();
  } catch {
    // Reinicializar: limpiar la Promise para intentar de nuevo en la siguiente llamada.
    _client = null;
    _initPromise = null;
    const c = new YTMusic();
    await c.initialize();
    _client = c;
    _initPromise = Promise.resolve(c);
    return c;
  }
}

/**
 * Mapea un resultado de ytmusic-api a nuestro formato TrackMetadata.
 * Prioriza portadas de álbum en alta resolución.
 */
function mapYTMusicSong(song) {
  const thumb = pickBestThumb(song.thumbnails) || pickBestThumb(song.album?.thumbnails) || null;
  return {
    id: song.videoId ?? null,
    title: song.name ?? song.title ?? null,
    artist: extractArtist(song),
    artistId: extractArtistId(song),
    album: song.album?.name ?? null,
    albumId: song.album?.albumId ?? null,
    durationSeconds: song.duration ?? null,
    artworkUrl: thumb,
    releaseDate: song.year ? `${song.year}-01-01` : null,
    genre: null,
  };
}

function extractArtistId(song) {
  if (Array.isArray(song.artists) && song.artists.length) return song.artists[0].artistId ?? null;
  if (song.artist && typeof song.artist === 'object') return song.artist.artistId ?? null;
  return null;
}

/**
 * Eleva la URL de una portada a alta resolución.
 * YouTube Music sirve las portadas en Google (lh3/yt3.googleusercontent.com) con
 * un sufijo de tamaño (`=w544-h544-l90-rj` o `=s544`). Reescribimos ese sufijo a
 * un tamaño grande sin tocar los flags de recorte/formato, de modo que la CDN
 * entregue la imagen en alta resolución real.
 */
function hiRes(url, size = 1200) {
  if (!url || typeof url !== 'string') return url;
  // Google/YTM: =w544-h544-l90-rj → =w1200-h1200-l90-rj (conserva flags).
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  // Google: =s544 → =s1200
  if (/=s\d+/.test(url)) return url.replace(/=s\d+/, `=s${size}`);
  // Miniaturas de vídeo i.ytimg: subir a la máxima resolución.
  if (/\/(default|mqdefault|hqdefault|sddefault)\.jpg/i.test(url)) {
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault)\.jpg/i, '/maxresdefault.jpg');
  }
  // Estilo iTunes/legacy: 100x100bb.jpg → 1200x1200bb.jpg
  if (/\d+x\d+bb\.(jpg|png)/i.test(url)) return url.replace(/\d+x\d+bb\.(jpg|png)/i, `${size}x${size}bb.$1`);
  return url;
}

/** Elige la miniatura de mayor resolución disponible y la eleva a alta resolución. */
function pickBestThumb(thumbs) {
  if (!Array.isArray(thumbs) || !thumbs.length) return null;
  const sorted = [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return hiRes(sorted[0].url ?? null);
}

function extractArtist(song) {
  // ytmusic-api devuelve artists como array de { artistId, name } o strings.
  if (Array.isArray(song.artists) && song.artists.length) {
    return song.artists
      .map((a) => (typeof a === 'string' ? a : a?.name ?? ''))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof song.artist === 'string') return song.artist;
  if (song.artist?.name) return song.artist.name;
  if (typeof song.artistName === 'string') return song.artistName;
  return null;
}

/**
 * Busca canciones en YouTube Music. Devuelve registros TrackMetadata con
 * portadas de álbum y metadatos limpios.
 *
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
export async function searchYTMusic(query, limit = 20) {
  const client = await getClientSafe();
  // searchSongs busca solo en el catálogo de canciones (no videos).
  const results = await client.searchSongs(query);
  return results
    .slice(0, limit)
    .map(mapYTMusicSong)
    .filter((t) => t.id && t.title);
}

/**
 * Catálogo inyectable con la firma (query, limit) que espera metadataService.
 */
export function createYTMusicCatalog() {
  return async function catalogImpl(query, limit) {
    return searchYTMusic(query, limit);
  };
}

/** Perfil de artista: nombre, portada, canciones más escuchadas y álbumes. */
export async function getArtistData(artistId) {
  const client = await getClientSafe();
  const a = await client.getArtist(artistId);
  const artistName = a.name ?? null;
  const key = normalizeText(artistName || '');

  // Álbumes fiables: getArtist().topAlbums suele ser correcto. getArtistAlbums()
  // a veces devuelve playlists/recomendaciones ajenas, así que reforzamos con una
  // búsqueda directa y filtramos por artista coincidente, descartando playlists.
  let albums = Array.isArray(a.topAlbums) ? a.topAlbums.slice() : [];
  if (albums.length < 4 && artistName) {
    try { const s = await client.searchAlbums(artistName); if (Array.isArray(s)) albums = albums.concat(s); } catch {}
  }
  if (albums.length < 2) {
    try { const more = await client.getArtistAlbums(artistId); if (Array.isArray(more)) albums = albums.concat(more); } catch {}
  }
  const isAlbumId = (id) => typeof id === 'string' && !/^(VL|PL|RDCLAK)/.test(id);
  const seenAlb = new Set();
  const mappedAlbums = albums
    .map(mapAlbumDetailed)
    .filter((al) => al.albumId && isAlbumId(al.albumId))
    // Solo álbumes cuyo artista normalizado sea exactamente el artista buscado,
    // o al menos que el nombre del artista del perfil esté contenido de forma
    // completa en el del álbum (evita "Anna Kavinsky" colar con semilla "Kavinsky").
    .filter((al) => {
      if (!key) return true;
      const alArtist = normalizeText(al.artist || '');
      // Coincidencia exacta o el artista del perfil empieza el del álbum.
      return alArtist === key || alArtist.startsWith(key + ' ') || alArtist.split(/,\s*/).some(p => p === key);
    })
    .filter((al) => { if (seenAlb.has(al.albumId)) return false; seenAlb.add(al.albumId); return true; });

  let songs = a.topSongs || [];
  try { const full = await client.getArtistSongs(artistId); if (Array.isArray(full) && full.length) songs = full; } catch {}
  return {
    artistId,
    name: artistName,
    thumbnail: pickBestThumb(a.thumbnails),
    topSongs: songs.map(mapYTMusicSong).filter(s => s.id && s.title),
    albums: mappedAlbums,
  };
}

/** Álbum completo: metadatos + lista de pistas. */
export async function getAlbumData(albumId) {
  const client = await getClientSafe();
  const al = await client.getAlbum(albumId);
  const cover = pickBestThumb(al.thumbnails);
  const tracks = (al.songs || []).map(s => {
    const m = mapYTMusicSong(s);
    if (!m.artworkUrl) m.artworkUrl = cover;
    if (!m.album) m.album = al.name ?? null;
    if (!m.albumId) m.albumId = albumId;
    return m;
  }).filter(s => s.id && s.title);
  return {
    albumId,
    name: al.name ?? null,
    artist: al.artist?.name ?? null,
    artistId: al.artist?.artistId ?? null,
    year: al.year ?? null,
    cover,
    tracks,
  };
}

/** Letra nativa de YouTube Music por videoId (texto plano). */
export async function getLyricsById(videoId) {
  const client = await getClientSafe();
  const lines = await client.getLyrics(videoId);
  if (Array.isArray(lines) && lines.length) return lines.join('\n');
  if (typeof lines === 'string' && lines.trim()) return lines;
  return null;
}

/** Convierte "m:ss"/"h:mm:ss" o número a segundos. */
function parseDuration(d) {
  if (typeof d === 'number') return d;
  if (typeof d === 'string' && d.includes(':')) {
    const parts = d.split(':').map(Number);
    if (parts.some(Number.isNaN)) return null;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

/** Mapea una entrada de "Up Nexts" (radio de YouTube Music) a TrackMetadata. */
function mapUpNext(s) {
  let artist = null, artistId = null;
  if (typeof s.artists === 'string') {
    artist = s.artists;
  } else if (Array.isArray(s.artists) && s.artists.length) {
    artist = s.artists.map((a) => (typeof a === 'string' ? a : a?.name ?? '')).filter(Boolean).join(', ');
    artistId = s.artists[0]?.artistId ?? null;
  } else if (s.artists && typeof s.artists === 'object') {
    artist = s.artists.name ?? null;
    artistId = s.artists.artistId ?? null;
  } else if (typeof s.artist === 'string') {
    artist = s.artist;
  }
  const thumb = s.thumbnail ? hiRes(s.thumbnail) : pickBestThumb(s.thumbnails);
  return {
    id: s.videoId ?? null,
    title: s.title ?? s.name ?? null,
    artist,
    artistId,
    album: s.album?.name ?? null,
    albumId: s.album?.albumId ?? null,
    durationSeconds: parseDuration(s.duration),
    artworkUrl: thumb,
    releaseDate: null,
    genre: null,
  };
}

/**
 * Radio / "reproducir a continuación": dado un videoId, devuelve canciones
 * relacionadas (misma línea/estilo) tal como las agrupa YouTube Music.
 * Es la base de la reproducción tipo Spotify (seguir la canción elegida).
 */
export async function getRadio(videoId, limit = 25) {
  const client = await getClientSafe();
  const ups = await client.getUpNexts(videoId);
  return (Array.isArray(ups) ? ups : [])
    .filter((u) => (u.type ? u.type === 'SONG' : true) && u.videoId)
    .slice(0, limit)
    .map(mapUpNext)
    .filter((t) => t.id && t.title);
}

export function createYTMusicRadio() { return (videoId, limit) => getRadio(videoId, limit); }

function mapAlbumDetailed(al) {
  return {
    albumId: al.albumId ?? null,
    name: al.name ?? null,
    artist: al.artist?.name ?? null,
    year: al.year ?? null,
    cover: pickBestThumb(al.thumbnails),
  };
}

/** Implementaciones inyectables para las rutas de artista/álbum/letras. */
export function createYTMusicArtist() { return (artistId) => getArtistData(artistId); }
export function createYTMusicAlbum() { return (albumId) => getAlbumData(albumId); }
export function createYTMusicLyrics() { return (videoId) => getLyricsById(videoId); }

function mapArtistDetailed(a) {
  return { artistId: a.artistId ?? null, name: a.name ?? null, thumbnail: pickBestThumb(a.thumbnails) };
}

/** Búsqueda combinada: canciones + álbumes + artistas (en paralelo). */
export async function searchAllYTMusic(query, limit = 20) {
  const client = await getClientSafe();
  const [songsR, albumsR, artistsR] = await Promise.allSettled([
    client.searchSongs(query),
    client.searchAlbums(query),
    client.searchArtists(query),
  ]);
  const songs = songsR.status === 'fulfilled' ? songsR.value.slice(0, limit).map(mapYTMusicSong).filter(t => t.id && t.title) : [];
  const albums = albumsR.status === 'fulfilled' ? albumsR.value.slice(0, 12).map(mapAlbumDetailed).filter(a => a.albumId) : [];
  const artists = artistsR.status === 'fulfilled' ? artistsR.value.slice(0, 12).map(mapArtistDetailed).filter(a => a.artistId) : [];
  return { songs, albums, artists };
}

export function createYTMusicSearchAll() { return (query, limit) => searchAllYTMusic(query, limit); }
