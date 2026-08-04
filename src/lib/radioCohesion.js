/**
 * Radio cohesion core — pure, network-free logic for genre/artist-coherent radio.
 *
 * Feature: radio-genre-cohesion.
 *
 * Este módulo NO importa ytmusic-api ni realiza llamadas de red. Recibe
 * candidatas ya obtenidas (con `graphDistance` anotada) y un `Seed_Profile`, y
 * produce la lista de radio final aplicando clasificación, cuotas, orden y
 * deduplicación. Al ser puro y determinista, todas las propiedades de
 * correctness (Requisito 10) se verifican sin tocar la red.
 *
 * Reutiliza normalizeText (lib/normalize.js) y artistNameMatches
 * (lib/lyricsMatch.js); no reimplementa normalización.
 */
import { normalizeText } from './normalize.js';
import { artistNameMatches } from './lyricsMatch.js';

/** Constantes configurables (Req 1, 2, 3, 4, 5, 6, 9). */
export const RADIO_CONFIG = Object.freeze({
  COHESION_MIN: 0.80,             // Req 1.1, 1.2
  OFF_PROFILE_MAX: 0.20,          // Req 3.3
  MAINSTREAM_MIN: 0.70,           // Req 4.3
  MAX_GRAPH_DISTANCE: 2,          // Req 3.1
  TARGET_QUEUE_LENGTH: 40,        // Req 6.1
  WINDOW_SIZE: 20,                // Req 1.2
  MAX_PER_ARTIST: 5,              // Req 5.1 (entero 1–20)
  MAX_CONSECUTIVE_SAME_ARTIST: 3, // Req 5.2
  MAX_CONSECUTIVE_OFF_PROFILE: 2, // Req 3.4
  MAX_NEIGHBORS: 25,              // Req 2.1
  EXPANSION_SEEDS_PER_ROUND: 10,  // Req 9.3 (entero 1–50)
  RELEVANCE_TIE_RATIO: 0.10,      // Req 2.4
});

// ───────────────────────────────────────────────────────────────
// Primitivas de saneamiento de lista (puras)
// ───────────────────────────────────────────────────────────────

/** Dedup por id, conserva la primera aparición. (Req 10.6) */
export function dedupeById(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of asArray(candidates)) {
    const id = c && c.id != null ? String(c.id) : null;
    if (id === null) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}

/** Dedup por título normalizado (insensible a mayúsc./espacios/acentos). (Req 5.5) */
export function dedupeByTitleNorm(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of asArray(candidates)) {
    const key = normalizeText(c && c.title);
    if (!key) { out.push(c); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Filtro anti-SoundCloud puro: descarta source soundcloud o stream/streamUrl directo. (Req 8.2, 8.3) */
export function excludeSoundCloud(candidates) {
  return asArray(candidates).filter((c) => {
    if (!c) return false;
    if (String(c.source || '').toLowerCase() === 'soundcloud') return false;
    if (typeof c.stream === 'string' && c.stream) return false;
    if (typeof c.streamUrl === 'string' && c.streamUrl) return false;
    return true;
  });
}

/** Descarta candidatas con graphDistance > max. (Req 3.1, 10.3) */
export function filterByGraphDistance(candidates, max) {
  const limit = Number.isFinite(max) ? max : RADIO_CONFIG.MAX_GRAPH_DISTANCE;
  return asArray(candidates).filter((c) => {
    const d = Number(c && c.graphDistance);
    return Number.isFinite(d) && d <= limit;
  });
}

/** Cohesion_Ratio de una lista: In_Profile / total (0 si vacía). (Req 1, 10.1) */
export function cohesionRatio(candidates) {
  const list = asArray(candidates);
  if (list.length === 0) return 0;
  const inProfile = list.filter((c) => c && c.inProfile === true).length;
  return inProfile / list.length;
}

// ───────────────────────────────────────────────────────────────
// Neighbor_Artist_Set (Req 2.1, 2.5, 7.1)
// ───────────────────────────────────────────────────────────────

/**
 * Construye el Neighbor_Artist_Set: artista de la semilla + relacionados,
 * ordenados por relevancia descendente, dedup por nombre normalizado, tope
 * MAX_NEIGHBORS. Siempre incluye al artista de la semilla (isSeed=true).
 *
 * @param {{id?:string,name:string}} seedArtist
 * @param {Array<{id?:string,name:string,relevance?:number}>} relatedArtists
 * @param {object} [config=RADIO_CONFIG]
 * @returns {Array<{id:string|null,name:string,nameNorm:string,relevance:number,isSeed:boolean}>}
 */
export function buildNeighborArtistSet(seedArtist, relatedArtists, config = RADIO_CONFIG) {
  const cap = clampInt(config.MAX_NEIGHBORS, 1, 100, RADIO_CONFIG.MAX_NEIGHBORS);
  const byNorm = new Map();

  const seedName = seedArtist && seedArtist.name ? String(seedArtist.name) : '';
  const seedNorm = normalizeText(seedName);
  if (seedNorm) {
    byNorm.set(seedNorm, {
      id: seedArtist.id != null ? String(seedArtist.id) : null,
      name: seedName,
      nameNorm: seedNorm,
      relevance: 1,
      isSeed: true,
    });
  }

  const related = asArray(relatedArtists);
  // Relevancia por defecto decreciente según la posición si no viene explícita.
  related.forEach((a, i) => {
    const name = a && a.name ? String(a.name) : '';
    const norm = normalizeText(name);
    if (!norm) return;
    if (byNorm.has(norm)) return; // la semilla u otro ya ocupa este nombre
    const rel = Number.isFinite(a.relevance)
      ? clampNum(a.relevance, 0, 0.999)
      : Math.max(0, 0.95 - i * (0.9 / Math.max(1, related.length)));
    byNorm.set(norm, {
      id: a.id != null ? String(a.id) : null,
      name,
      nameNorm: norm,
      relevance: rel,
      isSeed: false,
    });
  });

  const list = [...byNorm.values()].sort((x, y) => {
    if (y.relevance !== x.relevance) return y.relevance - x.relevance;
    // El artista semilla siempre primero ante empate.
    if (x.isSeed !== y.isSeed) return x.isSeed ? -1 : 1;
    return 0;
  });
  return list.slice(0, cap);
}

// ───────────────────────────────────────────────────────────────
// Clasificación y scoring (Req 2, 4)
// ───────────────────────────────────────────────────────────────

/**
 * Clasifica una candidata contra el Seed_Profile.
 *  - inProfile: artista ∈ Neighbor_Artist_Set (artistNameMatches) O género
 *    coincide con el de la semilla (cuando conocido) con artista distinto.
 *  - mainstream: candidate.id ∈ seedProfile.mainstreamIds o señal de popularidad.
 * (Req 2.2, 2.3, 4.1, 4.2, 7.2)
 * @returns {{inProfile:boolean, mainstream:boolean}}
 */
export function classifyCandidate(seedProfile, candidate) {
  const sp = seedProfile || {};
  const neighbors = asArray(sp.neighbors);
  const artist = candidate ? candidate.artist : '';

  let inProfile = false;
  for (const n of neighbors) {
    if (artistNameMatches(artist, n.name)) { inProfile = true; break; }
  }
  if (!inProfile && sp.hasGenre && candidate && candidate.genre) {
    const g = normalizeText(candidate.genre);
    if (g && g === normalizeText(sp.genre) && normalizeText(artist) !== sp.artistNorm) {
      inProfile = true;
    }
  }

  let mainstream = false;
  const id = candidate && candidate.id != null ? String(candidate.id) : null;
  if (id && sp.mainstreamIds instanceof Set && sp.mainstreamIds.has(id)) mainstream = true;
  else if (candidate && candidate.mainstream === true) mainstream = true;

  return { inProfile, mainstream };
}

/**
 * Puntúa la relevancia de una candidata (mayor = más cercana al perfil).
 * Señales: coincidencia con artista semilla, pertenencia al vecindario ponderada
 * por relevancia del vecino, coincidencia de género, penalización por
 * graphDistance, bonus mainstream. (Req 2.4, 4.6)
 */
export function scoreCandidate(seedProfile, candidate) {
  const sp = seedProfile || {};
  const neighbors = asArray(sp.neighbors);
  const artist = candidate ? candidate.artist : '';
  let score = 0;

  // Pertenencia al vecindario ponderada por la relevancia del vecino coincidente.
  let bestNeighborRel = 0;
  let isSeedArtist = false;
  for (const n of neighbors) {
    if (artistNameMatches(artist, n.name)) {
      if (n.relevance > bestNeighborRel) bestNeighborRel = n.relevance;
      if (n.isSeed) isSeedArtist = true;
    }
  }
  if (bestNeighborRel > 0) score += 100 + bestNeighborRel * 60; // término aditivo por vecindario (Req 2.4)
  if (isSeedArtist) score += 40;                                // el artista de la semilla pesa más

  // Coincidencia de género (señal secundaria).
  if (sp.hasGenre && candidate && candidate.genre
    && normalizeText(candidate.genre) === normalizeText(sp.genre)) {
    score += 25;
  }

  // Bonus mainstream (ordena Mainstream antes que Discovery ante igual perfil, Req 4.6).
  if (candidate && candidate.mainstream === true) score += 15;

  // Preferir versión de estudio: la radio de una canción de estudio no debería
  // derivar hacia directos/remixes/acústicos salvo por falta de alternativas.
  if (isLiveOrRemixVersion(candidate && candidate.title)) score -= 30;

  // Penalización por distancia de grafo (más lejos = menos relevante, Req 3).
  const d = Number(candidate && candidate.graphDistance);
  if (Number.isFinite(d)) score -= d * 8;

  return score;
}

// Detecta títulos que NO son la versión de estudio (directo, remix, acústico…).
const LIVE_REMIX_RE = /\b(live|en\s+vivo|en\s+directo|remix|remaster(?:ed)?|acoustic|ac[uú]stico|unplugged|session|sped[\s-]?up|slowed|karaoke|instrumental|demo)\b/i;

/** true si el título parece una versión no-estudio (directo/remix/acústico/etc.). */
export function isLiveOrRemixVersion(title) {
  return typeof title === 'string' && LIVE_REMIX_RE.test(title);
}

// ───────────────────────────────────────────────────────────────
// Cuotas, diversidad e intercalado (Req 1, 3, 4, 5)
// ───────────────────────────────────────────────────────────────

/** Máx MAX_PER_ARTIST pistas por artista, conserva el orden de entrada. (Req 5.1, 10.4) */
export function capPerArtistList(candidates, max) {
  const cap = clampInt(max, 1, 20, RADIO_CONFIG.MAX_PER_ARTIST);
  const counts = new Map();
  const out = [];
  for (const c of asArray(candidates)) {
    const key = normalizeText(c && c.artist) || '\u0000unknown';
    const n = counts.get(key) || 0;
    if (n >= cap) continue;
    counts.set(key, n + 1);
    out.push(c);
  }
  return out;
}

/**
 * Aplica cuotas globales sobre candidatas ya clasificadas y ORDENADAS por score,
 * devolviendo el conjunto máximo factible que satisface simultáneamente:
 *  - descarta Off_Profile con graphDistance > 0 (Req 3.2)
 *  - descarta Discovery que no sea In_Profile (Req 4.5)
 *  - Off_Profile ≤ OFF_PROFILE_MAX del total (Req 3.3 ⇒ Cohesion ≥ COHESION_MIN, Req 1.1)
 *  - Mainstream ≥ MAINSTREAM_MIN cuando hay stock; si falta, incluye todas las
 *    Mainstream disponibles como mejor esfuerzo (Req 4.3, 4.4)
 * No trunca por límite de cola (usa el total disponible como tope).
 * @returns {Candidate[]}
 */
export function enforceQuotas(candidates, config = RADIO_CONFIG) {
  const list = asArray(candidates);
  return selectWithQuotas(list, list.length, config);
}

/**
 * Selección con cuotas y tope de tamaño `cap`. Elige el mayor N ≤ cap tal que
 * existan conteos (a=inMain, d=inDisc, o=off) con:
 *   a+d+o = N,  o ≤ floor(OFF_PROFILE_MAX·N),  d ≤ floor((1-MAINSTREAM_MIN)·N)
 * Toma los de mayor score de cada categoría (ya vienen ordenados). Si con el
 * mínimo de mainstream no hay solución pero sí existen In_Profile, reintenta con
 * MAINSTREAM_MIN=0 (mejor esfuerzo, Req 4.4) preservando la cohesión.
 * @param {Candidate[]} candidates  ya clasificadas y ordenadas por score desc
 * @param {number} cap
 * @param {object} config
 * @returns {Candidate[]}
 */
function selectWithQuotas(candidates, cap, config = RADIO_CONFIG) {
  const offMax = clampNum(config.OFF_PROFILE_MAX, 0, 0.99);
  const mainMin = clampNum(config.MAINSTREAM_MIN, 0, 1);

  const kept = asArray(candidates).filter((c) => {
    if (!c) return false;
    const d = Number(c.graphDistance);
    if (c.inProfile !== true && Number.isFinite(d) && d > 0) return false; // Req 3.2
    if (c.mainstream !== true && c.inProfile !== true) return false;       // Req 4.5
    return true;
  });

  const inMain = kept.filter((c) => c.inProfile && c.mainstream);
  const inDisc = kept.filter((c) => c.inProfile && !c.mainstream);
  const off = kept.filter((c) => !c.inProfile); // mainstream && graphDistance 0

  const target = Math.min(cap, kept.length);
  const mainstreamInsufficient = mainMin > 0
    && inMain.length < Math.ceil(mainMin * target);
  if (mainstreamInsufficient && (inMain.length + inDisc.length) > 0) {
    // El catálogo no tiene suficiente mainstream para alcanzar el mínimo:
    // priorizar todas las señales mainstream y completar con Discovery In_Profile
    // en lugar de acortar artificialmente la radio.
    const relaxed = pickCounts(inMain.length, inDisc.length, off.length, cap, offMax, 0);
    if (relaxed) return assemblePicked(inMain, inDisc, off, relaxed);
  }

  const picked = pickCounts(inMain.length, inDisc.length, off.length, cap, offMax, mainMin);
  if (!picked && (inMain.length + inDisc.length) > 0 && mainMin > 0) {
    // Sin stock de mainstream suficiente: mejor esfuerzo sin mínimo mainstream
    // (Property 13 condicionada al stock), conservando la cohesión.
    const relaxed = pickCounts(inMain.length, inDisc.length, off.length, cap, offMax, 0);
    if (relaxed) return assemblePicked(inMain, inDisc, off, relaxed);
  }
  if (!picked) return [];
  return assemblePicked(inMain, inDisc, off, picked);
}

function assemblePicked(inMain, inDisc, off, { a, d, o }) {
  return sortByScoreDesc([
    ...inMain.slice(0, a),
    ...inDisc.slice(0, d),
    ...off.slice(0, o),
  ]);
}

/**
 * Calcula (a,d,o) maximizando N ≤ cap y, dentro de N, maximizando mainstream
 * (minimizando discovery y off). Devuelve null si no hay N ≥ 1 factible.
 */
function pickCounts(A, B, C, cap, offMax, mainMin) {
  const maxN = Math.min(cap, A + B + C);
  for (let N = maxN; N >= 1; N--) {
    const oCap = Math.min(C, Math.floor(offMax * N));
    const dCap = Math.min(B, mainMin >= 1 ? 0 : Math.floor((1 - mainMin) * N));
    // off+disc necesarios: al menos N-A (si faltan inMain), a lo sumo oCap+dCap.
    const minOD = Math.max(0, N - A);
    const maxOD = oCap + dCap;
    if (minOD > maxOD || minOD > N) continue;
    // Usar el mínimo de off+disc para maximizar inMain; dentro de ese mínimo,
    // preferir off (mainstream) sobre discovery para maximizar mainstream.
    let od = minOD;
    let o = Math.min(oCap, od);
    let d = od - o;
    if (d > dCap) { d = dCap; o = od - d; }
    if (o < 0 || o > oCap || d < 0 || d > dCap) continue;
    const a = N - o - d;
    if (a < 0 || a > A) continue;
    return { a, d, o };
  }
  return null;
}

/**
 * Reordena sin cambiar el conjunto para respetar simultáneamente:
 *  - cohesión por ventana deslizante ≥ COHESION_MIN (Req 1.2): las Off_Profile se
 *    distribuyen de forma pareja, de modo que cualquier ventana de WINDOW_SIZE
 *    contenga a lo sumo floor((1-COHESION_MIN)·WINDOW_SIZE) Off_Profile.
 *  - máx MAX_CONSECUTIVE_OFF_PROFILE Off_Profile seguidas (Req 3.4) — implícito en
 *    la distribución pareja (con Off ≤ 20% el hueco entre Off es ≥ 4).
 *  - máx MAX_CONSECUTIVE_SAME_ARTIST del mismo artista seguidas (Req 5.2): las
 *    In_Profile se colocan por round-robin de artista.
 *  - Mainstream antes que Discovery ante igual pertenencia (Req 4.6, vía score).
 */
export function interleave(candidates, config = RADIO_CONFIG) {
  const maxArt = clampInt(config.MAX_CONSECUTIVE_SAME_ARTIST, 1, 50, RADIO_CONFIG.MAX_CONSECUTIVE_SAME_ARTIST);
  const ordered = sortByScoreDesc(asArray(candidates).slice());
  const inProfile = ordered.filter((c) => c.inProfile === true);
  const off = ordered.filter((c) => c.inProfile !== true);

  const seqIn = arrangeByArtistRoundRobin(inProfile, maxArt);
  if (off.length === 0) return seqIn;

  // Distribución pareja de Off entre las In_Profile (evita clústeres → cohesión
  // por ventana). En cada posición k, se coloca una Off si su cuota acumulada
  // (oi+1)/total ≤ proporción esperada (k+1)·m/total.
  const n = seqIn.length;
  const m = off.length;
  const total = n + m;
  const out = [];
  let ai = 0;
  let oi = 0;
  for (let k = 0; k < total; k++) {
    const takeOff = oi < m && (ai >= n || (oi + 1) * total <= (k + 1) * m);
    if (takeOff) out.push(off[oi++]);
    else out.push(seqIn[ai++]);
  }
  return out;
}

/**
 * Ordena una lista de In_Profile por round-robin de artista para evitar más de
 * `maxArt` pistas consecutivas del mismo artista cuando hay ≥ 2 artistas.
 */
function arrangeByArtistRoundRobin(list, maxArt) {
  const groups = new Map(); // artistNorm → [candidatas en orden de score]
  for (const c of asArray(list)) {
    const key = normalizeText(c && c.artist) || '\u0000unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const buckets = [...groups.values()];
  const out = [];
  let last = null;
  let run = 0;
  const remaining = () => buckets.reduce((s, b) => s + b.length, 0);

  while (remaining() > 0) {
    let best = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (!b.length) continue;
      const key = normalizeText(b[0].artist) || '\u0000unknown';
      if (key === last && run >= maxArt) continue; // evitar exceder consecutivas
      if (best === -1) { best = i; continue; }
      const bk = normalizeText(buckets[best][0].artist) || '\u0000unknown';
      const bestDiff = bk !== last;
      const iDiff = key !== last;
      if (iDiff && !bestDiff) best = i;
      else if (iDiff === bestDiff && (Number(b[0].score) || 0) > (Number(buckets[best][0].score) || 0)) best = i;
    }
    if (best === -1) { // todo lo que queda es del mismo artista y run≥maxArt: forzar
      best = buckets.findIndex((b) => b.length);
    }
    const c = buckets[best].shift();
    const key = normalizeText(c.artist) || '\u0000unknown';
    if (key === last) run += 1; else { last = key; run = 1; }
    out.push(c);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// Pipeline puro completo (Req 1, 3, 4, 5, 8, 10)
// ───────────────────────────────────────────────────────────────

/**
 * Pipeline puro: clasifica → ordena → filtra distancia/SoundCloud → cuotas →
 * cap por artista → dedup → interleave → recorta a limit.
 *
 * @param {SeedProfile} seedProfile
 * @param {RawCandidate[]} rawCandidates  con graphDistance anotada
 * @param {number} limit
 * @param {object} [config=RADIO_CONFIG]
 * @returns {{tracks:Candidate[], cohesionRatio:number, mainstreamRatio:number, truncated:boolean, reason:string|null}}
 */
export function assembleRadio(seedProfile, rawCandidates, limit, config = RADIO_CONFIG) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RADIO_CONFIG.TARGET_QUEUE_LENGTH;
  const sp = seedProfile || {};

  // 1) Excluir SoundCloud y descartar distancia excesiva; dedup temprano.
  let cands = excludeSoundCloud(asArray(rawCandidates));
  cands = filterByGraphDistance(cands, config.MAX_GRAPH_DISTANCE);
  cands = dedupeById(cands);
  cands = dedupeByTitleNorm(cands);

  if (cands.length === 0) {
    return emptyResult('empty');
  }

  // 2) Clasificar cada candidata (inProfile / mainstream) y puntuar.
  const classified = cands.map((c) => {
    const { inProfile, mainstream } = classifyCandidate(sp, c);
    const withClass = { ...c, inProfile, mainstream };
    withClass.score = scoreCandidate(sp, withClass);
    return withClass;
  });

  // 3) Orden por score desc (vecindario y mainstream ya pesan en score, Req 2.4/4.6).
  const ordered = sortByScoreDesc(classified);

  // 4) Cap por artista (diversidad, Req 5.1) ANTES de la selección por cuotas,
  //    para que las proporciones se midan sobre el conjunto final real.
  const capped = capPerArtistList(ordered, config.MAX_PER_ARTIST);

  // 5) Selección con cuotas y tope = limit (cohesión, off, mainstream + recorte).
  const selected = selectWithQuotas(capped, cap, config);

  // 6) Intercalado: reordena sin cambiar el conjunto (consecutivas), Req 3.4/5.2/4.6.
  const tracks = interleave(selected, config);

  if (tracks.length === 0) {
    return emptyResult('empty');
  }

  const truncated = tracks.length < cap;
  const reason = truncated ? 'short_queue' : null;

  return {
    tracks,
    cohesionRatio: cohesionRatio(tracks),
    mainstreamRatio: mainstreamRatio(tracks),
    truncated,
    reason,
  };
}

// ───────────────────────────────────────────────────────────────
// Helpers internos
// ───────────────────────────────────────────────────────────────

function mainstreamRatio(candidates) {
  const list = asArray(candidates);
  if (list.length === 0) return 0;
  const main = list.filter((c) => c && c.mainstream === true).length;
  return main / list.length;
}

function emptyResult(reason) {
  return { tracks: [], cohesionRatio: 0, mainstreamRatio: 0, truncated: true, reason };
}

function sortByScoreDesc(list) {
  // Orden estable por score desc; conserva el orden original ante empate.
  return asArray(list)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (Number(b.c.score) || 0) - (Number(a.c.score) || 0) || a.i - b.i)
    .map((x) => x.c);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export default {
  RADIO_CONFIG,
  buildNeighborArtistSet,
  classifyCandidate,
  scoreCandidate,
  filterByGraphDistance,
  enforceQuotas,
  capPerArtistList,
  dedupeById,
  dedupeByTitleNorm,
  interleave,
  cohesionRatio,
  excludeSoundCloud,
  assembleRadio,
  isLiveOrRemixVersion,
};
