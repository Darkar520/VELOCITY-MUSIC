/**
 * Helpers para armar carruseles con VARIOS mixes (nunca 1 sola tarjeta).
 */
import { dedupeByTitle, capPerArtist } from '../helpers.js';
import { trackById } from '../catalog.js';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, n) {
  return shuffle(arr).slice(0, n);
}

export function artistKey(t) {
  return (t?.artist || '').toLowerCase().replace(/\s+/g, '');
}

export function tracksFromIds(ids, limit = 50) {
  return dedupeByTitle((ids || []).map(trackById).filter(Boolean)).slice(0, limit);
}

/** Parte tracks en mixes por artista (mín. minTracks por mix). */
export function mixesByArtist(tracks, { maxMixes = 8, minTracks = 4, labelFn } = {}) {
  const by = new Map();
  for (const t of tracks || []) {
    const k = artistKey(t) || 'unknown';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  }
  const groups = [...by.entries()]
    .map(([k, ts]) => ({ key: k, tracks: dedupeByTitle(ts), name: ts[0]?.artist || k }))
    .filter((g) => g.tracks.length >= minTracks)
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .slice(0, maxMixes);

  return groups.map((g) => ({
    label: labelFn ? labelFn(g) : g.name,
    tracks: g.tracks.slice(0, 50),
  }));
}

/** Parte en chunks de tamaño fijo (para listas largas sin artistas claros). */
export function mixesByChunks(tracks, { size = 12, maxMixes = 6, prefix = 'Mix' } = {}) {
  const list = dedupeByTitle(tracks || []);
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < list.length && out.length < maxMixes; i += size) {
    const chunk = list.slice(i, i + size);
    if (chunk.length < 4 && out.length > 0) break;
    if (chunk.length < 4) continue;
    out.push({
      label: `${prefix} ${out.length + 1}`,
      tracks: chunk,
    });
  }
  return out;
}

/**
 * Garantiza al menos `min` mixes.
 * 1) si ya hay ≥ min → ok
 * 2) si hay 1 mix con muchas tracks → partir por artista / chunks
 * 3) si no alcanza → devolver lo que haya (caller decide renombrar)
 */
export function ensureManyMixes(mixes, { min = 3, max = 8, prefix = 'Selección' } = {}) {
  const clean = (mixes || []).filter((m) => m && (m.tracks || []).length >= 4);
  if (clean.length >= min) return clean.slice(0, max);

  if (clean.length === 1) {
    const all = clean[0].tracks || [];
    const byArt = mixesByArtist(all, { maxMixes: max, minTracks: 3, labelFn: (g) => g.name });
    if (byArt.length >= min) return byArt;
    const chunks = mixesByChunks(all, { size: 10, maxMixes: max, prefix });
    if (chunks.length >= 2) return chunks;
    // último recurso: rebanar en 2 aunque queden cortos
    if (all.length >= 8) {
      const mid = Math.floor(all.length / 2);
      return [
        { label: `${prefix} A`, tracks: all.slice(0, mid) },
        { label: `${prefix} B`, tracks: all.slice(mid) },
      ].filter((m) => m.tracks.length >= 4);
    }
  }

  if (clean.length === 2 && min > 2) {
    // expandir el más grande
    const sorted = [...clean].sort((a, b) => (b.tracks?.length || 0) - (a.tracks?.length || 0));
    const expanded = mixesByArtist(sorted[0].tracks, { maxMixes: max - 1, minTracks: 3 });
    if (expanded.length >= 2) return [sorted[1], ...expanded].slice(0, max);
  }

  return clean.slice(0, max);
}

/** Offline: mixes por artista + chunks = varios carruseles de descargas. */
export function offlineMixes(downloadedIds) {
  const tracks = tracksFromIds([...downloadedIds], 120);
  if (tracks.length < 4) return [];
  let mixes = mixesByArtist(tracks, {
    maxMixes: 8,
    minTracks: 3,
    labelFn: (g) => `Offline · ${g.name}`,
  });
  if (mixes.length < 3) {
    mixes = [
      ...mixes,
      ...mixesByChunks(tracks, { size: 12, maxMixes: 6, prefix: 'Descargas' }),
    ];
  }
  // dedupe labels
  const seen = new Set();
  return mixes.filter((m) => {
    if (seen.has(m.label)) return false;
    seen.add(m.label);
    return true;
  }).slice(0, 8);
}

/** Favoritos → varios mixes por artista top. */
export function favArtistMixes(favIds) {
  const tracks = tracksFromIds(favIds, 100);
  return mixesByArtist(tracks, {
    maxMixes: 8,
    minTracks: 3,
    labelFn: (g) => g.name,
  });
}

/** Historial reciente → varios slices temporales. */
export function recentSliceMixes(recentIds) {
  const tracks = tracksFromIds(recentIds, 60);
  if (tracks.length < 4) return [];
  const slices = [
    { label: 'Hoy en bucle', tracks: tracks.slice(0, 15) },
    { label: 'Esta semana', tracks: tracks.slice(0, 30) },
    { label: 'Tu rotación', tracks: tracks.slice(10, 40) },
    { label: 'Más atrás', tracks: tracks.slice(20, 50) },
  ].filter((m) => m.tracks.length >= 4);
  const byArt = mixesByArtist(tracks, { maxMixes: 4, minTracks: 3, labelFn: (g) => `Reciente · ${g.name}` });
  return ensureManyMixes([...slices, ...byArt], { min: 3, max: 8, prefix: 'Reciente' });
}

export function playlistMixes(playlists) {
  return (playlists || [])
    .map((p) => {
      const tracks = tracksFromIds(p.trackIds || [], 50);
      if (tracks.length < 4) return null;
      return { label: p.name || 'Playlist', tracks };
    })
    .filter(Boolean)
    .slice(0, 10);
}
