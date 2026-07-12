// ═══════════════════════════════════════════════════════════════
// Catálogo dinámico — caché en memoria + persistencia local de metadata.
// El backend solo guarda IDs; aquí conservamos los metadatos para render.
// ═══════════════════════════════════════════════════════════════
import { api } from './api.js';
import { FALLBACK_COVER } from './constants.js';

const _catalog = new Map();

const hasCover = (c) => !!c && c !== FALLBACK_COVER;
const isDataUrl = (c) => typeof c === 'string' && c.startsWith('data:');
// Miniaturas de video de YouTube (i.ytimg.com/hqdefault/mqdefault/maxresdefault)
// son captures del video, NO artwork oficial del album. Preferimos siempre la
// portada canonica del album (lh3/yt3.googleusercontent) sobre estos thumbs.
const isVideoThumb = (c) => typeof c === 'string' && c.includes('i.ytimg.com');
export function cacheTrack(t) {
  if (t && t.id) {
    const prev = _catalog.get(t.id);
    if (prev) {
      // Prioridad de carátula (mayor → menor):
      //   data: URL (offline IDB) > HTTPS album cover > HTTPS video thumb > vacío.
      // 1. Entrante data: siempre gana a HTTPS/vacío (offline IDB).
      if (isDataUrl(t.cover)) {
        // keep t.cover
      } else if (isDataUrl(prev.cover) && !isDataUrl(t.cover)) {
        // 2. No degradar data: offline a HTTPS remota.
        t = { ...t, cover: prev.cover };
      } else if (hasCover(prev.cover) && !hasCover(t.cover)) {
        // 3. Nunca degradar una carátula real ya conocida a vacío.
        t = { ...t, cover: prev.cover };
      } else if (hasCover(prev.cover) && !isVideoThumb(prev.cover) && isVideoThumb(t.cover)) {
        // 4. Bug 1 regresion: no degradar portada de album (lh3/yt3.googleusercontent)
        //    a thumbnail de video (i.ytimg.com). El feed/radio a veces cachea
        //    tracks con video thumbs y pisaban la portada del album que el
        //    usuario vio al abrir el album.
        t = { ...t, cover: prev.cover };
      }
    }
    _catalog.set(t.id, t);
  }
  return t;
}

/** Mejor carátula conocida para un id (prioriza data: de IDB/catálogo). */
export function bestCoverFor(id, fallback) {
  const c = trackById(id);
  if (c && hasCover(c.cover)) return c.cover;
  if (fallback && hasCover(fallback)) return fallback;
  return (c && c.cover) || fallback || '';
}
export function cacheTracks(arr) { (arr || []).forEach(cacheTrack); return arr || []; }
export const trackById = (id) => _catalog.get(id) || null;
export const allCached = () => [..._catalog.values()];

export function loadMeta() {
  try { const s = localStorage.getItem('velocity.meta'); if (s) JSON.parse(s).forEach(cacheTrack); } catch {}
}

// Estado del reproductor persistido (última pista + cola + posición), como Spotify.
export function loadPlayerState() {
  try {
    const s = JSON.parse(localStorage.getItem('velocity.player') || 'null');
    if (s && s.track && s.track.id) { cacheTrack(s.track); return s; }
    if (s && s.trackId) { const t = trackById(s.trackId); if (t) return { ...s, track: t }; }
  } catch {}
  return null;
}

export function saveMeta() {
  try {
    // No persistir carátulas pesadas (data:/blob:) en localStorage: rebasarían
    // la cuota. Las descargadas se rehidratan desde IndexedDB en cada arranque.
    const arr = [..._catalog.values()].slice(-500).map(t =>
      (t && typeof t.cover === 'string' && (t.cover.startsWith('data:') || t.cover.startsWith('blob:')))
        ? { ...t, cover: '' } : t
    );
    localStorage.setItem('velocity.meta', JSON.stringify(arr));
  } catch {}
}

// Invalidación de caché: si subimos la versión, descartamos metadata/feed viejos
// (p.ej. pistas de radio cacheadas sin carátula por un bug previo) una sola vez.
// v11: multi-mix por sección + fix miniplayer store mirror.
const CACHE_VERSION = '11';
try {
  if (localStorage.getItem('velocity.cacheVer') !== CACHE_VERSION) {
    localStorage.removeItem('velocity.meta');
    localStorage.removeItem('velocity.home');
    localStorage.setItem('velocity.cacheVer', CACHE_VERSION);
  }
} catch {}
loadMeta();

// Normaliza un TrackMetadata del backend a la forma del frontend (con url de streaming).
export function normalizeTrack(t) {
  const n = {
    id: t.id,
    title: t.title || 'Sin título',
    artist: t.artist || 'Desconocido',
    artistId: t.artistId || null,
    album: t.album || 'Sencillo',
    albumId: t.albumId || null,
    genre: t.genre || '',
    // Sin artwork → cadena vacía (CoverImg muestra el fallback al renderizar).
    // No usar FALLBACK_COVER aquí: es un data: URL que saveMeta borra a '',
    // dejando pistas sin carátula tras persistir.
    cover: t.artworkUrl || t.cover || '',
    durationSeconds: t.durationSeconds || t.duration || 0,
    // MusicBrainz enrichment (campo opcional, fresco desde el backend).
    // null/undefined no rompen el catálogo; se preserva cuando llega.
    mbid: t.mbid || null,
  };
  n.url = api.streamUrl({
    artist: n.artist, title: n.title, id: n.id,
    // SoundCloud: pasar la URL directa para evitar la resolución con yt-dlp.
    stream: (t.source === 'soundcloud' && t.streamUrl) ? t.streamUrl : undefined,
  });
  if (t.source) n.source = t.source;
  return cacheTrack(n);
}
