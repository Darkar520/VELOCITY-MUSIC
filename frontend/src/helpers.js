// ═══════════════════════════════════════════════════════════════
// Utilidades puras (formato, color, deduplicación, parseo de letra).
// ═══════════════════════════════════════════════════════════════

// Formatea segundos a m:ss
export const fmt = (s) => {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// Convierte un hex (#rrggbb) a rgba con alpha.
export const hex2rgba = (hex, a) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// Degradado del tema.
export const grad = (T, ang = 135) => `linear-gradient(${ang}deg, ${T.accent}, ${T.accent2})`;

// Ajusta la portada de YouTube Music/iTunes al tamaño pedido (por defecto 512px).
// Pedir el tamaño real de render (en vez de 1200px siempre) acelera mucho la
// carga, sobre todo en miniaturas de listas.
// Hosts de imágenes que deben pasar por el proxy /img del backend para
// resolver CORS, mejorar caching (SW) y evitar fallos intermitentes del CDN.
const PROXY_HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com|ytimg\.com|mzstatic\.com)$/i;

const needsProxy = (url) => {
  try { return PROXY_HOSTS.test(new URL(url).hostname); } catch { return false; }
};

export const hiResCover = (url, size = 512) => {
  if (!url || typeof url !== 'string') return url;
  // data: y blob: URLs van directo (no necesitan proxy ni resize)
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  const s = Math.max(64, Math.min(1200, Math.round(size)));
  let rewritten = url;
  if (/=w\d+-h\d+/.test(url)) rewritten = url.replace(/=w\d+-h\d+/, `=w${s}-h${s}`);
  else if (/=s\d+/.test(url)) rewritten = url.replace(/=s\d+/, `=s${s}`);
  else if (/\d+x\d+bb\.(jpg|png)/i.test(url)) rewritten = url.replace(/\d+x\d+bb\.(jpg|png)/i, `${s}x${s}bb.$1`);
  // Pasar por el proxy del backend: resuelve CORS, cachea 30 días, y permite
  // que el service worker las sirva offline.
  if (needsProxy(rewritten)) return `/img?u=${encodeURIComponent(rewritten)}`;
  return rewritten;
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

// Metadatos "ligeros" (sin url de stream ni data:/blob: URLs pesadas) para
// sincronizar la biblioteca del usuario entre dispositivos vía backend.
export function slimTrack(t) {
  if (!t || !t.id) return null;
  // No incluir data:/blob: URLs en el cover: pueden pesar decenas de KB y
  // sobrecargarían la API de sincronización (bug detectado en los tests).
  const cover = (typeof t.cover === 'string' && (t.cover.startsWith('data:') || t.cover.startsWith('blob:')))
    ? '' : (t.cover || '');
  return {
    id: t.id, title: t.title || '', artist: t.artist || '', artistId: t.artistId || null,
    album: t.album || '', albumId: t.albumId || null, genre: t.genre || '',
    cover, durationSeconds: t.durationSeconds || t.duration || 0,
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

// Solape de palabras entre dos textos de letra (0–1). Evita que al sincronizar
// se sustituya la letra correcta por otra de lrclib mal emparejada.
export function lyricsOverlapRatio(a, b) {
  const tok = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const A = new Set(tok(String(a || '').slice(0, 4000)));
  const B = new Set(tok(String(b || '').slice(0, 4000)));
  if (A.size < 4 || B.size < 4) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

// Texto plano a partir de líneas LRC parseadas.
export function plainFromSyncedLines(lines) {
  if (!Array.isArray(lines)) return '';
  return lines.map((l) => (l && l.text) || '').filter(Boolean).join('\n');
}

// Genera variables de superficie OSCURAS tintadas con un color, mezclándolo
// dentro del negro base a baja intensidad. Mantiene el texto claro (no se
// sobrescribe) para garantizar contraste/legibilidad con cualquier tinte.
export function tintedVars(tintHex) {
  if (!tintHex || typeof tintHex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tintHex)) return {};
  const toRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const tint = toRGB(tintHex);
  const mix = (baseHex, ratio) => {
    const b = toRGB(baseHex);
    return toHex(b[0] + (tint[0] - b[0]) * ratio, b[1] + (tint[1] - b[1]) * ratio, b[2] + (tint[2] - b[2]) * ratio);
  };
  return {
    '--bg-0':   mix('#04060a', 0.10),
    '--bg-1':   mix('#080c12', 0.13),
    '--surf-0': mix('#0b0f16', 0.16),
    '--surf-1': mix('#10151e', 0.18),
    '--surf-2': mix('#161c27', 0.22),
  };
}
