/**
 * MusicBrainz_Extractor — adapter a la API pública de MusicBrainz.
 *
 * Rol en Velocity Music: COMPLEMENTO de YouTube Music, nunca fuente de audio.
 *   • enrichTrack: dada una pista (artist, title, duration?) devuelve MBID +
 *     datos canónicos (año exacto, álbum canónico, género, país) si matchea
 *     por título + artista normalize() + duración ±2s. Sino, null.
 *   • lookupByMBID: registro canónico completo (recording + releases + artist).
 *   • getReleaseTracks: tracklist canónico de un release (offset 0..N).
 *   • getArtistReleases: discografía ordenada por año (offset 0..N).
 *
 * Límite oficial de MB: 1 req/seg por IP. Se impone con throttle global rolling
 * (`mbThrottle`). Si MB está caído o responde != 2xx, todas las funciones
 * devuelven null/[] sin throw — el caller ya trata null como "no tínemos MB,
 * sigamos con YTM".
 *
 * MB no entrega audio ni imágenes directamente. Las portadas viven en Cover Art
 * Archive (proyecto afiliado); en MVP no lo consultamos (CoverImg hoy usa la
 * portada de YTM, y el frontend ya la cachea en data: en IDB).
 *
 * El User-Agent y la URL de contacto son exigencia de MB para no caer en rate
 * limit estricto. Si los headers no se respetan, MB retorna 403.
 */

import { normalizeText } from '../lib/normalize.js';

const MB_ROOT = 'https://musicbrainz.org/ws/2';
// User-Agent debe ir en el header. MB requiere identificar al cliente + un
// contacto (URL de la app o repo público). Si no, responde 403.
const MB_HEADERS = {
  'User-Agent': 'VelocityMusic/1.0 (https://github.com/Darkar520/VELOCITY-MUSIC)',
  Accept: 'application/json',
};

// Rolling throttle: 1 req/seg, con 100ms de margen de seguridad.
const MB_THROTTLE_MS = 1100;
let _nextSlotAt = 0;

/**
 * Reserva el siguiente slot y devuelve cuánto esperar antes de disparar el
 * fetch. Cada llamada empuja el próximo slot +MB_THROTTLE_MS. Para llamadas
 * seriales esto da ~1 req/seg exacto; para llamadas paralelas, cada una
 * obtiene un slot distinto (cola implícita por timestamp).
 */
function mbThrottle() {
  const now = Date.now();
  const wait = Math.max(0, _nextSlotAt - now);
  _nextSlotAt = now + wait + MB_THROTTLE_MS;
  return new Promise((r) => setTimeout(r, wait));
}

/** Resetea el throttle. Solo para tests. */
export function __resetThrottleForTests() {
  _nextSlotAt = 0;
}

async function mbFetch(url) {
  await mbThrottle();
  try {
    const r = await fetch(url, { headers: MB_HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Busca la mejor grabación que matchee artist+title (+duración opcional).
 * Scorea por título exacto, artista exacto y duración ±2s. Sólo devuelve un
 * match si pasa un umbral mínimo (score >= 5) para no enriquecer con datos
 * erróneos.
 *
 * @returns {Promise<object|null>} Recording canónico normalizado, o null.
 */
export async function searchTrack({ artist, title, duration } = {}) {
  if (!artist || !title) return null;
  const q = `recording:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
  const url = `${MB_ROOT}/recording?query=${encodeURIComponent(q)}&fmt=json&limit=5`;
  const d = await mbFetch(url);
  if (!d || !Array.isArray(d.recordings) || !d.recordings.length) return null;
  return pickMatch(d.recordings, { artist, title, duration });
}

/**
 * Wrapper de searchTrack que devuelve solo los campos que el caller de
 * audioResolver/catalog necesita: MBID + año + álbum canónico.
 *
 * Ampliado (Bug 3): incluye `isLive` derivado del release-group del primer
 * release. audioResolver lo usa para añadir `-live -concert -tour -acoustic`
 * a la query de tier 2/3 cuando isLive === false (álbum de estudio).
 *
 * @returns {Promise<{mbid, year, albumId, albumName, isLive, genre, country}|null>}
 */
export async function enrichTrack({ artist, title, duration } = {}) {
  const m = await searchTrack({ artist, title, duration });
  if (!m) return null;
  return {
    mbid: m.id,
    year: m.year,
    albumId: m.albumId,
    albumName: m.albumName,
    isLive: m.isLive,
    genre: m.genre,
    country: m.country,
    mbSource: 'musicbrainz',
  };
}

/**
 * Lookup por MBID exacto. Útil cuando el track ya trae mbid guardado y
 * queremos datos completos (releases, géneros).
 */
export async function lookupByMBID(mbid) {
  if (!mbid) return null;
  const url = `${MB_ROOT}/recording/${encodeURIComponent(mbid)}?inc=releases+artist-credits+genres&fmt=json`;
  const d = await mbFetch(url);
  if (!d || !d.id) return null;
  return mapRecording(d, d.releases?.[0]);
}

/**
 * Busca el release MBID de un álbum por artist + albumName.
 * Prefiere tipo Album sobre Live/Compilation/Single.
 *
 * @returns {Promise<{releaseMBID, albumName, year, isLive, isCompilation, artistMBID, trackCount}|null>}
 */
export async function enrichAlbum({ artist, albumName } = {}) {
  if (!artist || !albumName) return null;
  const q = `release:"${albumName.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
  const url = `${MB_ROOT}/release?query=${encodeURIComponent(q)}&fmt=json&limit=8`;
  const d = await mbFetch(url);
  if (!d || !Array.isArray(d.releases) || !d.releases.length) return null;
  const na = normalizeText(artist);
  const nal = normalizeText(albumName);
  let best = null;
  let bestScore = -1;
  for (const rel of d.releases) {
    const rArtist = normalizeText(rel['artist-credit']?.[0]?.name || '');
    const rTitle = normalizeText(rel.title || '');
    let score = 0;
    if (rTitle === nal) score += 20;
    else if (rTitle && (rTitle.includes(nal) || nal.includes(rTitle))) score += 10;
    if (rArtist === na) score += 15;
    else if (rArtist && (rArtist.includes(na) || na.includes(rArtist))) score += 8;
    // Preferir Album sobre Live/Single/Compilation.
    const rgType = rel['release-group']?.['primary-type'] || '';
    if (rgType === 'Album') score += 6;
    else if (rgType === 'Live') score -= 4;
    else if (rgType === 'Compilation') score -= 2;
    else if (rgType === 'Single') score -= 1;
    // Bonus por fecha completa (año conocido).
    if (rel.date) score += 1;
    if (score > bestScore) { bestScore = score; best = rel; }
  }
  if (!best || bestScore < 10) return null;
  const rgType = best['release-group']?.['primary-type'] || '';
  return {
    releaseMBID: best.id,
    albumName: best.title || albumName,
    year: best.date ? Number(String(best.date).slice(0, 4)) || null : null,
    isLive: rgType === 'Live' || /\blive\b|\bconcert\b/i.test(best.title || ''),
    isCompilation: rgType === 'Compilation',
    artistMBID: best['artist-credit']?.[0]?.artist?.id || null,
    trackCount: best['track-count'] || null,
    mbSource: 'musicbrainz',
  };
}

/**
 * Tracklist canónico de un release (álbum). Devuelve pistas con mbid pero
 * SIN videoId YTM (no existe en MB). En Velocity Music hoy esto se usa solo
 * como fallback informativo; el flujo principal de audio sigue con YTM.
 *
 * Salida ampliada (Bug 2 fix): cada pista incluye `trackNumber` (1-indexed,
 * consecutivo a través de discos) y el album trae `isLive`/`isCompilation`
 * derivados del tipo de release-group. Bug 3 tambien usa `isLive`.
 */
export async function getReleaseTracks(releaseMBID) {
  if (!releaseMBID) return [];
  // inc=release-groups trae el type (Album / Single / Live / Compilation).
  const url = `${MB_ROOT}/release/${encodeURIComponent(releaseMBID)}?inc=recordings+artist-credits+release-groups&fmt=json`;
  const d = await mbFetch(url);
  if (!d || !d.id) return [];
  const media = Array.isArray(d.media) ? d.media : [];
  const albumName = d.title || null;
  const albumId = d.id;
  const year = d.date ? Number(String(d.date).slice(0, 4)) || null : null;
  const artistName = d['artist-credit']?.[0]?.name || null;
  // Tipo de release-group: Album / Single / EP / Live / Compilation / Other.
  const rgType = d['release-group']?.['primary-type'] || null;
  const isLive = rgType === 'Live' || /\blive\b|\bconcert\b/i.test(d.title || '');
  const isCompilation = rgType === 'Compilation';
  const out = [];
  let globalIndex = 0;
  for (const m of media) {
    for (const tr of (m.track || [])) {
      globalIndex += 1;
      out.push({
        id: null, // sin videoId YTM
        mbid: tr.id || null,
        title: tr.title || null,
        artist: artistName,
        album: albumName,
        albumId,
        year,
        durationSeconds: tr.length ? Math.round(tr.length / 1000) : null,
        trackNumber: globalIndex, // 1..N a través de discos
        isLive,
        isCompilation,
        mbSource: 'musicbrainz',
      });
    }
  }
  return out;
}

/**
 * Discografía de un artista (álbumes + EPs), ordenada por año desc.
 * MBID del artista se consigue con searchArtist (no implementado en MVP).
 */
export async function getArtistReleases(artistMBID, { limit = 50 } = {}) {
  if (!artistMBID) return [];
  const url = `${MB_ROOT}/release?artist=${encodeURIComponent(artistMBID)}&inc=artist-credits&fmt=json&limit=${limit}`;
  const d = await mbFetch(url);
  if (!d || !Array.isArray(d.releases)) return [];
  return d.releases
    .map((rel) => ({
      albumId: rel.id,
      name: rel.title,
      artist: rel['artist-credit']?.[0]?.name || null,
      year: rel.date ? Number(String(rel.date).slice(0, 4)) || null : null,
      mbSource: 'musicbrainz',
    }))
    .sort((a, b) => (b.year || 0) - (a.year || 0));
}

// ───────────────────────────────────────────────────────────────────
// Helpers internos.
// ───────────────────────────────────────────────────────────────────

function pickMatch(recordings, { artist, title, duration }) {
  if (!Array.isArray(recordings) || !recordings.length) return null;
  const na = normalizeText(artist);
  const nt = normalizeText(title);
  let best = null;
  let bestScore = -1;
  for (const r of recordings) {
    const rt = normalizeText(r.title || '');
    const ra = normalizeText(r['artist-credit']?.[0]?.name || '');
    let score = 0;
    if (rt && rt === nt) score += 10;
    else if (rt && (rt.includes(nt) || nt.includes(rt))) score += 5;
    if (ra && ra === na) score += 10;
    else if (ra && (ra.includes(na) || na.includes(ra))) score += 5;
    if (duration && r.length) {
      const dSec = Math.round(r.length / 1000);
      const delta = Math.abs(dSec - duration);
      if (delta <= 2) score += 8;
      else if (delta <= 5) score += 3;
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best || bestScore < 5) return null;
  return mapRecording(best, best.releases?.[0]);
}

function mapRecording(rec, release = null) {
  // primary-type del release-group del release. MB anida release-group dentro
  // de cada release. Si no trae, se asume null y isLive queda indefinido.
  const rgType = release?.['release-group']?.['primary-type']
    || rec.releases?.[0]?.['release-group']?.['primary-type']
    || null;
  const titleForLiveCheck = rec.title || release?.title || '';
  return {
    id: rec.id || null,
    title: rec.title || null,
    artist: rec['artist-credit']?.[0]?.name || null,
    albumId: release?.id || null,
    albumName: release?.title || null,
    year: release?.date ? Number(String(release.date).slice(0, 4)) || null : null,
    duration: rec.length ? Math.round(rec.length / 1000) : null,
    genre: rec.genres?.[0]?.name || null,
    country: release?.country || null,
    isLive: rgType === 'Live' || /\blive\b|\bconcert\b|\bunplugged\b/i.test(titleForLiveCheck),
    isCompilation: rgType === 'Compilation',
    rgType,
    mbSource: 'musicbrainz',
  };
}

export const __test__ = { _getNextSlotAt: () => _nextSlotAt };