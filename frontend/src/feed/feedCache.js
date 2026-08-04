/**
 * feedCache.js — caché "last-good" del feed de Inicio en localStorage.
 *
 * Objetivo: pintar el feed al instante en el próximo arranque (mientras se
 * regenera en background), evitando el spinner inicial. Es tolerante a fallos y
 * acotado en tamaño (cuota de localStorage): guarda solo lo necesario para
 * renderizar las tarjetas y reproducir (id/título/artista/cover/url), recortado
 * a un número razonable de secciones/mixes/pistas.
 *
 * No decide invalidación por contenido: eso lo maneja el nonce/firma del hook.
 * Solo caduca por antigüedad (MAX_AGE_MS) para no revivir un feed muy viejo.
 */

const KEY = 'velocity.feedCache';
const MAX_AGE_MS = 24 * 3600 * 1000; // 24 h
const MAX_SECTIONS = 8;
const MAX_MIXES = 8;
const MAX_TRACKS = 40;

function slimTrack(t) {
  if (!t || !t.id) return null;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId ?? null,
    album: t.album ?? null,
    albumId: t.albumId ?? null,
    cover: t.cover ?? '',
    url: t.url ?? undefined,
    durationSeconds: t.durationSeconds ?? 0,
    source: t.source,
  };
}

/** Recorta y adelgaza las secciones para que quepan en localStorage sin riesgo. */
export function slimSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .slice(0, MAX_SECTIONS)
    .map((sec) => ({
      section: sec.section,
      mixes: (sec.mixes || []).slice(0, MAX_MIXES).map((m) => ({
        label: m.label,
        tracks: (m.tracks || []).slice(0, MAX_TRACKS).map(slimTrack).filter(Boolean),
      })).filter((m) => m.tracks.length > 0),
    }))
    .filter((sec) => sec.section && sec.mixes.length > 0);
}

/** Persiste el feed (best-effort; ignora errores de cuota). */
export function saveFeedCache(sections) {
  try {
    const slim = slimSections(sections);
    if (!slim.length) return;
    localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), sections: slim }));
  } catch {
    // Cuota excedida u otro fallo: descartar la caché para no dejarla corrupta.
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
}

/** Devuelve las secciones cacheadas si existen y no han caducado; si no, null. */
export function loadFeedCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sections) || !parsed.sections.length) return null;
    if (Date.now() - (Number(parsed.ts) || 0) > MAX_AGE_MS) return null;
    return parsed.sections;
  } catch {
    return null;
  }
}

export function clearFeedCache() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
