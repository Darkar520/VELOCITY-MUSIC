/**
 * searchRanking.js — política PURA de relevancia para resultados de búsqueda.
 *
 * Por qué existe: el backend (ytmusic.rankSearchSongs) ya ordena por relevancia
 * de texto, pero ante duplicados con el MISMO título+artista (típicamente la
 * versión de álbum/audio oficial y el video musical) el empate se rompe por el
 * orden de YouTube. `dedupeByTitle` conserva el PRIMERO, así que si YouTube
 * devuelve el video antes, gana la miniatura de video en lugar de la portada del
 * álbum.
 *
 * Este módulo puntúa cada pista y, al deduplicar, conserva el MEJOR duplicado
 * (no el primero), priorizando: match de título/artista con la consulta, y las
 * señales de "versión de álbum" (albumId presente, portada que NO es un thumb de
 * video) sobre las de "video" (i.ytimg.com).
 *
 * Se aplica SOLO en la lista de canciones de la búsqueda (SearchTab). El contrato
 * de dedupeByTitle se conserva intacto para el resto de call sites.
 */
import { isYouTubeVideoThumb } from './coverEnrich.js';

function normText(s) { return (s || '').toLowerCase().trim(); }
// Igual que dedupeByTitle: título sin el sufijo entre paréntesis/corchetes.
function normTitle(s) { return (s || '').toLowerCase().replace(/\s*[([].*$/, '').trim(); }

/** Clave de deduplicación: misma semántica que helpers.dedupeByTitle. */
export function dedupeKey(t) {
  return `${normText(t && t.artist)}|${normTitle(t && t.title)}`;
}

/**
 * Puntúa una pista frente a la consulta normalizada `nq`.
 * Señales aditivas; mayor puntuación = más relevante / mejor versión.
 */
export function scoreTrack(nq, t) {
  if (!t) return -Infinity;
  let sc = 0;
  const title = normTitle(t.title);
  const artist = normText(t.artist);

  if (nq) {
    if (title === nq) sc += 100;
    else if (title.startsWith(nq) || nq.startsWith(title)) sc += 70;
    else if (title.includes(nq) || nq.includes(title)) sc += 45;
    else {
      const q = new Set(nq.split(/\s+/).filter((w) => w.length > 1));
      const tt = title.split(/\s+/).filter((w) => w.length > 1);
      sc += tt.filter((w) => q.has(w)).length * 10;
    }
    if (artist === nq) sc += 40;
    else if (artist && (artist.includes(nq) || nq.includes(artist))) sc += 20;
  }

  // Versión de álbum / audio oficial vs. video.
  if (t.albumId) sc += 15;
  if (t.album && t.album !== 'Sencillo') sc += 5;
  const cover = t.cover || '';
  if (cover && !isYouTubeVideoThumb(cover)) sc += 20;
  else if (isYouTubeVideoThumb(cover)) sc -= 10;

  return sc;
}

/**
 * Deduplica por título+artista conservando el MEJOR duplicado y ordena el
 * resultado por relevancia (desc), con desempate estable por el orden original
 * (preserva el ranking de relevancia del backend cuando las puntuaciones empatan).
 *
 * @param {string} query consulta del usuario
 * @param {Array<object>} tracks pistas ya normalizadas (normalizeTrack)
 * @returns {Array<object>}
 */
export function dedupeByRelevance(query, tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return [];
  const nq = normText(query);
  const best = new Map(); // key -> { track, score, idx }
  tracks.forEach((t, idx) => {
    const key = dedupeKey(t);
    const score = scoreTrack(nq, t);
    const cur = best.get(key);
    if (!cur || score > cur.score) best.set(key, { track: t, score, idx });
  });
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((x) => x.track);
}
