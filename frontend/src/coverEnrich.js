/**
 * coverEnrich.js — Enriquecimiento de carátulas vía iTunes Search API.
 *
 * Problema: las pistas resueltas desde YouTube suelen tener miniaturas de video
 * (i.ytimg.com) en lugar de portadas de álbum. iTunes Search API es gratuita,
 * no requiere autenticación, y devuelve artwork oficial de alta resolución.
 *
 * Estrategia:
 *  1. Si el cover ya es una portada de calidad (no ytimg), no hacer nada.
 *  2. Si es un thumbnail de YouTube (i.ytimg.com), buscar en iTunes por
 *     "artist title" y usar la primera respuesta con artworkUrl100 → 600.
 *  3. Cachear resultado (éxito o "no encontrado") para no repetir la búsqueda.
 *  4. Non-blocking: nunca retrasar la reproducción. Se llama en background.
 *
 * Límites:
 *  - iTunes Search: ~20 req/min en condiciones normales. Aquí solo se llama
 *    cuando el cover es un ytimg (poco frecuente una vez que el caché está caliente).
 *  - Solo se intenta una vez por (artist+title). Si falla, se marca como
 *    "intentado" para no volver a gastar la cuota.
 */

/** Detecta si una URL es un thumbnail genérico de video de YouTube. */
export function isYouTubeVideoThumb(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('i.ytimg.com') || url.includes('/vi/') || url.includes('/vi_webp/');
}

// Caché en memoria: key = "artist\0title", value = URL string | null
const _enrichCache = new Map();
// En curso (deduplica concurrencias)
const _enrichInFlight = new Map();

/**
 * Eleva el artwork de iTunes de 100px a un tamaño usable.
 * iTunes devuelve URLs del tipo: ...100x100bb.jpg
 * Sustituimos por 600x600bb.jpg (máximo que devuelven sin escalar).
 */
function upscaleItunesArtwork(url) {
  if (!url) return url;
  return url.replace(/\d+x\d+bb\.(jpg|png)/i, '600x600bb.$1');
}

/**
 * Busca en iTunes Search API la mejor carátula para artist+title.
 * Retorna la URL de artwork (600px) o null si no se encontró nada útil.
 */
async function fetchItunesCover(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const url = `https://itunes.apple.com/search?term=${q}&entity=song&limit=5&media=music`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    // Priorizar resultado cuyo artistName o trackName coincida más con el buscado
    const aLow = (artist || '').toLowerCase();
    const tLow = (title || '').toLowerCase();
    const ranked = results
      .filter((r) => r.artworkUrl100)
      .map((r) => {
        const ra = (r.artistName || '').toLowerCase();
        const rt = (r.trackName || '').toLowerCase();
        const score =
          (ra.includes(aLow) || aLow.includes(ra) ? 2 : 0) +
          (rt.includes(tLow) || tLow.includes(rt) ? 2 : 0);
        return { score, url: upscaleItunesArtwork(r.artworkUrl100) };
      })
      .sort((a, b) => b.score - a.score);
    return ranked.length ? ranked[0].url : null;
  } catch {
    return null;
  }
}

/**
 * Enriquece la carátula de una pista si es un thumbnail de YouTube.
 * Non-blocking: retorna inmediatamente, actualiza el catálogo y llama a
 * `onUpdate(trackId, newCoverUrl)` cuando termine (si encuentra algo mejor).
 *
 * @param {{ id: string, artist: string, title: string, cover: string }} track
 * @param {(id: string, coverUrl: string) => void} onUpdate
 */
export function enrichCoverIfNeeded(track, onUpdate) {
  if (!track || !track.id || !track.artist || !track.title) return;
  if (!isYouTubeVideoThumb(track.cover)) return;

  const key = `${(track.artist || '').toLowerCase()}\0${(track.title || '').toLowerCase()}`;

  // Ya tenemos resultado cacheado
  if (_enrichCache.has(key)) {
    const cached = _enrichCache.get(key);
    if (cached && typeof onUpdate === 'function') {
      onUpdate(track.id, cached);
    }
    return;
  }

  // Ya está en vuelo
  if (_enrichInFlight.has(key)) {
    _enrichInFlight.get(key).then((url) => {
      if (url && typeof onUpdate === 'function') onUpdate(track.id, url);
    });
    return;
  }

  // Nueva búsqueda
  const p = fetchItunesCover(track.artist, track.title).then((url) => {
    _enrichCache.set(key, url || null);
    _enrichInFlight.delete(key);
    if (url && typeof onUpdate === 'function') onUpdate(track.id, url);
    return url;
  }).catch(() => {
    _enrichCache.set(key, null);
    _enrichInFlight.delete(key);
    return null;
  });

  _enrichInFlight.set(key, p);

  // Limpiar caché si crece demasiado (sesiones largas)
  if (_enrichCache.size > 500) {
    const oldest = _enrichCache.keys().next().value;
    _enrichCache.delete(oldest);
  }
}

/**
 * Enriquece un array de pistas en background.
 * Útil después de normalizar resultados de búsqueda o del feed.
 * El callback se llama una vez por pista enriquecida (no en batch).
 *
 * @param {Array<{id:string, artist:string, title:string, cover:string}>} tracks
 * @param {(id: string, coverUrl: string) => void} onUpdate
 * @param {{ maxConcurrent?: number }} [opts]
 */
export function enrichTracksInBackground(tracks, onUpdate, opts = {}) {
  if (!tracks || !tracks.length) return;
  const candidates = tracks.filter((t) => t && t.id && isYouTubeVideoThumb(t.cover));
  if (!candidates.length) return;
  // Escalonar para no saturar la cuota de iTunes (~20 req/min)
  const maxConcurrent = opts.maxConcurrent || 3;
  let i = 0;
  const run = () => {
    if (i >= candidates.length) return;
    const t = candidates[i++];
    enrichCoverIfNeeded(t, onUpdate);
    // Espaciar las peticiones
    if (i < candidates.length) {
      setTimeout(run, 300);
    }
  };
  // Arrancar hasta maxConcurrent en paralelo
  for (let j = 0; j < Math.min(maxConcurrent, candidates.length); j++) {
    run();
  }
}
