/**
 * Emparejado de letras (lrclib / fuentes externas).
 * Evita devolver la letra de otra canción cuando la búsqueda es ambigua.
 */

import { normalizeText } from './normalize.js';

/** Limpia sufijos promocionales del título para comparar. */
export function cleanLyricQuery(s) {
  return String(s ?? '')
    .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|remaster|live|radio\s*edit|feat\.?|ft\.?|cover|instrumental|karaoke|remix)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[-–|]\s*(official|lyric|audio|video).*$/i, '')
    .trim();
}

function tokens(s) {
  return normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function tokenOverlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

/**
 * Puntuación de un candidato de lrclib (u otra API) frente a artist/title/duration.
 * 0 = rechazar. Umbral recomendado: ≥ 55.
 */
export function scoreLyricsCandidate({ artist, title, duration }, candidate) {
  if (!candidate) return 0;
  const wantArtist = normalizeText(artist);
  const wantTitle = normalizeText(cleanLyricQuery(title));
  const gotArtist = normalizeText(
    candidate.artistName || candidate.artist || candidate.artist_name || ''
  );
  const gotTitle = normalizeText(
    cleanLyricQuery(candidate.trackName || candidate.name || candidate.track_name || '')
  );

  if (!wantTitle || !gotTitle) return 0;

  let score = 0;

  // ── Título ──
  if (gotTitle === wantTitle) score += 50;
  else if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) score += 28;
  else {
    const ov = tokenOverlap(wantTitle, gotTitle);
    if (ov < 0.35) return 0; // sin solape de título → otra canción
    score += Math.round(ov * 40);
  }

  // ── Artista ──
  if (gotArtist && wantArtist) {
    if (gotArtist === wantArtist) score += 40;
    else if (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist)) score += 28;
    else if (
      gotArtist
        .split(/[,&/]/)
        .map((p) => normalizeText(p))
        .some((p) => p === wantArtist || p.startsWith(wantArtist + ' ') || wantArtist.startsWith(p + ' '))
    ) {
      score += 32;
    } else {
      const ov = tokenOverlap(wantArtist, gotArtist);
      if (ov < 0.25) score -= 35; // artista distinto
      else score += Math.round(ov * 25);
    }
  } else if (!gotArtist) {
    score -= 10;
  }

  // ── Duración ──
  const wantDur = Number(duration);
  const gotDur = Number(candidate.duration ?? candidate.durationSeconds);
  if (Number.isFinite(wantDur) && wantDur > 0 && Number.isFinite(gotDur) && gotDur > 0) {
    const d = Math.abs(wantDur - gotDur);
    if (d <= 2) score += 18;
    else if (d <= 5) score += 10;
    else if (d <= 12) score += 3;
    else if (d <= 25) score -= 8;
    else score -= 25;
  }

  if (candidate.syncedLyrics || candidate.synced) score += 4;
  return score;
}

/**
 * Elige el mejor candidato de una lista. Devuelve null si ninguno supera minScore.
 */
export function pickBestLyricsCandidate(query, candidates, minScore = 55) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreLyricsCandidate(query, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore < minScore) return null;
  return { candidate: best, score: bestScore };
}

/** Texto plano a partir de LRC (sin timestamps). */
export function plainFromSynced(synced) {
  if (!synced) return '';
  return String(synced)
    .replace(/\[\d+:\d+(?:\.\d+)?\]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Ratio de solape de palabras entre dos textos de letra (0–1).
 * Sirve para no sustituir una letra correcta (p.ej. YT Music) por otra errónea de lrclib.
 */
export function lyricsOverlapRatio(a, b) {
  const A = new Set(tokens(String(a || '').slice(0, 4000)));
  const B = new Set(tokens(String(b || '').slice(0, 4000)));
  if (A.size < 4 || B.size < 4) return 1; // textos muy cortos: no bloquear
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/** ¿Coincide el artista del resultado con el del perfil/búsqueda? */
export function artistNameMatches(songArtist, profileName) {
  const key = normalizeText(profileName || '');
  if (!key) return true;
  const al = normalizeText(songArtist || '');
  if (!al) return false;
  if (al === key) return true;
  if (al.startsWith(key + ' ') || key.startsWith(al + ' ')) return true;
  // "A, B" o "A & B" o "A feat. B"
  const parts = al.split(/\s*(?:,|&|\/|feat\.?|ft\.?)\s*/i).map((p) => normalizeText(p)).filter(Boolean);
  if (parts.some((p) => p === key || p.startsWith(key + ' ') || key.startsWith(p + ' '))) return true;
  // solape fuerte de tokens (System of a Down ≈ System Of A Down)
  return tokenOverlap(key, al) >= 0.75;
}
