// ═══════════════════════════════════════════════════════════════
// Utilidades puras (formato, color, deduplicación, parseo de letra).
// ═══════════════════════════════════════════════════════════════

// Formatea segundos a m:ss
export const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// Convierte un hex (#rrggbb) a rgba con alpha.
export const hex2rgba = (hex, a) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// Degradado del tema.
export const grad = (T, ang = 135) => `linear-gradient(${ang}deg, ${T.accent}, ${T.accent2})`;

// Eleva cualquier portada de YouTube Music/iTunes a alta resolución al mostrarla.
export const hiResCover = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, '=w1200-h1200');
  if (/=s\d+/.test(url)) return url.replace(/=s\d+/, '=s1200');
  if (/\d+x\d+bb\.(jpg|png)/i.test(url)) return url.replace(/\d+x\d+bb\.(jpg|png)/i, '1200x1200bb.$1');
  return url;
};

// Quita duplicados por artista+título (misma canción, distintas subidas).
export function dedupeByTitle(tracks) {
  const seen = new Set(); const out = [];
  for (const t of tracks) {
    const k = `${(t.artist || '').toLowerCase()}|${(t.title || '').toLowerCase().replace(/\s*[\(\[].*$/, '').trim()}`;
    if (seen.has(k)) continue; seen.add(k); out.push(t);
  }
  return out;
}

// Limita cuántas pistas del mismo artista aparecen (para que una mezcla no se
// llene de un solo artista). Conserva el orden.
export function capPerArtist(tracks, max = 3) {
  const c = {}; const out = [];
  for (const t of tracks) {
    const a = (t.artist || '').toLowerCase();
    c[a] = (c[a] || 0) + 1;
    if (c[a] <= max) out.push(t);
  }
  return out;
}

// Metadatos "ligeros" (sin url, específica de cada dispositivo/calidad) para
// sincronizar la biblioteca del usuario entre dispositivos vía backend.
export function slimTrack(t) {
  if (!t || !t.id) return null;
  return {
    id: t.id, title: t.title || '', artist: t.artist || '', artistId: t.artistId || null,
    album: t.album || '', albumId: t.albumId || null, genre: t.genre || '',
    cover: t.cover || '', durationSeconds: t.durationSeconds || t.duration || 0,
  };
}

// Parsea letra sincronizada (formato LRC) a [{ t, text }].
export function parseLRC(s) {
  const out = [];
  if (!s) return out;
  for (const line of s.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
    for (const m of stamps) out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}
