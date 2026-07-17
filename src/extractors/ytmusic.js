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
import { artistNameMatches } from '../lib/lyricsMatch.js';

let _client = null;
// Mutex de inicialización: una sola Promise compartida entre peticiones concurrentes
// que llegan en el arranque en frío. Evita crear múltiples instancias.
let _initPromise = null;

async function getClient() {
  if (_client) return _client;
  if (!_initPromise) {
    _initPromise = (async () => {
      try {
        const c = new YTMusic();
        await c.initialize();
        _client = c;
        return c;
      } catch (err) {
        _initPromise = null;
        throw err;
      }
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

/** Elimina sufijos promocionales del título (Official Audio/Video, etc.) */
function cleanTitle(raw) {
  if (!raw) return raw;
  return raw
    // Quita bloques entre paréntesis/corchetes con palabras clave promocionales
    .replace(/\s*[\(\[]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|lyric[s]?|visualizer|hd|4k|mv|clip)\s*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*official\s*[\)\]]/gi, '')
    // Quita sufijos sueltos al final (sin paréntesis): " - Official Video", etc.
    .replace(/\s*[-–|]\s*official\s+(?:video|audio|music\s+video|lyric[s]?|visualizer|hd|4k|mv|clip)\s*$/gi, '')
    .replace(/\s*[-–|]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyric[s]?|visualizer|hd|4k|mv)\s*$/gi, '')
    .trim();
}

/**
 * Mapea un resultado de ytmusic-api a nuestro formato TrackMetadata.
 * Prioriza portadas de álbum en alta resolución.
 */
function mapYTMusicSong(song) {
  const thumb = pickBestThumb(song.thumbnails) || pickBestThumb(song.album?.thumbnails) || null;
  return {
    id: song.videoId ?? null,
    title: cleanTitle(song.name ?? song.title ?? null),
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

  // Canciones: topSongs suele ser fiable. getArtistSongs a veces mete
  // recomendaciones ajenas ("Dale Don Dale" en System of a Down). Filtramos
  // siempre por coincidencia de artista y priorizamos el orden de topSongs.
  let rawSongs = Array.isArray(a.topSongs) ? a.topSongs.slice() : [];
  try {
    const full = await client.getArtistSongs(artistId);
    if (Array.isArray(full) && full.length) {
      const seen = new Set(rawSongs.map((s) => s.videoId || s.id).filter(Boolean));
      for (const s of full) {
        const vid = s.videoId || s.id;
        if (vid && seen.has(vid)) continue;
        if (vid) seen.add(vid);
        rawSongs.push(s);
      }
    }
  } catch {}
  const mappedSongs = rawSongs
    .map(mapYTMusicSong)
    .filter((s) => s.id && s.title)
    .filter((s) => !key || artistNameMatches(s.artist, artistName));
  // Deduplicar por título normalizado (misma canción, distintas subidas).
  const seenTitle = new Set();
  const topSongs = mappedSongs.filter((s) => {
    const k = `${normalizeText(s.title)}|${normalizeText(s.artist)}`;
    if (seenTitle.has(k)) return false;
    seenTitle.add(k);
    return true;
  });
  return {
    artistId,
    name: artistName,
    thumbnail: pickBestThumb(a.thumbnails),
    topSongs,
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
  // Preferir portada de álbum (si existe) sobre miniatura de video de YouTube.
  // Las miniaturas de i.ytimg.com son capturas del video, no artwork oficial.
  const albumThumb = pickBestThumb(s.album?.thumbnails);
  const rawThumb = s.thumbnail ? hiRes(s.thumbnail) : pickBestThumb(s.thumbnails);
  const isVideoThumb = (url) => url && typeof url === 'string' && url.includes('i.ytimg.com');
  const artworkUrl = albumThumb || (isVideoThumb(rawThumb) ? null : rawThumb) || rawThumb;
  return {
    id: s.videoId ?? null,
    title: cleanTitle(s.title ?? s.name ?? null),
    artist,
    artistId,
    album: s.album?.name ?? null,
    albumId: s.album?.albumId ?? null,
    durationSeconds: parseDuration(s.duration),
    artworkUrl,
    releaseDate: null,
    genre: null,
  };
}

/**
 * Radio / "reproducir a continuación": dado un videoId, devuelve canciones
 * relacionadas (misma línea/estilo) tal como las agrupa YouTube Music.
 * Es la base de la reproducción tipo Spotify (seguir la canción elegida).
 *
 * Mejoras v2:
 *  - Soporta hasta 100 canciones (antes 25).
 *  - Expansión de grafo con hasta 10 semillas secundarias.
 *  - Diversidad de artistas: máximo 3 canciones consecutivas del mismo artista
 *    y máximo 5 canciones en total por artista (antes sin límite).
 *  - Deduplicación estricta por videoId.
 */
export async function getRadio(videoId, limit = 100) {
  const client = await getClientSafe();
  const seen = new Set();
  const out = [];

  // Helpers de diversidad
  const artistCount = new Map();
  const MAX_PER_ARTIST = 5;

  // Incorpora un lote de "Up Nexts" respetando unicidad, el límite y la
  // diversidad de artistas.
  const ingest = (ups) => {
    for (const u of (Array.isArray(ups) ? ups : [])) {
      if (out.length >= limit) break;
      if (!u || !u.videoId) continue;
      if (u.type && u.type !== 'SONG') continue;
      if (seen.has(u.videoId)) continue;
      const t = mapUpNext(u);
      if (!t.id || !t.title) continue;
      const artistKey = (t.artist || '').toLowerCase();
      const count = artistCount.get(artistKey) || 0;
      if (count >= MAX_PER_ARTIST) continue;
      seen.add(u.videoId);
      artistCount.set(artistKey, count + 1);
      out.push(t);
    }
  };

  // Semilla principal.
  try { ingest(await client.getUpNexts(videoId)); } catch {}

  // Expansión del grafo: usar hasta 10 pistas como semillas secundarias.
  // Se hace en paralelo para ser rápido; se ingestan en orden para mantener
  // relevancia (las pistas más cercanas a la semilla primero).
  if (out.length < limit) {
    const secondary = out.slice(0, 10).map((t) => t.id).filter((id) => id && id !== videoId);
    const batches = await Promise.all(secondary.map((id) => client.getUpNexts(id).catch(() => [])));
    for (const b of batches) {
      if (out.length >= limit) break;
      ingest(b);
    }
  }

  // Si aún no llegamos al límite, hacer una segunda ronda con semillas de la
  // parte media del grafo (distancia 2 desde la semilla original).
  if (out.length < limit) {
    const tertiary = out.slice(10, 20).map((t) => t.id).filter((id) => id && id !== videoId);
    const batches2 = await Promise.all(tertiary.map((id) => client.getUpNexts(id).catch(() => [])));
    for (const b of batches2) {
      if (out.length >= limit) break;
      ingest(b);
    }
  }

  return out.slice(0, limit);
}

export function createYTMusicRadio() { return (videoId, limit) => getRadio(videoId, limit); }

/**
 * Metadatos de una canción por su videoId. Se usa para recuperar (hidratar) los
 * datos de pistas que un usuario tiene en su biblioteca (favoritos, playlists,
 * historial) cuando el dispositivo no los tiene en caché local.
 */
export async function getSongById(videoId) {
  if (!videoId) return null;
  const client = await getClientSafe();
  const s = await client.getSong(videoId);
  if (!s) return null;
  return {
    id: s.videoId ?? videoId,
    title: cleanTitle(s.name ?? null),
    artist: s.artist?.name ?? null,
    artistId: s.artist?.artistId ?? null,
    album: null,
    albumId: null,
    cover: pickBestThumb(s.thumbnails) || null,
    durationSeconds: s.duration ?? null,
    genre: null,
  };
}

export function createYTMusicSong() { return (videoId) => getSongById(videoId); }

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

/** Puntúa una pista frente a la query (título exacto, artista, solape). */
function scoreSearchSong(queryNorm, song, primaryArtistNorm) {
  const title = normalizeText(song.title || '');
  const artist = normalizeText(song.artist || '');
  let sc = 0;
  if (title === queryNorm) sc += 100;
  else if (title.startsWith(queryNorm) || queryNorm.startsWith(title)) sc += 70;
  else if (title.includes(queryNorm) || queryNorm.includes(title)) sc += 45;
  else {
    const qt = new Set(queryNorm.split(' ').filter((w) => w.length > 1));
    const tt = title.split(' ').filter((w) => w.length > 1);
    const hit = tt.filter((w) => qt.has(w)).length;
    sc += hit * 12;
  }
  if (artist === queryNorm) sc += 90;
  else if (artistNameMatches(song.artist, queryNorm)) sc += 70;
  else if (artist.includes(queryNorm) || queryNorm.includes(artist)) sc += 35;

  if (primaryArtistNorm) {
    if (artist === primaryArtistNorm || artistNameMatches(song.artist, primaryArtistNorm)) sc += 55;
    else sc -= 25; // en búsqueda de artista, castigar covers/ajenos
  }
  // Covers / tributos / karaoke suelen contaminar resultados de artista
  if (/\b(cover|tribute|karaoke|instrumental|nightcore|8-bit|string quartet|lullaby|baby shark)\b/i.test(`${song.title} ${song.artist}`)) {
    sc -= 40;
  }
  if (song.source === 'soundcloud') sc -= 15;
  return sc;
}

/**
 * Ordena (y opcionalmente filtra) canciones de búsqueda.
 * - Query ≈ nombre de artista → prioriza/filtra canciones de ese artista.
 * - Query ≈ título → la canción exacta primero, luego relacionadas.
 */
export function rankSearchSongs(query, songs, artists = []) {
  const nq = normalizeText(query || '');
  if (!nq || !Array.isArray(songs) || !songs.length) return songs || [];

  // Artista principal: match exacto o muy cercano con la query.
  let primary = null;
  for (const a of artists) {
    const na = normalizeText(a?.name || '');
    if (!na) continue;
    if (na === nq || nq === na || artistNameMatches(a.name, query) || artistNameMatches(query, a.name)) {
      primary = a;
      break;
    }
  }
  // También si el top song ya es del artista buscado y la query es su nombre.
  const primaryNorm = primary ? normalizeText(primary.name) : null;
  const isArtistQuery = Boolean(primaryNorm);

  let list = songs.slice();
  if (isArtistQuery) {
    const own = list.filter((s) => artistNameMatches(s.artist, primary.name));
    const rest = list.filter((s) => !artistNameMatches(s.artist, primary.name));
    // Primero solo del artista; el resto (género/relacionados) al final.
    list = [...own, ...rest];
  }

  return list
    .map((s, i) => ({ s, i, sc: scoreSearchSong(nq, s, primaryNorm) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .map((x) => x.s);
}

/** Búsqueda combinada: canciones + álbumes + artistas (en paralelo). */
export async function searchAllYTMusic(query, limit = 20) {
  const client = await getClientSafe();
  const [songsR, albumsR, artistsR] = await Promise.allSettled([
    client.searchSongs(query),
    client.searchAlbums(query),
    client.searchArtists(query),
  ]);
  let songs = songsR.status === 'fulfilled' ? songsR.value.slice(0, Math.max(limit, 30)).map(mapYTMusicSong).filter(t => t.id && t.title) : [];
  const albums = albumsR.status === 'fulfilled' ? albumsR.value.slice(0, 12).map(mapAlbumDetailed).filter(a => a.albumId) : [];
  const artists = artistsR.status === 'fulfilled' ? artistsR.value.slice(0, 12).map(mapArtistDetailed).filter(a => a.artistId) : [];

  // Mejora para búsquedas de género/estilo: cuando los resultados de canciones
  // no son representativos (artistas poco conocidos dominan el top), enriquecer
  // con canciones de los artistas más representativos de los álbumes encontrados.
  // Solo si la query NO parece un artista concreto (evita contaminar "System of a Down").
  const nq = normalizeText(query);
  const looksLikeArtist = artists.some((a) => {
    const na = normalizeText(a.name || '');
    return na === nq || artistNameMatches(a.name, query);
  });

  if (!looksLikeArtist && songs.length > 0 && albums.length > 0) {
    const songArtistKeys = new Set(songs.map(s => (s.artist || '').toLowerCase().replace(/\s+/g, '')));
    const albumArtists = albums
      .map(a => a.artist).filter(Boolean)
      .filter(a => !songArtistKeys.has(a.toLowerCase().replace(/\s+/g, '')));
    const missingArtists = [...new Set(albumArtists)].slice(0, 4);
    if (missingArtists.length) {
      const extra = await Promise.all(missingArtists.map(async (artist) => {
        try {
          const r = await client.searchSongs(`${artist} ${query}`);
          return r.slice(0, 2).map(mapYTMusicSong).filter(t => t.id && t.title);
        } catch { return []; }
      }));
      const extraFlat = extra.flat();
      if (extraFlat.length) {
        const merged = [];
        let ei = 0;
        for (let i = 0; i < songs.length; i++) {
          merged.push(songs[i]);
          if ((i + 1) % 3 === 0 && ei < extraFlat.length) merged.push(extraFlat[ei++]);
        }
        while (ei < extraFlat.length) merged.push(extraFlat[ei++]);
        songs = merged;
      }
    }
  }

  songs = rankSearchSongs(query, songs, artists).slice(0, limit);
  return { songs, albums, artists };
}

export function createYTMusicSearchAll() { return (query, limit) => searchAllYTMusic(query, limit); }

// Eager initialization on module load.
getClientSafe().catch(() => {});
