// ═══════════════════════════════════════════════════════════════
// Catálogo dinámico — caché en memoria + persistencia local de metadata.
// El backend solo guarda IDs; aquí conservamos los metadatos para render.
// ═══════════════════════════════════════════════════════════════
import { api } from './api.js';
import { FALLBACK_COVER } from './constants.js';

const _catalog = new Map();

const hasCover = (c) => !!c && c !== FALLBACK_COVER;
export function cacheTrack(t) {
  if (t && t.id) {
    const prev = _catalog.get(t.id);
    // Nunca degradar una carátula real ya conocida a vacío: la misma pista puede
    // llegar con artwork desde búsqueda y sin él desde radio; conservamos la buena.
    if (prev && hasCover(prev.cover) && !hasCover(t.cover)) t = { ...t, cover: prev.cover };
    _catalog.set(t.id, t);
  }
  return t;
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
const CACHE_VERSION = '7';
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
  };
  n.url = api.streamUrl({
    artist: n.artist, title: n.title, id: n.id,
    // SoundCloud: pasar la URL directa para evitar la resolución con yt-dlp.
    stream: (t.source === 'soundcloud' && t.streamUrl) ? t.streamUrl : undefined,
  });
  if (t.source) n.source = t.source;
  return cacheTrack(n);
}
