import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api, isAuthed, setOnUnauthorized } from './api.js';
import * as offline from './offline.js';

// ═══════════════════════════════════════════════════════════════
// GLOBAL CSS
// ═══════════════════════════════════════════════════════════════
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  :root {
    --bg-0:#04060a; --bg-1:#080c12; --surf-0:#0b0f16; --surf-1:#10151e; --surf-2:#161c27;
    --line:#ffffff10; --line-soft:#ffffff08;
    --txt-0:#f4f7fb; --txt-1:#aab4c2; --txt-2:#5b6675; --txt-3:#3a4150;
  }
  *, *::before, *::after { box-sizing: border-box; }
  @keyframes fadeUp   { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes eqBar    { from { transform:scaleY(.16); } to { transform:scaleY(1); } }
  @keyframes breathe  { 0%,100%{ opacity:.26; transform:translate(-50%,-50%) scale(.9); } 50%{ opacity:.6; transform:translate(-50%,-50%) scale(1.12); } }
  @keyframes spinSlow { to { transform:rotate(360deg); } }
  @keyframes spin360  { to { transform:rotate(360deg); } }
  .fade-up { animation: fadeUp .5s cubic-bezier(.22,1,.36,1) both; }
  .eq-bar  { transform-origin: bottom; animation: eqBar .55s ease-in-out infinite alternate; }
  .breathe { animation: breathe 5s ease-in-out infinite; }
  .spin    { animation: spinSlow 22s linear infinite; }
  .loader  { animation: spin360 .8s linear infinite; }
  ::-webkit-scrollbar { display:none; }
  * { -ms-overflow-style:none; scrollbar-width:none; }
  input[type=range] { -webkit-appearance:none; appearance:none; background:transparent; width:100%; cursor:pointer; }
  input[type=range]::-webkit-slider-runnable-track { height:100%; border-radius:99px; background:transparent; }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance:none; width:15px; height:15px; border-radius:50%; background:#fff;
    box-shadow:0 2px 8px #000a, 0 0 0 4px #ffffff14; transition: transform .15s ease;
  }
  input[type=range]:active::-webkit-slider-thumb { transform:scale(1.25); }
  input[type=range]::-moz-range-thumb { width:15px; height:15px; border:none; border-radius:50%; background:#fff; box-shadow:0 2px 8px #000a; }
  input::placeholder { color:var(--txt-2); }
  .card-hover { transition: transform .26s cubic-bezier(.22,1,.36,1), box-shadow .26s ease, border-color .26s ease; }
  .card-hover:hover { transform:translateY(-3px) scale(1.015); }
  .btn-tap { transition: transform .12s ease, box-shadow .2s ease, opacity .2s ease; }
  .btn-tap:hover { transform: translateY(-1px); }
  .btn-tap:active { transform:scale(.9); }
  .glass { backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%); }
  .press { transition: transform .12s ease; }
  .press:active { transform: scale(.97); }
  .media-card { position:relative; }
  .media-actions { opacity:0; transform:translateY(6px); transition:opacity .2s ease, transform .2s ease; }
  .media-card:hover .media-actions { opacity:1; transform:translateY(0); }
  .track-row .row-extra { opacity:.0; transition:opacity .15s ease; }
  .track-row:hover .row-extra { opacity:1; }
  @media (hover: none) { .media-actions, .track-row .row-extra { opacity:1; transform:none; } }
`;

// ═══════════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════════
const THEMES = {
  emerald: { name:'Esmeralda', accent:'#10d9a0', accent2:'#06b6d4' },
  violet:  { name:'Violeta',   accent:'#a78bfa', accent2:'#ec4899' },
  ocean:   { name:'Océano',    accent:'#38bdf8', accent2:'#6366f1' },
  solar:   { name:'Solar',     accent:'#fbbf24', accent2:'#f97316' },
  rose:    { name:'Rosa',      accent:'#fb7185', accent2:'#f43f5e' },
};

// Búsquedas semilla para poblar el inicio (no hay endpoint de catálogo/charts).
const SEED_ROWS = [
  { label:'Tendencias',        q:'top hits 2024' },
  { label:'Pop en Español',    q:'pop español' },
  { label:'Lo-Fi para Concentrarse', q:'lofi beats' },
  { label:'Rock Clásico',      q:'classic rock' },
  { label:'Electrónica',       q:'electronic dance' },
];
const GENRES = [
  { label:'Reggaetón', color:'#a78bfa', q:'reggaeton' }, { label:'Pop', color:'#fb7185', q:'pop hits' },
  { label:'Lo-Fi', color:'#fbbf24', q:'lofi' },          { label:'Rock', color:'#38bdf8', q:'rock' },
  { label:'Hip-Hop', color:'#10d9a0', q:'hip hop' },     { label:'Electrónica', color:'#818cf8', q:'electronic' },
];

const FALLBACK_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2230"/><stop offset="1" stop-color="#0b0f16"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="50%" y="54%" font-size="44" text-anchor="middle" fill="#39414f">♪</text></svg>`
);

// ═══════════════════════════════════════════════════════════════
// CATÁLOGO DINÁMICO — caché en memoria + persistencia local de metadata.
// El backend solo guarda IDs; aquí conservamos los metadatos para render.
// ═══════════════════════════════════════════════════════════════
const _catalog = new Map();
function cacheTrack(t) { if (t && t.id) _catalog.set(t.id, t); return t; }
function cacheTracks(arr) { (arr || []).forEach(cacheTrack); return arr || []; }
const trackById = (id) => _catalog.get(id) || null;
const tracksByArtist = (artist) => [..._catalog.values()].filter(t => t.artist === artist);
const tracksByAlbum  = (artist, album) => [..._catalog.values()].filter(t => t.artist === artist && t.album === album);
const albumsByArtist = (artist) => {
  const seen = {};
  tracksByArtist(artist).forEach(t => { if (!seen[t.album]) seen[t.album] = { album: t.album, cover: t.cover, artist }; });
  return Object.values(seen);
};
function loadMeta() { try { const s = localStorage.getItem('velocity.meta'); if (s) JSON.parse(s).forEach(cacheTrack); } catch {} }
// Estado del reproductor persistido (última pista + cola + posición), como Spotify.
function loadPlayerState() {
  try {
    const s = JSON.parse(localStorage.getItem('velocity.player') || 'null');
    if (s && s.track && s.track.id) { cacheTrack(s.track); return s; }
    if (s && s.trackId) { const t = trackById(s.trackId); if (t) return { ...s, track: t }; }
  } catch {}
  return null;
}
function saveMeta() { try { localStorage.setItem('velocity.meta', JSON.stringify([..._catalog.values()].slice(-500))); } catch {} }
// Invalidación de caché: si subimos la versión, descartamos metadata/feed viejos
// (p.ej. pistas de radio cacheadas sin carátula por un bug previo) una sola vez.
const CACHE_VERSION = '3';
try {
  if (localStorage.getItem('velocity.cacheVer') !== CACHE_VERSION) {
    localStorage.removeItem('velocity.meta');
    localStorage.removeItem('velocity.home');
    localStorage.setItem('velocity.cacheVer', CACHE_VERSION);
  }
} catch {}
loadMeta();

// Normaliza un TrackMetadata del backend a la forma del frontend (con url de streaming).
function normalizeTrack(t) {
  const n = {
    id: t.id,
    title: t.title || 'Sin título',
    artist: t.artist || 'Desconocido',
    artistId: t.artistId || null,
    album: t.album || 'Sencillo',
    albumId: t.albumId || null,
    genre: t.genre || '',
    cover: t.artworkUrl || t.cover || FALLBACK_COVER,
    durationSeconds: t.durationSeconds || t.duration || 0,
  };
  n.url = api.streamUrl({ artist: n.artist, title: n.title, id: n.id });
  return cacheTrack(n);
}

// Metadatos "ligeros" (sin url, que es específica de cada dispositivo/calidad)
// para sincronizar la biblioteca del usuario entre dispositivos vía backend.
function slimTrack(t) {
  if (!t || !t.id) return null;
  return {
    id: t.id, title: t.title || '', artist: t.artist || '', artistId: t.artistId || null,
    album: t.album || '', albumId: t.albumId || null, genre: t.genre || '',
    cover: t.cover || '', durationSeconds: t.durationSeconds || t.duration || 0,
  };
}

// Quita duplicados por artista+título (misma canción, distintas subidas).
function dedupeByTitle(tracks) {
  const seen = new Set(); const out = [];
  for (const t of tracks) {
    const k = `${(t.artist||'').toLowerCase()}|${(t.title||'').toLowerCase().replace(/\s*[\(\[].*$/, '').trim()}`;
    if (seen.has(k)) continue; seen.add(k); out.push(t);
  }
  return out;
}

// Limita cuántas pistas del mismo artista aparecen (para que una mezcla no se
// llene de un solo artista). Conserva el orden.
function capPerArtist(tracks, max = 3) {
  const c = {}; const out = [];
  for (const t of tracks) {
    const a = (t.artist || '').toLowerCase();
    c[a] = (c[a] || 0) + 1;
    if (c[a] <= max) out.push(t);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
};
const hex2rgba = (hex, a) => {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
};
const grad = (T, ang = 135) => `linear-gradient(${ang}deg, ${T.accent}, ${T.accent2})`;
// Eleva cualquier portada de YouTube Music/iTunes a alta resolución al mostrarla.
const hiResCover = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, '=w1200-h1200');
  if (/=s\d+/.test(url)) return url.replace(/=s\d+/, '=s1200');
  if (/\d+x\d+bb\.(jpg|png)/i.test(url)) return url.replace(/\d+x\d+bb\.(jpg|png)/i, '1200x1200bb.$1');
  return url;
};

// ═══════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════
function usePersisted(key, def) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s != null ? JSON.parse(s) : def; } catch { return def; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV];
}
function useViewport() {
  const [vp, setVp] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1024, h: typeof window !== 'undefined' ? window.innerHeight : 768 }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, []);
  return vp;
}

// ═══════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════
const Icon = {
  Home:  ({c='currentColor',sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>,
  Search:({c='currentColor',sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Lib:   ({c='currentColor',sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="4" height="18" rx="1"/><rect x="9.5" y="6" width="4" height="15" rx="1"/><rect x="16" y="9" width="5" height="12" rx="1"/></svg>,
  User:  ({c='currentColor',sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Heart: ({c='currentColor',sz=22,filled=false}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={filled?c:'none'} stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>,
  Play:  ({c='currentColor',sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><path d="M8 5v14l11-7z"/></svg>,
  Pause: ({c='currentColor',sz=24}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>,
  Prev:  ({c='currentColor',sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>,
  Next:  ({c='currentColor',sz=22}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>,
  Shuf:  ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>,
  Rep:   ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>,
  Vol:   ({c='currentColor',sz=17}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>,
  ChevD: ({c='currentColor',sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
  ChevL: ({c='currentColor',sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  Plus:  ({c='currentColor',sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  X:     ({c='currentColor',sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check: ({c='currentColor',sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Clock: ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>,
  List:  ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2" fill={c}/><circle cx="3.5" cy="12" r="1.2" fill={c}/><circle cx="3.5" cy="18" r="1.2" fill={c}/></svg>,
  Mic:   ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>,
  Trash: ({c='currentColor',sz=17}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
  Dots:  ({c='currentColor',sz=20}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>,
  Share: ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>,
  Disc:  ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>,
  Out:   ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Queue: ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="11" y2="18"/><line x1="19" y1="9" x2="19" y2="21"/><polyline points="16 12 19 9 22 12"/></svg>,
  Down:  ({c='currentColor',sz=18}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Speaker:({c='currentColor',sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12" y2="6"/></svg>,
  Headph:({c='currentColor',sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14v-2a9 9 0 0118 0v2"/><path d="M21 16a2 2 0 01-2 2h-1v-6h1a2 2 0 012 2zM3 16a2 2 0 002 2h1v-6H5a2 2 0 00-2 2z"/></svg>,
  Grip:  ({c='currentColor',sz=16}) => <svg width={sz} height={sz} viewBox="0 0 24 24" fill={c}><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>,
};

// ═══════════════════════════════════════════════════════════════
// EQ VISUALIZER
// ═══════════════════════════════════════════════════════════════
function EQViz({ color, color2, playing, bars = 10, h = 24, gap = 2.5 }) {
  const delays  = [0, .15, .07, .22, .04, .19, .11, .26, .08, .17, .03, .21, .09, .24];
  const heights = [.5, .8, .4, 1, .6, .9, .45, .7, .55, .85, .5, .95, .6, .75];
  const durs    = [.5, .62, .48, .7, .55, .66, .5, .6, .52, .68, .58, .64, .5, .6];
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap, height:h, flexShrink:0 }}>
      {heights.slice(0, bars).map((frac, i) => (
        <div key={i} className={playing ? 'eq-bar' : ''} style={{
          width: 3, borderRadius: 99, background: color2 ? `linear-gradient(${color}, ${color2})` : color,
          height: playing ? `${frac*100}%` : '12%', animationDelay: `${delays[i%delays.length]}s`,
          animationDuration: `${durs[i%durs.length]}s`, boxShadow: playing ? `0 0 6px ${color}aa` : 'none',
          transition: 'height .3s ease, box-shadow .3s ease',
        }} />
      ))}
    </div>
  );
}

function Spinner({ c, sz = 22 }) {
  return <svg className="loader" width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>;
}

// Anillo de progreso de descarga (estilo Spotify).
function ProgressRing({ pct = 0, active = false, done = false, T, size = 22 }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surf-2)" strokeWidth="2.4" />
      {!done && <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.accent} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition: 'stroke-dashoffset .3s ease' }} />}
      {done
        ? <path d={`M${size*0.3} ${size*0.52} L${size*0.44} ${size*0.66} L${size*0.72} ${size*0.36}`} fill="none" stroke={T.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        : active
          ? <circle cx={size/2} cy={size/2} r="2" fill={T.accent} />
          : <path d={`M${size/2} ${size*0.32} V${size*0.6} M${size*0.38} ${size*0.5} L${size/2} ${size*0.62} L${size*0.62} ${size*0.5}`} fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// Botón "descargar todo" con anillo de progreso real (cuántas pistas están descargadas).
function DownloadAllButton({ ids, downloaded, downloading, onClick, T }) {
  const total = ids.length;
  const done = ids.filter(id => downloaded.has(id)).length;
  const active = ids.some(id => downloading.has(id));
  const allDone = total > 0 && done === total;
  const pct = total ? (done / total) * 100 : 0;
  return (
    <button onClick={onClick} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'9px 16px', cursor:'pointer', color: allDone ? T.accent : 'var(--txt-1)', fontSize:12, fontWeight:700 }}>
      <ProgressRing pct={pct} active={active} done={allDone} T={T} size={20} />
      {allDone ? 'Descargado' : active ? `Descargando ${done}/${total}` : 'Descargar'}
    </button>
  );
}

// Parsea letra sincronizada (formato LRC) a [{ t, text }].
function parseLRC(s) {
  const out = [];
  if (!s) return out;
  for (const line of s.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
    for (const m of stamps) out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Imagen de carátula robusta: carga diferida, estado de carga y fallback al fallar.
function CoverImg({ src, alt = '', radius = 12, className = '', style = {} }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const real = !failed && src ? hiResCover(src) : FALLBACK_COVER;
  return (
    <div style={{ position:'relative', overflow:'hidden', borderRadius:radius, background:'var(--surf-2)', ...style }}>
      {!loaded && <div style={{ position:'absolute', inset:0, background:'linear-gradient(110deg, var(--surf-1) 30%, var(--surf-2) 50%, var(--surf-1) 70%)' }} />}
      <img src={real} alt={alt} loading="lazy" decoding="async" className={className}
        onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(true); }}
        referrerPolicy="no-referrer"
        style={{ width:'100%', height:'100%', objectFit:'cover', display:'block', opacity: loaded ? 1 : 0, transition:'opacity .35s ease' }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED PRESENTATIONAL COMPONENTS
// ═══════════════════════════════════════════════════════════════
const SectionHeader = ({ label, accent, action }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:13, marginTop:4 }}>
    <div style={{ display:'flex', alignItems:'center', gap:9 }}>
      <div style={{ width:3, height:13, borderRadius:9, background:accent, boxShadow:`0 0 8px ${accent}` }} />
      <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:2.5, color:'var(--txt-1)', textTransform:'uppercase' }}>{label}</div>
    </div>
    {action}
  </div>
);

function TrackRow({ track, active, playing, T, onClick, onFav, faved, onAdd, onRemove, onMenu, downloaded, downloading, selecting, selected, onSelect }) {
  const handleClick = selecting ? () => onSelect(track.id) : onClick;
  return (
    <div onClick={handleClick} className="card-hover" style={{
      display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer',
      background: (selected) ? hex2rgba(T.accent,.14) : active ? `linear-gradient(135deg, ${hex2rgba(T.accent,.14)}, ${hex2rgba(T.accent2,.05)})` : 'transparent',
      border: `1px solid ${(active||selected) ? hex2rgba(T.accent,.32) : 'transparent'}`,
      boxShadow: active ? `0 6px 20px ${hex2rgba(T.accent,.16)}` : 'none',
    }}>
      {selecting && (
        <div style={{ width:22, height:22, borderRadius:'50%', border:`2px solid ${selected ? T.accent : 'var(--txt-3)'}`, background: selected ? T.accent : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {selected && <Icon.Check c="#04060a" sz={13} />}
        </div>
      )}
      <div style={{ position:'relative', flexShrink:0 }}>
        <CoverImg src={track.cover} alt="" radius={12} style={{ width:46, height:46 }} />
        {active && playing && (
          <div className="glass" style={{ position:'absolute', inset:0, background:'#00000066', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <EQViz color={T.accent} color2={T.accent2} playing={playing} bars={5} h={18} gap={2} />
          </div>
        )}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:700, color: active ? T.accent : 'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
        <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}{track.genre?` · ${track.genre}`:''}</div>
      </div>
      {!selecting && downloading ? <span style={{ display:'flex', flexShrink:0 }}><Spinner c={T.accent} sz={15} /></span>
        : !selecting && downloaded ? <span title="Disponible sin conexión" style={{ display:'flex', flexShrink:0 }}><Icon.Down c={T.accent} sz={15} /></span> : null}
      {!selecting && onAdd && <button aria-label="Añadir a playlist" onClick={e => { e.stopPropagation(); onAdd(track.id); }} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Plus c="var(--txt-2)" sz={18} /></button>}
      {!selecting && onFav && <button aria-label={faved?'Quitar de Me gusta':'Añadir a Me gusta'} onClick={e => { e.stopPropagation(); onFav(track.id); }} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Heart c={faved ? T.accent : '#3a4150'} filled={faved} sz={19} /></button>}
      {!selecting && onRemove && <button aria-label="Quitar" onClick={e => { e.stopPropagation(); onRemove(track.id); }} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Trash c="var(--txt-2)" sz={17} /></button>}
      {!selecting && onMenu && <button aria-label="Más opciones" onClick={e => { e.stopPropagation(); onMenu(track.id); }} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Dots c="var(--txt-2)" sz={18} /></button>}
    </div>
  );
}

function MediaCard({ cover, title, subtitle, T, onClick, onPlay, onFav, onMenu, faved }) {
  return (
    <div className="card-hover media-card" style={{ flexShrink:0, width:128 }}>
      <div onClick={onClick} style={{ position:'relative', width:128, height:128, borderRadius:18, marginBottom:9, cursor:'pointer', boxShadow:'0 8px 22px #0007' }}>
        <CoverImg src={cover} alt={title} radius={18} style={{ width:'100%', height:'100%' }} />
        <div style={{ position:'absolute', inset:0, borderRadius:18, background:'linear-gradient(180deg, transparent 45%, #000b)', pointerEvents:'none' }} />
        <div className="media-actions" style={{ position:'absolute', inset:0, borderRadius:18 }}>
          {(onFav || onMenu) && (
            <div style={{ position:'absolute', top:8, right:8, display:'flex', gap:6 }}>
              {onFav && <button aria-label="Me gusta" onClick={e => { e.stopPropagation(); onFav(); }} className="press glass" style={{ width:28, height:28, borderRadius:'50%', background:'#0b0f16cc', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Heart c={faved ? T.accent : '#fff'} filled={faved} sz={15} /></button>}
              {onMenu && <button aria-label="Más" onClick={e => { e.stopPropagation(); onMenu(); }} className="press glass" style={{ width:28, height:28, borderRadius:'50%', background:'#0b0f16cc', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Dots c="#fff" sz={15} /></button>}
            </div>
          )}
          {onPlay && <button aria-label="Reproducir" onClick={e => { e.stopPropagation(); onPlay(); }} className="btn-tap" style={{ position:'absolute', bottom:8, right:8, width:36, height:36, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 4px 14px ${hex2rgba(T.accent,.6)}` }}><Icon.Play c="#04060a" sz={18} /></button>}
        </div>
      </div>
      <div onClick={onClick} style={{ fontSize:11.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }}>{title}</div>
      <div style={{ fontSize:9.5, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{subtitle}</div>
    </div>
  );
}

function RangeSlider({ value, min, max, onChange, accent, step=1, ariaLabel }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ position:'relative', height:14, display:'flex', alignItems:'center' }}>
      <div style={{ position:'absolute', left:0, right:0, height:4, background:'var(--surf-2)', borderRadius:99 }} />
      <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:4, width:`${pct}%`, background:accent, borderRadius:99, boxShadow:`0 0 8px ${accent}` }} />
      <input type="range" min={min} max={max} step={step} value={value} aria-label={ariaLabel} onChange={e => onChange(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
    </div>
  );
}

function SettingCard({ title, children, badge, accent }) {
  return (
    <div style={{ background:'var(--surf-0)', border:'1px solid var(--line-soft)', borderRadius:18, padding:17, marginBottom:11, boxShadow:'0 4px 14px #0003' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:13 }}>
        <div style={{ fontSize:10, fontWeight:900, letterSpacing:2, color:'var(--txt-1)', textTransform:'uppercase' }}>{title}</div>
        {badge && <span style={{ fontSize:12, fontWeight:800, fontFamily:'monospace', color:accent }}>{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, desc, on, onToggle, T }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'7px 0' }}>
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)' }}>{label}</div>
        {desc && <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2 }}>{desc}</div>}
      </div>
      <button aria-label={label} role="switch" aria-checked={on} onClick={onToggle} className="press" style={{ width:46, height:26, borderRadius:99, flexShrink:0, cursor:'pointer', position:'relative', background: on ? grad(T) : 'var(--surf-2)', border:'none', boxShadow: on ? `0 0 12px ${hex2rgba(T.accent,.5)}` : 'none', transition:'background .25s' }}>
        <div style={{ position:'absolute', top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:'50%', background:'#fff', transition:'left .25s cubic-bezier(.22,1,.36,1)', boxShadow:'0 2px 5px #0007' }} />
      </button>
    </div>
  );
}

function Row({ label, tracks, T, play, onFav, onMenu, favs }) {
  if (!tracks || !tracks.length) return null;
  const ids = tracks.map(x => x.id);
  return (
    <>
      <SectionHeader label={label} accent={T.accent} />
      <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
        {tracks.map(t => (
          <MediaCard key={t.id} cover={t.cover} title={t.title} subtitle={t.artist} T={T}
            onClick={() => play(t, ids)} onPlay={() => play(t, ids)}
            onFav={onFav ? () => onFav(t.id) : undefined} faved={favs ? favs.includes(t.id) : false}
            onMenu={onMenu ? () => onMenu(t.id) : undefined} />
        ))}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUTH SCREEN — login / registro
// ═══════════════════════════════════════════════════════════════
function AuthScreen({ onAuthed, T }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setOkMsg(''); setBusy(true);
    try {
      if (mode === 'register') {
        await api.register(email, password);
        await api.login(email, password);
      } else {
        await api.login(email, password);
      }
      onAuthed(email);
    } catch (e2) {
      setErr(e2.message || 'No se pudo completar la operación.');
    } finally { setBusy(false); }
  };

  const input = { width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:14, padding:'13px 15px', fontSize:14, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif', marginBottom:12 };

  return (
    <div style={{ minHeight:'100dvh', background:`radial-gradient(circle at 30% 0%, #0d1320, #04060a 60%)`, display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:'Inter,sans-serif' }}>
      <div className="fade-up" style={{ width:'min(420px, 100%)', background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:28, padding:'34px 28px', boxShadow:`0 30px 90px #000c, 0 0 40px ${hex2rgba(T.accent,.1)}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:26 }}>
          <div style={{ width:46, height:46, borderRadius:14, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 6px 20px ${hex2rgba(T.accent,.5)}` }}><Icon.Play c="#04060a" sz={22} /></div>
          <div>
            <div style={{ fontSize:20, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.4, lineHeight:1 }}>VELOCITY</div>
            <div style={{ fontSize:12, fontWeight:800, letterSpacing:5, color:T.accent }}>MUSIC</div>
          </div>
        </div>

        <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', marginBottom:4 }}>{mode==='login'?'Inicia sesión':'Crea tu cuenta'}</div>
        <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:22 }}>{mode==='login'?'Entra para acceder a tu música.':'Regístrate para guardar tu biblioteca.'}</div>

        <form onSubmit={submit}>
          <input style={input} type="email" placeholder="Correo electrónico" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required />
          <input style={input} type="password" placeholder="Contraseña" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='login'?'current-password':'new-password'} required />
          {mode==='register' && <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:-4, marginBottom:12, lineHeight:1.5 }}>Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.</div>}
          {err && <div style={{ fontSize:12, color:'#fb7185', marginBottom:12, fontWeight:600 }}>{err}</div>}
          {okMsg && <div style={{ fontSize:12, color:T.accent, marginBottom:12, fontWeight:600 }}>{okMsg}</div>}
          <button type="submit" disabled={busy} className="btn-tap" style={{ width:'100%', background:grad(T), border:'none', borderRadius:14, padding:'14px 0', cursor:'pointer', color:'#04060a', fontSize:14, fontWeight:800, boxShadow:`0 8px 24px ${hex2rgba(T.accent,.4)}`, display:'flex', alignItems:'center', justifyContent:'center', gap:10, opacity: busy?.7:1 }}>
            {busy && <Spinner c="#04060a" sz={18} />}{mode==='login'?'Entrar':'Registrarme'}
          </button>
        </form>

        <div style={{ textAlign:'center', marginTop:20, fontSize:12.5, color:'var(--txt-2)' }}>
          {mode==='login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button onClick={() => { setMode(mode==='login'?'register':'login'); setErr(''); }} style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontWeight:800, fontSize:12.5 }}>
            {mode==='login' ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MIX CARD — tarjeta de mezcla/playlist (collage de carátulas)
// ═══════════════════════════════════════════════════════════════
function MixCard({ mix, T, onPlay }) {
  const tracks = mix.tracks || [];
  // Collage 2x2 con hasta 4 carátulas distintas.
  let covers = [...new Set(tracks.map(t => t.cover).filter(c => c && !c.startsWith('data:')))].slice(0, 4);
  if (!covers.length) covers = [FALLBACK_COVER];
  while (covers.length < 4) covers.push(covers[covers.length - 1]);
  const artists = [...new Set(tracks.map(t => t.artist).filter(Boolean))].slice(0, 3).join(' · ');
  return (
    <div className="card-hover media-card" style={{ flexShrink:0, width:150 }}>
      <div onClick={onPlay} style={{ position:'relative', width:150, height:150, borderRadius:16, overflow:'hidden', marginBottom:9, cursor:'pointer', boxShadow:'0 8px 22px #0007' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr 1fr', width:'100%', height:'100%', gap:1 }}>
          {covers.map((c, i) => <img key={i} src={hiResCover(c)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />)}
        </div>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, transparent 40%, #000c)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:8, left:10, fontSize:8.5, fontWeight:900, letterSpacing:1.5, color:'#fff', textTransform:'uppercase', opacity:.9, textShadow:'0 1px 3px #000' }}>Mezcla</div>
        <button aria-label="Reproducir mezcla" onClick={e => { e.stopPropagation(); onPlay(); }} className="btn-tap" style={{ position:'absolute', bottom:8, right:8, width:38, height:38, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 4px 14px ${hex2rgba(T.accent,.6)}` }}><Icon.Play c="#04060a" sz={18} /></button>
      </div>
      <div onClick={onPlay} style={{ fontSize:12, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }}>{mix.label.replace(/^Mezcla · /, '')}</div>
      <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{artists || `${tracks.length} canciones`}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME TAB
// ═══════════════════════════════════════════════════════════════
function HomeTab({ ctx }) {
  const { track, playing, play, T, recent, homeRows, homeLoading, favs, toggleFav, onMenu } = ctx;
  const recentTracks = dedupeByTitle(recent.map(trackById).filter(Boolean));
  const recentIds = recentTracks.map(t => t.id);
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22, paddingTop:4 }}>
        <div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>{greet}</div>
          <div style={{ fontSize:12.5, color:'var(--txt-2)', marginTop:4 }}>¿Qué quieres escuchar hoy?</div>
        </div>
        <div className="press" style={{ width:40, height:40, borderRadius:'50%', background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:900, color:'#04060a', flexShrink:0, boxShadow:`0 4px 16px ${hex2rgba(T.accent,.5)}` }}>{(ctx.email||'V')[0].toUpperCase()}</div>
      </div>

      {track && (
        <div onClick={() => play(track)} style={{ position:'relative', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.22)}, ${hex2rgba(T.accent2,.06)}), var(--surf-0)`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:22, padding:'15px 17px', marginBottom:24, display:'flex', alignItems:'center', gap:14, overflow:'hidden', boxShadow:`0 12px 34px ${hex2rgba(T.accent,.14)}`, cursor:'pointer' }}>
          <div style={{ position:'absolute', top:-30, right:-20, width:120, height:120, borderRadius:'50%', background:grad(T), filter:'blur(40px)', opacity:.35, pointerEvents:'none' }} />
          <img src={track.cover} alt="" style={{ width:56, height:56, borderRadius:14, objectFit:'cover', boxShadow:`0 0 22px ${hex2rgba(T.accent,.5)}`, position:'relative' }} />
          <div style={{ flex:1, minWidth:0, position:'relative' }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2, color:T.accent, textTransform:'uppercase', marginBottom:5 }}>{playing ? '◉ Reproduciendo' : 'Última pista'}</div>
            <div style={{ fontSize:15.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
            <div style={{ fontSize:11, color:'var(--txt-1)', marginTop:2 }}>{track.artist}</div>
          </div>
          {playing && <EQViz color={T.accent} color2={T.accent2} playing={playing} bars={6} h={28} />}
        </div>
      )}

      {recentTracks.length > 0 && (
        <>
          <SectionHeader label="Escuchado Recientemente" accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
            {recentTracks.map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, recentIds)} onPlay={() => play(t, recentIds)} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
          </div>
        </>
      )}

      {homeLoading && homeRows.length === 0 && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:'40px 0', color:'var(--txt-2)' }}>
          <Spinner c={T.accent} sz={26} /><span style={{ fontSize:12.5 }}>Cargando música…</span>
        </div>
      )}

      {homeRows.map(sec => (
        <div key={sec.section}>
          <SectionHeader label={sec.section} accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:20 }}>
            {(sec.mixes || []).map(mix => (
              <MixCard key={mix.label} mix={mix} T={T}
                onPlay={() => { const ids = mix.tracks.map(t => t.id); play(mix.tracks[0], ids); }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEARCH TAB
// ═══════════════════════════════════════════════════════════════
function SearchTab({ ctx }) {
  const { track, playing, play, T, favs, toggleFav, addToTarget, onMenu, recentSearches, addSearch, removeSearch, downloaded, downloading, goArtist, goAlbum, selecting, selection, toggleSelect, startSelection } = ctx;
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ songs: [], albums: [], artists: [] });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes({ songs: [], albums: [], artists: [] }); setErr(''); setLoading(false); return; }
    setLoading(true); setErr('');
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const d = await api.searchAll(term, ctrl.signal);
        setRes({ songs: dedupeByTitle((d.songs || []).map(normalizeTrack)), albums: d.albums || [], artists: d.artists || [] });
      } catch (e) {
        if (e.name !== 'AbortError') {
          try { const raw = await api.search(term, ctrl.signal); setRes({ songs: dedupeByTitle(raw.map(normalizeTrack)), albums: [], artists: [] }); }
          catch { setErr('No se pudo buscar. ¿El backend está activo?'); }
        }
      } finally { setLoading(false); }
    }, 380);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q]);

  const runGenre = (g) => { setQ(g.q); addSearch(g.label); };
  const empty = !res.songs.length && !res.albums.length && !res.artists.length;

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginBottom:18, paddingTop:4 }}>Explorar</div>

      <div style={{ position:'relative', marginBottom:22 }}>
        <div style={{ position:'absolute', left:15, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
          {loading ? <Spinner c={T.accent} sz={17} /> : <Icon.Search c={q ? T.accent : 'var(--txt-2)'} sz={17} />}
        </div>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onBlur={() => q.trim() && addSearch(q.trim())}
          placeholder="Artistas, canciones, álbumes…"
          style={{ width:'100%', background:'var(--surf-0)', border:`1px solid ${q ? hex2rgba(T.accent,.45) : 'var(--line-soft)'}`, borderRadius:16, padding:'13px 40px 13px 44px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif', transition:'border .2s, box-shadow .2s', boxShadow: q ? `0 0 0 4px ${hex2rgba(T.accent,.1)}` : 'none' }} />
        {q && <button aria-label="Limpiar" onClick={() => setQ('')} className="press" style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-2)" sz={16} /></button>}
      </div>

      {q ? (
        <>
          {err && <div style={{ textAlign:'center', color:'#fb7185', fontSize:12.5, paddingTop:20 }}>{err}</div>}
          {!loading && !err && empty && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:36 }}>Sin resultados para "{q}"</div>}

          {res.artists.length > 0 && (<>
            <SectionHeader label="Artistas" accent={T.accent} />
            <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
              {res.artists.map(a => (
                <div key={a.artistId} onClick={() => { goArtist(a.artistId, a.name); addSearch(a.name); }} className="card-hover" style={{ flexShrink:0, width:104, cursor:'pointer', textAlign:'center' }}>
                  <CoverImg src={a.thumbnail} alt={a.name} radius={999} style={{ width:104, height:104, borderRadius:'50%', boxShadow:'0 8px 22px #0007' }} />
                  <div style={{ fontSize:11.5, fontWeight:700, color:'var(--txt-0)', marginTop:8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.name}</div>
                  <div style={{ fontSize:9.5, color:'var(--txt-2)' }}>Artista</div>
                </div>
              ))}
            </div>
          </>)}

          {res.albums.length > 0 && (<>
            <SectionHeader label="Álbumes" accent={T.accent} />
            <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
              {res.albums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={`${a.artist || 'Álbum'}${a.year ? ' · ' + a.year : ''}`} T={T} onClick={() => goAlbum(a.albumId, a.name, a.artist)} />)}
            </div>
          </>)}

          {res.songs.length > 0 && (<>
            <SectionHeader label="Canciones" accent={T.accent} action={!selecting && <button onClick={() => startSelection()} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Seleccionar</button>} />
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {res.songs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => { play(t, [t.id], { radio: true }); addSearch(q.trim()); }} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} />)}
            </div>
          </>)}
        </>
      ) : (
        <>
          {recentSearches.length > 0 && (
            <>
              <SectionHeader label="Búsquedas Recientes" accent={T.accent} />
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:22 }}>
                {recentSearches.map(s => (
                  <div key={s} onClick={() => setQ(s)} className="press" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'7px 12px', cursor:'pointer' }}>
                    <Icon.Clock c="var(--txt-2)" sz={13} />
                    <span style={{ fontSize:12, fontWeight:600, color:'var(--txt-0)' }}>{s}</span>
                    <button aria-label="Quitar" onClick={e => { e.stopPropagation(); removeSearch(s); }} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex' }}><Icon.X c="var(--txt-3)" sz={13} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
          <SectionHeader label="Explorar Géneros" accent={T.accent} />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:11 }}>
            {GENRES.map((g,i) => (
              <div key={g.label} onClick={() => runGenre(g)} className="card-hover fade-up" style={{ height:76, borderRadius:18, cursor:'pointer', overflow:'hidden', position:'relative', background:`linear-gradient(135deg, ${g.color}40, ${g.color}0a)`, border:`1px solid ${g.color}30`, animationDelay:`${i*.04}s`, display:'flex', alignItems:'flex-end', padding:'12px 14px', boxShadow:`0 6px 18px ${g.color}1f` }}>
                <div style={{ position:'absolute', top:-14, right:-14, width:60, height:60, background:g.color, borderRadius:'50%', opacity:.3, filter:'blur(8px)' }} />
                <span style={{ fontSize:12.5, fontWeight:800, color:'#fff', position:'relative' }}>{g.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LIBRARY TAB
// ═══════════════════════════════════════════════════════════════
function LibraryTab({ ctx }) {
  const { track, playing, play, T, favs, toggleFav, playlists, createPlaylist,
          removeFromPlaylist, deletePlaylist, openPlaylist, setOpenPlaylist, addToTarget, onMenu, downloaded, downloading, downloadMany, savedAlbums, goAlbum, selecting, selection, toggleSelect, startSelection } = ctx;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  if (openPlaylist) {
    const isLiked = openPlaylist === 'liked';
    const pl = isLiked ? { name:'Me gusta', trackIds:favs } : playlists.find(p => p.id === openPlaylist);
    if (!pl) { setOpenPlaylist(null); return null; }
    const list = pl.trackIds.map(trackById).filter(Boolean);
    const missing = pl.trackIds.length - list.length;
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <button onClick={() => setOpenPlaylist(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:16, paddingTop:4, fontSize:13, fontWeight:700 }}>
          <Icon.ChevL c="var(--txt-1)" sz={18} /> Biblioteca
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
          <div style={{ width:96, height:96, borderRadius:18, background: isLiked ? grad(T) : 'var(--surf-1)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 12px 30px ${hex2rgba(T.accent,.3)}`, overflow:'hidden', flexShrink:0 }}>
            {isLiked ? <Icon.Heart c="#04060a" filled sz={40} /> : <Icon.List c={T.accent} sz={38} />}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.5 }}>{pl.name}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:4 }}>{pl.trackIds.length} {pl.trackIds.length===1?'canción':'canciones'}</div>
            <div style={{ display:'flex', gap:8, marginTop:12 }}>
              {list.length > 0 && <button onClick={() => play(list[0], pl.trackIds)} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'9px 20px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>}
              {pl.trackIds.length > 0 && <DownloadAllButton ids={pl.trackIds} downloaded={downloaded} downloading={downloading} onClick={() => downloadMany(pl.trackIds)} T={T} />}
              {!isLiked && <button onClick={() => { deletePlaylist(pl.id); setOpenPlaylist(null); }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'9px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Trash c="var(--txt-1)" sz={15} /> Eliminar</button>}
            </div>
          </div>
        </div>
        {pl.trackIds.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>Esta playlist está vacía. Añade canciones con el botón +.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {list.map(t => (
              <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T}
                onClick={() => play(t, pl.trackIds)}
                onFav={toggleFav} faved={favs.includes(t.id)} onMenu={onMenu}
                downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)}
                selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect}
                onRemove={isLiked ? undefined : (id => removeFromPlaylist(pl.id, id))} />
            ))}
            {missing > 0 && <div style={{ fontSize:11, color:'var(--txt-3)', textAlign:'center', paddingTop:10 }}>{missing} pista(s) sin metadatos guardados en este dispositivo.</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:4 }}>
        <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>Tu Biblioteca</div>
        <button aria-label="Crear playlist" onClick={() => setCreating(c=>!c)} className="press" style={{ width:36, height:36, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Plus c={T.accent} sz={20} /></button>
      </div>
      <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:18, marginTop:4 }}>{playlists.length + 1} playlists</div>

      {creating && (
        <form onSubmit={e => { e.preventDefault(); if (name.trim()) { createPlaylist(name.trim()); setName(''); setCreating(false); } }} style={{ display:'flex', gap:8, marginBottom:16 }}>
          <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la playlist" style={{ flex:1, background:'var(--surf-0)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:12, padding:'10px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
          <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:12, padding:'0 16px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Crear</button>
        </form>
      )}

      <div onClick={() => setOpenPlaylist('liked')} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.14)}, ${hex2rgba(T.accent2,.04)})`, border:`1px solid ${hex2rgba(T.accent,.25)}`, marginBottom:6 }}>
        <div style={{ width:46, height:46, borderRadius:12, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 4px 14px ${hex2rgba(T.accent,.4)}` }}><Icon.Heart c="#04060a" filled sz={22} /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)' }}>Me gusta</div>
          <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist · {favs.length} canciones</div>
        </div>
        <Icon.ChevL c="var(--txt-3)" sz={18} />
      </div>

      {playlists.map(p => (
        <div key={p.id} onClick={() => setOpenPlaylist(p.id)} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', border:'1px solid transparent', marginBottom:2 }}>
          <div style={{ width:46, height:46, borderRadius:12, background:'var(--surf-1)', border:'1px solid var(--line-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={20} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist · {p.trackIds.length} canciones</div>
          </div>
          <Icon.ChevL c="var(--txt-3)" sz={18} />
        </div>
      ))}

      {savedAlbums && savedAlbums.length > 0 && (
        <>
          <SectionHeader label="Álbumes Guardados" accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6 }}>
            {savedAlbums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={a.artist || 'Álbum'} T={T} onClick={() => goAlbum(a.albumId, a.name, a.artist)} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE / YO TAB
// ═══════════════════════════════════════════════════════════════
function ProfileTab({ ctx }) {
  const { T, themeKey, setThemeKey, quality, setQuality, glow, setGlow, eq, setEq,
          settings, setSettings, favs, setOpenPlaylist, setTab, email, onLogout } = ctx;
  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginBottom:20, paddingTop:4 }}>Yo</div>

      <div style={{ position:'relative', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.18)}, ${hex2rgba(T.accent2,.05)}), var(--surf-0)`, border:`1px solid ${hex2rgba(T.accent,.24)}`, borderRadius:22, padding:19, marginBottom:14, display:'flex', alignItems:'center', gap:15, overflow:'hidden', boxShadow:`0 12px 30px ${hex2rgba(T.accent,.14)}` }}>
        <div style={{ position:'absolute', top:-30, right:-10, width:110, height:110, borderRadius:'50%', background:grad(T), filter:'blur(40px)', opacity:.3 }} />
        <div style={{ width:52, height:52, borderRadius:'50%', background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:900, color:'#04060a', flexShrink:0, boxShadow:`0 4px 18px ${hex2rgba(T.accent,.5)}`, position:'relative' }}>{(email||'V')[0].toUpperCase()}</div>
        <div style={{ position:'relative', minWidth:0 }}>
          <div style={{ fontWeight:900, fontSize:15, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:180 }}>{email || 'Usuario'}</div>
          <span style={{ display:'inline-block', marginTop:8, fontSize:8.5, fontWeight:900, color:'#04060a', background:grad(T), borderRadius:20, padding:'3px 11px', letterSpacing:1.5, textTransform:'uppercase' }}>PRO MEMBER</span>
        </div>
      </div>

      <SettingCard title="Color de Acento">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:9 }}>
          {Object.entries(THEMES).map(([key, th]) => (
            <button key={key} aria-label={th.name} onClick={() => setThemeKey(key)} className="btn-tap" style={{ height:44, borderRadius:14, background: key===themeKey ? hex2rgba(th.accent,.16) : 'var(--surf-1)', border:`2px solid ${key===themeKey ? th.accent : 'var(--line-soft)'}`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <div style={{ width:18, height:18, borderRadius:'50%', background:`linear-gradient(135deg, ${th.accent}, ${th.accent2})`, boxShadow: key===themeKey ? `0 0 12px ${th.accent}` : 'none' }} />
            </button>
          ))}
        </div>
        <div style={{ fontSize:11, color:T.accent, fontWeight:800, textAlign:'center', marginTop:11 }}>{THEMES[themeKey].name}</div>
      </SettingCard>

      <SettingCard title="Calidad de Audio">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
          {['Standard','HQ','FLAC'].map(qz => (
            <button key={qz} onClick={() => setQuality(qz)} className="btn-tap" style={{ padding:'10px 0', borderRadius:13, fontSize:11, fontWeight:800, background: qz===quality ? grad(T) : 'var(--surf-1)', color: qz===quality ? '#04060a' : 'var(--txt-2)', border: `1px solid ${qz===quality ? 'transparent' : 'var(--line-soft)'}`, cursor:'pointer', boxShadow: qz===quality ? `0 4px 14px ${hex2rgba(T.accent,.4)}` : 'none' }}>{qz}</button>
          ))}
        </div>
      </SettingCard>

      <SettingCard title="Intensidad de Glow" badge={`${glow}%`} accent={T.accent}>
        <RangeSlider value={glow} min={10} max={100} onChange={setGlow} accent={T.accent} ariaLabel="Glow" />
      </SettingCard>

      <SettingCard title="Reproducción">
        <ToggleRow label="Reproducción automática" desc="Continúa al terminar la pista" on={settings.autoplay} onToggle={() => set('autoplay', !settings.autoplay)} T={T} />
        <ToggleRow label="Normalizar volumen" desc="Mismo nivel en todas las pistas" on={settings.normalize} onToggle={() => set('normalize', !settings.normalize)} T={T} />
        <div style={{ marginTop:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
            <span style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)' }}>Crossfade</span>
            <span style={{ fontSize:11, fontWeight:800, fontFamily:'monospace', color:T.accent }}>{settings.crossfade}s</span>
          </div>
          <RangeSlider value={settings.crossfade} min={0} max={12} onChange={v => set('crossfade', v)} accent={T.accent} ariaLabel="Crossfade" />
        </div>
      </SettingCard>

      <button onClick={onLogout} className="btn-tap" style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:16, padding:'14px 0', cursor:'pointer', color:'#fb7185', fontSize:13, fontWeight:800, marginTop:6 }}>
        <Icon.Out c="#fb7185" sz={17} /> Cerrar sesión
      </button>

      <div style={{ textAlign:'center', fontSize:9.5, color:'var(--txt-3)', marginTop:16 }}>VELOCITY MUSIC · v1.0</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADD TO PLAYLIST MODAL
// ═══════════════════════════════════════════════════════════════
function AddToPlaylistModal({ trackId, onClose, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, T }) {
  const [name, setName] = useState('');
  if (trackId == null) return null;
  const ids = Array.isArray(trackId) ? trackId : [trackId];
  if (!ids.length) return null;
  const multi = ids.length > 1;
  const tk = trackById(ids[0]);
  const addAll = (pid) => ids.forEach(id => addToPlaylist(pid, id));
  const removeAll = (pid) => ids.forEach(id => removeFromPlaylist(pid, id));
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:120 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:121, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Añadir a playlist</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
        </div>
        <div style={{ fontSize:11.5, color:'var(--txt-2)', marginBottom:16 }}>{multi ? `${ids.length} canciones seleccionadas` : `${tk?.title} · ${tk?.artist}`}</div>
        <form onSubmit={async e => { e.preventDefault(); if (name.trim()) { const id = await createPlaylist(name.trim()); if (id) addAll(id); setName(''); onClose(); } }} style={{ display:'flex', gap:8, marginBottom:16 }}>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nueva playlist…" style={{ flex:1, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'10px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
          <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:12, padding:'0 14px', cursor:'pointer', color:'#04060a', display:'flex', alignItems:'center' }}><Icon.Plus c="#04060a" sz={18} /></button>
        </form>
        {playlists.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:12.5, padding:'18px 0' }}>Aún no tienes playlists. Crea una arriba.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {playlists.map(p => {
              const has = multi ? ids.every(id => p.trackIds.includes(id)) : p.trackIds.includes(ids[0]);
              return (
                <button key={p.id} onClick={() => { has ? removeAll(p.id) : addAll(p.id); if (multi) onClose(); }} className="press" style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 12px', borderRadius:14, background: has ? hex2rgba(T.accent,.1) : 'var(--surf-1)', border:`1px solid ${has ? hex2rgba(T.accent,.35) : 'var(--line-soft)'}`, cursor:'pointer', textAlign:'left' }}>
                  <div style={{ width:38, height:38, borderRadius:10, background:'var(--surf-2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={17} /></div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)' }}>{p.name}</div>
                    <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2 }}>{p.trackIds.length} canciones</div>
                  </div>
                  {has && <Icon.Check c={T.accent} sz={20} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOOK: extrae color dominante de una imagen via Canvas API
// Devuelve { r, g, b, hex, isDark } del color más vibrante de la portada.
// ═══════════════════════════════════════════════════════════════
function useDominantColor(src) {
  const [color, setColor] = useState(null);
  useEffect(() => {
    if (!src || src.startsWith('data:')) { setColor(null); return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 64; // muestrear a resolución pequeña = rápido
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        // Acumular colores descartando muy oscuros y muy claros (grises)
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        let bestSat = -1, bestR = 0, bestG = 0, bestB = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          const brightness = (r + g + b) / 3;
          if (brightness < 20 || brightness > 235) continue; // descartar negro/blanco puro
          // Saturación: diferencia entre max y min canal
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat > bestSat) { bestSat = sat; bestR = r; bestG = g; bestB = b; }
          rSum += r; gSum += g; bSum += b; count++;
        }
        if (!count) { setColor(null); return; }
        // Si hay un color muy saturado, usarlo; si no, usar el promedio
        const useVibrant = bestSat > 0.35;
        const r = useVibrant ? bestR : Math.round(rSum / count);
        const g = useVibrant ? bestG : Math.round(gSum / count);
        const b = useVibrant ? bestB : Math.round(bSum / count);
        // Amplificar saturación para que se vea bien sobre fondo oscuro
        const brightness = (r + g + b) / 3;
        const isDark = brightness < 128;
        const hex = '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
        setColor({ r, g, b, hex, isDark });
      } catch { setColor(null); }
    };
    img.onerror = () => { if (!cancelled) setColor(null); };
    // Usar URL directa o proxy para evitar problemas CORS con el canvas
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return color;
}

// ═══════════════════════════════════════════════════════════════
// EXPANDED PLAYER
// ═══════════════════════════════════════════════════════════════
function ExpandedPlayer({ open, onClose, track, playing, togglePlay, next, prev, time, dur, seek,
  vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved, toggleFav, T, quality, glow, compact, desktop, onAdd, onMenu, loadingAudio, onQueue, outputs, sinkId, setOutput, lyricOffset = 0, setLyricOffset, audioRef }) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricState, setLyricState] = useState({ status:'idle', synced:[], plain:[] });
  const lyricBoxRef = useRef(null);
  // Tiempo de alta frecuencia para la sincronía de la letra.
  // El evento timeUpdate del <audio> solo dispara ~4 veces/seg, lo que hace que
  // el resaltado vaya a saltos. Aquí leemos currentTime a ~15 Hz mientras la
  // letra está abierta y reproduciendo, para un seguimiento fluido y preciso.
  const [lyricTime, setLyricTime] = useState(0);
  useEffect(() => {
    if (!showLyrics) return;
    const read = () => { const a = audioRef?.current; if (a) setLyricTime(a.currentTime || 0); };
    read();
    const id = setInterval(read, 66);
    return () => clearInterval(id);
  }, [showLyrics, audioRef, playing, track?.id]);
  // Tiempo efectivo: el de alta frecuencia si la letra está abierta, si no el prop.
  const effTime = showLyrics ? lyricTime : time;
  // Color dominante extraído de la portada actual
  const dominantColor = useDominantColor(track?.cover);
  const ambientHex = dominantColor?.hex || T.accent;
  const ambientR = dominantColor?.r ?? parseInt(T.accent.slice(1,3),16);
  const ambientG = dominantColor?.g ?? parseInt(T.accent.slice(3,5),16);
  const ambientB = dominantColor?.b ?? parseInt(T.accent.slice(5,7),16);
  const ambientRgba = (a) => `rgba(${ambientR},${ambientG},${ambientB},${a})`;

  useEffect(() => { if (!open) setShowLyrics(false); }, [open]);
  useEffect(() => {
    if (!showLyrics || !track) return;
    let cancel = false;
    setLyricState({ status:'loading', synced:[], plain:[] });
    const base = { artist: track.artist, title: track.title, album: track.album, duration: track.durationSeconds, id: track.id };
    api.lyrics(base)
      .then(d => {
        if (cancel) return;
        if (!d) { setLyricState(s => s.status === 'ok' ? s : { status:'none', synced:[], plain:[] }); return; }
        const synced = parseLRC(d.synced);
        const plain = (d.plain || '').split(/\r?\n/);
        setLyricState(s => (s.status === 'ok' && s.synced.length && !synced.length) ? s : { status:'ok', synced, plain, source: d.source });
      })
      .catch(() => { if (!cancel) setLyricState(s => s.status === 'ok' ? s : { status:'none', synced:[], plain:[] }); });
    api.lyrics({ ...base, sync: true })
      .then(d => {
        if (cancel || !d || !d.synced) return;
        const synced = parseLRC(d.synced);
        if (synced.length) setLyricState(prev => ({ status:'ok', synced, plain: (prev.plain && prev.plain.length) ? prev.plain : (d.plain || '').split(/\r?\n/), source: 'lrclib' }));
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [showLyrics, track?.id]);

  const activeLyric = useMemo(() => {
    if (!lyricState.synced || !lyricState.synced.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyricState.synced.length; i++) { if (lyricState.synced[i].t <= effTime + lyricOffset) idx = i; else break; }
    return idx;
  }, [lyricState, effTime, lyricOffset]);

  useEffect(() => {
    if (activeLyric < 0 || !lyricBoxRef.current) return;
    const box = lyricBoxRef.current;
    const el = box.querySelector(`[data-li="${activeLyric}"]`);
    if (el) {
      // Scroll SOLO dentro de la caja de letra (no del panel completo),
      // centrando la línea activa. Evita saltos bruscos de toda la UI.
      const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [activeLyric]);

  if (!track) return null;
  const pct = dur > 0 ? (time / dur) * 100 : 0;
  const glowF = glow / 100;
  const art = desktop ? 'clamp(170px, 32vh, 300px)' : 'min(80vw, 360px)';
  const pad = compact ? 'calc(env(safe-area-inset-top, 14px) + 18px) 22px calc(env(safe-area-inset-bottom, 16px) + 26px)' : '52px 26px 36px';

  const panelBg = desktop
    ? `radial-gradient(120% 80% at 50% 0%, ${ambientRgba(.16)}, transparent 60%), var(--surf-0)`
    : `radial-gradient(120% 80% at 50% 0%, ${ambientRgba(.12)}, transparent 60%), var(--bg-0)`;

  const panelStyle = desktop ? {
    position:'fixed', top:'50%', left:'50%', transform:`translate(-50%,-50%) scale(${open?1:.95})`,
    width:'min(440px, 92vw)', maxHeight:'94vh', background: panelBg,
    border:'1px solid var(--line)', borderRadius:30, boxShadow:'0 40px 110px #000e',
    opacity: open?1:0, pointerEvents: open?'auto':'none',
    transition:'transform .42s cubic-bezier(.22,1,.36,1), opacity .3s ease, background 1.4s ease',
    zIndex:90, display:'flex', flexDirection:'column', padding:'22px 26px 26px', overflow:'hidden',
  } : {
    position:'absolute', inset:0, background: panelBg,
    transform: open ? 'translateY(0)' : 'translateY(100%)', opacity: open ? 1 : 0,
    transition:'transform .46s cubic-bezier(.22,1,.36,1), opacity .3s ease, background 1.4s ease',
    zIndex:90, display:'flex', flexDirection:'column', padding:pad, overflowY:'auto',
  };

  return (
    <>
      {desktop && <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060ad9', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', opacity: open?1:0, pointerEvents: open?'auto':'none', transition:'opacity .3s ease', zIndex:89 }} />}
      <div style={panelStyle}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexShrink:0 }}>
          <button aria-label="Cerrar" onClick={onClose} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.ChevD c="var(--txt-1)" sz={18} /></button>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:3, color:'var(--txt-2)', textTransform:'uppercase' }}>Reproduciendo desde</div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--txt-0)', marginTop:3 }}>{track.album}</div>
          </div>
          <button aria-label="Me gusta" onClick={() => toggleFav(track.id)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Heart c={T.accent} filled={faved} sz={22} /></button>
        </div>

        <div style={{ display:'flex', gap:6, background:'var(--surf-1)', borderRadius:12, padding:4, marginBottom:16, flexShrink:0, alignSelf:'center' }}>
          {[['Portada',false],['Letra',true]].map(([lbl,val]) => (
            <button key={lbl} onClick={() => setShowLyrics(val)} className="press" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:9, border:'none', cursor:'pointer', background: showLyrics===val ? grad(T) : 'transparent', color: showLyrics===val ? '#04060a' : 'var(--txt-2)', fontSize:11, fontWeight:800 }}>
              {val ? <Icon.Mic c={showLyrics===val?'#04060a':'var(--txt-2)'} sz={14} /> : <Icon.Play c={showLyrics===val?'#04060a':'var(--txt-2)'} sz={13} />}{lbl}
            </button>
          ))}
        </div>

        {!showLyrics ? (
          <div style={{ position:'relative', display:'flex', justifyContent:'center', marginBottom:22, flexShrink:0 }}>
            {/* Halo de ambiente: color de la portada, animación breathe original */}
            <div className="breathe" style={{ position:'absolute', width:`calc(${art} * 1.25)`, height:`calc(${art} * 1.25)`, borderRadius:'50%', background: dominantColor ? `radial-gradient(circle, ${ambientRgba(.7)}, ${ambientRgba(.3)} 50%, transparent 75%)` : grad(T), filter:'blur(70px)', opacity: playing ? .25 + glowF*.35 : .1, top:'50%', left:'50%', transition:'opacity .6s ease, background 1.4s ease', pointerEvents:'none' }} />
            <div style={{ position:'relative', width:art, height:art, borderRadius:28, boxShadow: playing ? `0 0 ${24+glowF*44}px ${ambientRgba(.28+glowF*.3)}, 0 30px 70px #000c` : '0 30px 70px #000c', transition:'box-shadow 1.4s ease, transform .55s ease', transform: playing ? 'scale(1)' : 'scale(.97)', overflow:'hidden', flexShrink:0 }}>
              <CoverImg src={track.cover} alt={track.title} radius={28} style={{ width:'100%', height:'100%' }} />
              {/* brillo/cristal sutil — igual que antes */}
              <div style={{ position:'absolute', inset:0, borderRadius:28, boxShadow:'inset 0 1px 0 #ffffff22, inset 0 0 0 1px #ffffff10', background:'linear-gradient(160deg, #ffffff14 0%, transparent 28%)', pointerEvents:'none' }} />
              <div style={{ position:'absolute', inset:0, borderRadius:28, background:'linear-gradient(180deg, transparent 55%, #000a)', pointerEvents:'none' }} />
              {loadingAudio && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'#0006' }}><Spinner c="#fff" sz={32} /></div>}
            </div>
          </div>
        ) : (
          <div ref={lyricBoxRef} style={{ position:'relative', height:art, overflowY:'auto', marginBottom:22, padding:'16px 6px', textAlign:'center', flexShrink:0 }}>
            {lyricState.status === 'loading' && <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, paddingTop:'28%', color:'var(--txt-2)' }}><Spinner c={T.accent} sz={22} /><span style={{ fontSize:13 }}>Buscando letra…</span></div>}
            {lyricState.status === 'none' && <div style={{ fontSize:13, color:'var(--txt-2)', paddingTop:'30%' }}>Letra no disponible para esta pista.</div>}
            {lyricState.status === 'ok' && lyricState.synced.length > 0 && (<>
              {lyricState.synced.map((l, i) => (
                <div key={i} data-li={i} style={{ fontSize: i===activeLyric ? 17 : 14.5, fontWeight: i===activeLyric ? 800 : 600, color: i===activeLyric ? T.accent : (i < activeLyric ? 'var(--txt-2)' : 'var(--txt-1)'), margin:'9px 0', lineHeight:1.4, transition:'all .25s ease' }}>{l.text || '♪'}</div>
              ))}
              {setLyricOffset && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:16 }}>
                  <button aria-label="Atrasar letra" onClick={() => setLyricOffset(o => Math.round((o - 0.5) * 10) / 10)} className="press" style={{ width:30, height:30, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:16, fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontSize:10.5, color:'var(--txt-2)', fontWeight:700, minWidth:90, textAlign:'center' }}>Sincronía {lyricOffset>0?'+':''}{lyricOffset.toFixed(1)}s</span>
                  <button aria-label="Adelantar letra" onClick={() => setLyricOffset(o => Math.round((o + 0.5) * 10) / 10)} className="press" style={{ width:30, height:30, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:16, fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              )}
              <div style={{ fontSize:9.5, color:'var(--txt-3)', marginTop:8 }}>Letra sincronizada · {lyricState.source}</div>
            </>)}
            {lyricState.status === 'ok' && lyricState.synced.length === 0 && (<>
              {lyricState.plain.map((line, i) => <div key={i} style={{ fontSize:14.5, fontWeight:600, color:'var(--txt-0)', margin:'7px 0', lineHeight:1.5 }}>{line || '♪'}</div>)}
              <div style={{ fontSize:9.5, color:'var(--txt-3)', marginTop:14 }}>Letra · {lyricState.source}</div>
            </>)}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexShrink:0 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:21, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
            <div style={{ fontSize:13, color:T.accent, marginTop:5, fontWeight:700 }}>{track.artist}</div>
          </div>
          {onAdd && <button aria-label="Añadir" onClick={() => onAdd(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', marginRight:10, flexShrink:0 }}><Icon.Plus c="var(--txt-1)" sz={18} /></button>}
          {onMenu && <button aria-label="Más" onClick={() => onMenu(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.Dots c="var(--txt-1)" sz={18} /></button>}
        </div>

        <div style={{ marginBottom:18, flexShrink:0 }}>
          <div style={{ position:'relative', height:16, display:'flex', alignItems:'center', marginBottom:4 }}>
            <div style={{ position:'absolute', left:0, right:0, height:5, background:'var(--surf-2)', borderRadius:99 }} />
            <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 10px ${hex2rgba(T.accent,.6)}`, transition:'width .12s linear' }} />
            <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--txt-2)', fontWeight:700, fontFamily:'monospace' }}><span>{fmt(time)}</span><span>{fmt(dur)}</span></div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, flexShrink:0 }}>
          <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle ? 1 : .3 }}><Icon.Shuf c={shuffle ? T.accent : 'var(--txt-1)'} sz={18} /></button>
          <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={24} /></button>
          <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:64, height:64, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 ${20+glowF*26}px ${hex2rgba(T.accent,.55)}, 0 8px 24px #000a` }}>{loadingAudio ? <Spinner c="#04060a" sz={26} /> : (playing ? <Icon.Pause c="#04060a" sz={26} /> : <Icon.Play c="#04060a" sz={26} />)}</button>
          <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={24} /></button>
          <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat ? 1 : .3 }}><Icon.Rep c={repeat ? T.accent : 'var(--txt-1)'} sz={18} /></button>
        </div>

        <div className="glass" style={{ display:'flex', alignItems:'center', gap:13, background:'var(--surf-0)', border:'1px solid var(--line-soft)', borderRadius:16, padding:'12px 16px', flexShrink:0 }}>
          <Icon.Vol c="var(--txt-2)" sz={16} />
          <div style={{ flex:1 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div>
          <span style={{ fontSize:10, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:34, textAlign:'right' }}>{Math.round(vol*100)}%</span>
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:12, flexShrink:0 }}>
          <DeviceChip outputs={outputs} sinkId={sinkId} setOutput={setOutput} T={T} />
          <button aria-label="Cola de reproducción" onClick={onQueue} className="press" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'8px 14px', cursor:'pointer', color:'var(--txt-1)', fontSize:11.5, fontWeight:700 }}>
            <Icon.Queue c={T.accent} sz={16} /> En cola
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// DETAIL VIEW — artista / álbum (metadatos reales de YouTube Music)
// ═══════════════════════════════════════════════════════════════
function DetailView({ view, ctx }) {
  const { T, track, playing, play, favs, toggleFav, addToTarget, onMenu, goArtist, goAlbum, setView, detailLoading, detailData, downloaded, downloading, downloadMany, isAlbumSaved, saveAlbum, unsaveAlbum, selecting, selection, toggleSelect, startSelection } = ctx;
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [view]);
  const d = detailData && detailData.type === view.type ? detailData : null;

  const Back = () => (
    <button onClick={() => setView(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:18, paddingTop:4, fontSize:13, fontWeight:700 }}><Icon.ChevL c="var(--txt-1)" sz={18} /> Atrás</button>
  );

  if (view.type === 'artist') {
    const name = d?.name || view.name || 'Artista';
    const albums = d?.albums || [];
    const all = d?.topSongs || [];
    const songs = showAll ? all : all.slice(0, 25);
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <Back />
        <div style={{ display:'flex', alignItems:'center', gap:18, marginBottom:24 }}>
          <div style={{ width:108, height:108, borderRadius:'50%', overflow:'hidden', flexShrink:0, boxShadow:`0 14px 40px ${hex2rgba(T.accent,.4)}`, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center' }}>
            {d?.thumbnail ? <CoverImg src={d.thumbnail} alt={name} radius={999} style={{ width:'100%', height:'100%' }} /> : <span style={{ fontSize:42, fontWeight:900, color:'#04060a' }}>{name[0]}</span>}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Artista</div>
            <div style={{ fontSize:26, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{name}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:5 }}>{albums.length} álbum(es) · {all.length} canciones</div>
            {all.length > 0 && <button onClick={() => play(all[0], all.map(s=>s.id))} className="btn-tap" style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'9px 20px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>}
          </div>
        </div>
        {detailLoading && !d ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner c={T.accent} sz={24} /></div>
        ) : (
          <>
            {albums.length > 0 && <>
              <SectionHeader label="Álbumes" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, marginBottom:20 }}>
                {albums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={a.year ? String(a.year) : 'Álbum'} T={T} onClick={() => goAlbum(a.albumId, a.name, name)} />)}
              </div>
            </>}
            <SectionHeader label="Canciones populares" accent={T.accent} action={!selecting && <button onClick={() => startSelection()} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Seleccionar</button>} />
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {songs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, all.map(s=>s.id))} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} />)}
            </div>
            {!showAll && all.length > 25 && (
              <button onClick={() => setShowAll(true)} className="press" style={{ display:'block', margin:'16px auto 0', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:700 }}>Ver más canciones</button>
            )}
          </>
        )}
      </div>
    );
  }

  // álbum
  const name = d?.name || view.name || 'Álbum';
  const artist = d?.artist || view.artist;
  const songs = d?.tracks || [];
  const cover = d?.cover || songs[0]?.cover;
  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <Back />
      <div style={{ display:'flex', alignItems:'flex-end', gap:18, marginBottom:24 }}>
        <CoverImg src={cover} alt={name} radius={18} style={{ width:128, height:128, flexShrink:0, boxShadow:`0 16px 40px ${hex2rgba(T.accent,.3)}` }} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Álbum{d?.year ? ` · ${d.year}` : ''}</div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{name}</div>
          <button onClick={() => goArtist(d?.artistId, artist)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:12.5, color:'var(--txt-1)', fontWeight:700, marginTop:5 }}>{artist}</button>
          <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:3 }}>{songs.length} canciones</div>
        </div>
      </div>
      {detailLoading && !d ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner c={T.accent} sz={24} /></div>
      ) : songs.length === 0 ? (
        <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontró el álbum de esta canción.</div>
      ) : (
        <>
          {songs.length > 0 && (
            <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
              <button onClick={() => play(songs[0], songs.map(s=>s.id))} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>
              {(() => { const albumId = view.albumId || d?.albumId; const saved = albumId && isAlbumSaved(albumId); const meta = { albumId, name, artist, cover, year: d?.year }; return (
                <button onClick={() => saved ? unsaveAlbum(albumId) : saveAlbum(meta)} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background: saved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${saved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:99, padding:'10px 18px', cursor:'pointer', color: saved ? T.accent : 'var(--txt-1)', fontSize:12, fontWeight:700 }}>
                  <Icon.Heart c={saved ? T.accent : 'var(--txt-1)'} filled={saved} sz={15} /> {saved ? 'Guardado' : 'Guardar'}
                </button>
              ); })()}
              <DownloadAllButton ids={songs.map(s=>s.id)} downloaded={downloaded} downloading={downloading} onClick={() => { const albumId = view.albumId || d?.albumId; downloadMany(songs.map(s=>s.id)); if (albumId) saveAlbum({ albumId, name, artist, cover, year: d?.year }); }} T={T} />
              {!selecting && <button onClick={() => startSelection()} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Check c={T.accent} sz={15} /> Seleccionar</button>}
            </div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {songs.map((t, i) => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, songs.map(s=>s.id))} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR (escritorio)
// ═══════════════════════════════════════════════════════════════
function Sidebar({ tab, setTab, nav, T, playlists, setOpenPlaylist, setView }) {
  return (
    <div style={{ width:256, flexShrink:0, height:'100%', background:'var(--surf-0)', borderRight:'1px solid var(--line-soft)', display:'flex', flexDirection:'column', padding:'26px 16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:11, padding:'0 10px', marginBottom:28 }}>
        <div style={{ width:34, height:34, borderRadius:11, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 16px ${hex2rgba(T.accent,.5)}` }}><Icon.Play c="#04060a" sz={17} /></div>
        <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.3, lineHeight:1.05 }}>VELOCITY<br/><span style={{ fontSize:11, fontWeight:800, letterSpacing:3, color:T.accent }}>MUSIC</span></div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {nav.map(({ id, label, I }) => {
          const act = tab === id;
          return (
            <button key={id} onClick={() => { setTab(id); setView(null); if (id==='library') setOpenPlaylist(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:13, padding:'11px 13px', borderRadius:13, background: act ? `linear-gradient(135deg, ${hex2rgba(T.accent,.16)}, ${hex2rgba(T.accent2,.04)})` : 'transparent', border:`1px solid ${act ? hex2rgba(T.accent,.3) : 'transparent'}`, cursor:'pointer', textAlign:'left', position:'relative' }}>
              {act && <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', width:3, height:18, borderRadius:9, background:T.accent, boxShadow:`0 0 8px ${T.accent}` }} />}
              <I c={act ? T.accent : 'var(--txt-2)'} sz={20} />
              <span style={{ fontSize:13.5, fontWeight:700, color: act ? T.accent : 'var(--txt-1)' }}>{label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop:22, borderTop:'1px solid var(--line-soft)', paddingTop:16, flex:1, overflowY:'auto', minHeight:0 }}>
        <div style={{ fontSize:9.5, fontWeight:900, letterSpacing:2, color:'var(--txt-2)', textTransform:'uppercase', padding:'0 10px', marginBottom:10 }}>Tus Playlists</div>
        <button onClick={() => { setTab('library'); setOpenPlaylist('liked'); setView(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:10, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
          <div style={{ width:30, height:30, borderRadius:8, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.Heart c="#04060a" filled sz={15} /></div>
          <span style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-1)' }}>Me gusta</span>
        </button>
        {playlists.map(p => (
          <button key={p.id} onClick={() => { setTab('library'); setOpenPlaylist(p.id); setView(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:10, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <div style={{ width:30, height:30, borderRadius:8, background:'var(--surf-2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={15} /></div>
            <span style={{ fontSize:12.5, fontWeight:600, color:'var(--txt-1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</span>
          </button>
        ))}
      </div>
      <button onClick={() => { setTab('profile'); setView(null); }} className="press" style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 12px', borderRadius:14, background:'var(--surf-1)', border:'1px solid var(--line-soft)', cursor:'pointer', marginTop:8 }}>
        <div style={{ width:34, height:34, borderRadius:'50%', background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:900, color:'#04060a', flexShrink:0 }}>V</div>
        <div style={{ textAlign:'left', minWidth:0 }}><div style={{ fontSize:12.5, fontWeight:800, color:'var(--txt-0)' }}>Tu perfil</div><div style={{ fontSize:9.5, color:'var(--txt-2)' }}>PRO Member</div></div>
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PLAYER BAR (escritorio)
// ═══════════════════════════════════════════════════════════════
function PlayerBar({ track, playing, togglePlay, next, prev, time, dur, seek, vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved, toggleFav, T, onExpand, onMenu, loadingAudio, onQueue }) {
  const pct = dur > 0 ? (time / dur) * 100 : 0;
  if (!track) return (
    <div className="glass" style={{ flexShrink:0, height:90, borderTop:'1px solid var(--line-soft)', background:'#06080fcc', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--txt-2)', fontSize:12.5 }}>Selecciona una canción para empezar</div>
  );
  return (
    <div className="glass" style={{ flexShrink:0, height:90, borderTop:'1px solid var(--line-soft)', background:'#06080fcc', display:'grid', gridTemplateColumns:'minmax(180px,1fr) 2fr minmax(140px,1fr)', alignItems:'center', gap:18, padding:'0 22px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
        <img src={track.cover} alt="" onClick={onExpand} className="press" style={{ width:52, height:52, borderRadius:12, objectFit:'cover', cursor:'pointer', boxShadow:`0 4px 14px ${hex2rgba(T.accent,.3)}`, flexShrink:0 }} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }} onClick={onExpand}>{track.title}</div>
          <div style={{ fontSize:11, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
        </div>
        <button aria-label="Me gusta" onClick={() => toggleFav(track.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Heart c={faved ? T.accent : 'var(--txt-3)'} filled={faved} sz={18} /></button>
        <button aria-label="Más" onClick={() => onMenu(track.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Dots c="var(--txt-3)" sz={18} /></button>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:7, justifyContent:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:22 }}>
          <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle?1:.32 }}><Icon.Shuf c={shuffle?T.accent:'var(--txt-1)'} sz={16} /></button>
          <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={20} /></button>
          <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:42, height:42, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 16px ${hex2rgba(T.accent,.5)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
          <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={20} /></button>
          <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat?1:.32 }}><Icon.Rep c={repeat?T.accent:'var(--txt-1)'} sz={16} /></button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:9.5, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:30, textAlign:'right' }}>{fmt(time)}</span>
          <div style={{ flex:1, position:'relative', height:14, display:'flex', alignItems:'center' }}>
            <div style={{ position:'absolute', left:0, right:0, height:4, background:'var(--surf-2)', borderRadius:99 }} />
            <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:4, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${hex2rgba(T.accent,.6)}` }} />
            <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
          </div>
          <span style={{ fontSize:9.5, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:30 }}>{fmt(dur)}</span>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, justifyContent:'flex-end' }}>
        <button aria-label="Cola" onClick={onQueue} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Queue c="var(--txt-2)" sz={18} /></button>
        <Icon.Vol c="var(--txt-2)" sz={16} />
        <div style={{ width:110 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRACK MENU + TOAST
// ═══════════════════════════════════════════════════════════════
function TrackMenu({ trackId, onClose, ctx }) {
  const { T, favs, toggleFav, addToTarget, goArtist, goAlbum, shareTrack, addToQueue, download, removeDownload, downloaded } = ctx;
  if (!trackId) return null;
  const tk = trackById(trackId);
  if (!tk) return null;
  const faved = favs.includes(trackId);
  const isDl = downloaded.has(trackId);
  const items = [
    { icon: Icon.Queue, label:'Añadir a la cola', action: () => { addToQueue(trackId); onClose(); } },
    { icon: Icon.Disc,  label:'Ir al álbum',      action: () => { goAlbum(tk.albumId, tk.album, tk.artist, tk.title); onClose(); } },
    { icon: Icon.User,  label:'Ir al artista',    action: () => { goArtist(tk.artistId, tk.artist); onClose(); } },
    { icon: Icon.Plus,  label:'Añadir a playlist',action: () => { addToTarget(trackId); onClose(); } },
    { icon: Icon.Heart, label: faved ? 'Quitar de Me gusta' : 'Añadir a Me gusta', action: () => { toggleFav(trackId); onClose(); }, filled: faved },
    isDl
      ? { icon: Icon.Trash, label:'Eliminar descarga', action: () => { removeDownload(trackId); onClose(); } }
      : { icon: Icon.Down,  label:'Descargar (offline)', action: () => { download(tk); onClose(); } },
    { icon: Icon.Share, label:'Compartir enlace', action: () => { shareTrack(tk); onClose(); } },
  ];
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', zIndex:130 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 16px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:131, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 12px' }} />
        <div style={{ display:'flex', alignItems:'center', gap:13, padding:'4px 6px 14px', borderBottom:'1px solid var(--line-soft)', marginBottom:8 }}>
          <CoverImg src={tk.cover} alt="" radius={12} style={{ width:52, height:52, flexShrink:0 }} />
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:14.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tk.title}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tk.artist}{tk.album ? ` · ${tk.album}` : ''}</div>
          </div>
        </div>
        {items.map((it, i) => (
          <button key={i} onClick={it.action} className="press" style={{ display:'flex', alignItems:'center', gap:15, width:'100%', padding:'13px 12px', borderRadius:13, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <it.icon c={(it.filled || it.hl) ? T.accent : 'var(--txt-1)'} sz={19} filled={it.filled} />
            <span style={{ fontSize:14, fontWeight:600, color: it.hl ? T.accent : 'var(--txt-0)' }}>{it.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Toast({ msg, T }) {
  if (!msg) return null;
  return (
    <div className="fade-up glass" style={{ position:'fixed', bottom:'calc(env(safe-area-inset-bottom, 20px) + 96px)', left:'50%', transform:'translateX(-50%)', background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:99, padding:'11px 20px', zIndex:140, boxShadow:`0 10px 30px #000a, 0 0 20px ${hex2rgba(T.accent,.2)}`, fontSize:12.5, fontWeight:700, color:'var(--txt-0)', display:'flex', alignItems:'center', gap:8 }}>
      <Icon.Check c={T.accent} sz={16} /> {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  useEffect(() => {
    if (document.getElementById('ms-global')) return;
    const el = document.createElement('style'); el.id = 'ms-global'; el.textContent = CSS;
    document.head.appendChild(el);
  }, []);

  const [authed, setAuthed] = useState(isAuthed());
  const [email, setEmail] = useState(() => localStorage.getItem('velocity.email') || '');

  // reproducción
  const [tab, setTab] = useState('home');
  const [track, setTrack] = useState(() => { const s = loadPlayerState(); return s ? s.track : null; });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(() => { const s = loadPlayerState(); return s ? (s.t || 0) : 0; });
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.85);
  const [expanded, setExpanded] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [queue, setQueue] = useState(() => { const s = loadPlayerState(); return s ? (Array.isArray(s.queue) && s.queue.length ? s.queue : [s.track.id]) : []; });
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [downloaded, setDownloaded] = useState(() => new Set());
  const [downloading, setDownloading] = useState(() => new Set());
  const [playSrc, setPlaySrc] = useState(() => { const s = loadPlayerState(); return s && s.track.url ? s.track.url : null; });
  const objUrlRef = useRef(null);
  const resumeRef = useRef((() => { const s = loadPlayerState(); return s ? (s.t || 0) : null; })());
  const radioRef = useRef(false);        // ¿sesión de radio (autollenado de relacionadas)?
  const radioSeedRef = useRef(null);      // id de la pista semilla de la radio actual
  const persistRef = useRef({});
  const pendingRef = useRef(null);
  if (!pendingRef.current) { pendingRef.current = new Set(); try { JSON.parse(localStorage.getItem('velocity.pendingDl') || '[]').forEach(x => pendingRef.current.add(x)); } catch {} }
  const resumedRef = useRef(false);
  const savePending = () => { try { localStorage.setItem('velocity.pendingDl', JSON.stringify([...pendingRef.current])); } catch {} };

  // preferencias persistentes
  const [themeKey, setThemeKey] = usePersisted('velocity.theme', 'emerald');
  const [quality, setQuality] = usePersisted('velocity.quality', 'HQ');
  const [glow, setGlow] = usePersisted('velocity.glow', 70);
  const [eq, setEq] = usePersisted('velocity.eq', 'waves');
  const [lyricOffset, setLyricOffset] = usePersisted('velocity.lyricOffset', 0);
  const [recentSearches, setRecentSearches] = usePersisted('velocity.searches', []);
  const [settings, setSettings] = usePersisted('velocity.settings', { autoplay:true, normalize:false, crossfade:0 });

  // datos del backend
  const [favs, setFavs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [recent, setRecent] = useState([]);
  const [savedAlbums, setSavedAlbums] = useState([]);
  const [homeRows, setHomeRows] = usePersisted('velocity.home', []);
  const [homeLoading, setHomeLoading] = useState(false);

  // UI transitoria
  const [openPlaylist, setOpenPlaylist] = useState(null);
  const [addTarget, setAddTarget] = useState(null);
  const [menuTarget, setMenuTarget] = useState(null);
  const [view, setView] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [showQueue, setShowQueue] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(() => new Set());
  const [outputs, setOutputs] = useState([]);
  const [sinkId, setSinkId] = useState('default');
  const [catVer, setCatVer] = useState(0);
  const toastTimer = useRef(null);
  const showToast = (m) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2400); };

  const audioRef = useRef(null);
  const T = THEMES[themeKey] || THEMES.emerald;
  const { w: vw } = useViewport();
  const wide = vw >= 900;

  // Cargar descargas offline + manejar expiración de sesión (401 → re-login)
  useEffect(() => {
    setOnUnauthorized(() => { setAuthed(false); showToast('Tu sesión expiró. Inicia sesión de nuevo.'); });
    homeRows.forEach(sec => (sec.mixes || []).forEach(m => (m.tracks || []).forEach(cacheTrack))); // hidratar caché del feed guardado
    (async () => {
      try {
        const metas = await offline.listMetas();
        metas.forEach(cacheTrack);
        const ids = await offline.listIds();
        setDownloaded(new Set(ids));
        // Si la última pista restaurada está descargada, reproducir desde el blob offline.
        try {
          const s = loadPlayerState();
          if (s && s.track && s.track.id && ids.includes(s.track.id)) {
            const b = await offline.getBlob(s.track.id);
            if (b) { const u = URL.createObjectURL(b); objUrlRef.current = u; setPlaySrc(u); }
          }
        } catch {}
      } catch {}
    })();
    // Guardado del estado del reproductor (posición incluida).
    const save = () => { try { if (persistRef.current.track) localStorage.setItem('velocity.player', JSON.stringify(persistRef.current)); } catch {} };
    const iv = setInterval(save, 3000);
    const onHide = () => save();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(iv); window.removeEventListener('pagehide', onHide); window.removeEventListener('beforeunload', onHide); document.removeEventListener('visibilitychange', onHide); save(); };
  }, []);

  // ── Carga inicial tras autenticación ──
  useEffect(() => {
    if (!authed) return;
    let cancel = false;
    (async () => {
      try {
        const [fav, pls, hist] = await Promise.all([
          api.favorites().catch(() => []),
          api.playlists().catch(() => []),
          api.history().catch(() => []),
        ]);
        if (cancel) return;
        setFavs(fav);
        setRecent(hist.map(h => h.trackId));
        api.savedAlbums().then(a => { if (!cancel) setSavedAlbums(a); }).catch(() => {});
        // cargar pistas de cada playlist
        const withTracks = await Promise.all(pls.map(async p => {
          const ids = await api.playlistTracks(p.id).catch(() => []);
          return { id: p.id, name: p.name, trackIds: ids };
        }));
        if (!cancel) setPlaylists(withTracks);

        // ── Sincronización de metadatos entre dispositivos ──
        // 1) Subir lo que este dispositivo ya conoce (para otros dispositivos).
        const local = [..._catalog.values()].map(slimTrack).filter(Boolean);
        if (local.length) api.saveTracks(local);
        // 2) Hidratar metadatos faltantes de la biblioteca (favoritos, historial,
        //    playlists) desde el backend, para poder renderizarlos aquí.
        const allIds = new Set([...fav, ...hist.map(h => h.trackId)]);
        withTracks.forEach(p => (p.trackIds || []).forEach(id => allIds.add(id)));
        const missing = [...allIds].filter(id => id && !trackById(id));
        if (missing.length) {
          // En lotes de 300 (límite del endpoint).
          for (let i = 0; i < missing.length && !cancel; i += 300) {
            const metas = await api.getTracks(missing.slice(i, i + 300));
            if (!cancel && metas.length) { metas.forEach(normalizeTrack); }
          }
          if (!cancel) { saveMeta(); setCatVer(v => v + 1); }
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, [authed]);

  // ── Feed personalizado (mixes según lo que escuchas, guardas y descargas) ──
  const feedSigRef = useRef('');
  useEffect(() => {
    if (!authed) return;
    let cancel = false;
    // Puntuar pistas según lo que más escuchas, das like y descargas.
    const score = {};
    recent.forEach((id, i) => { score[id] = (score[id] || 0) + Math.max(1, 12 - i * 0.4); });
    favs.forEach(id => { score[id] = (score[id] || 0) + 6; });
    [...downloaded].forEach(id => { score[id] = (score[id] || 0) + 4; });
    // Semillas: pistas conocidas ordenadas por score, diversificadas por artista
    // (una por artista) para que cada mezcla tenga una raíz distinta.
    const ranked = Object.keys(score).map(trackById).filter(Boolean).sort((a, b) => score[b.id] - score[a.id]);
    const seeds = []; const seenArtist = new Set();
    for (const t of ranked) {
      const a = (t.artist || '').toLowerCase();
      if (seenArtist.has(a)) continue;
      seenArtist.add(a); seeds.push(t);
      if (seeds.length >= 5) break;
    }
    const sig = seeds.map(s => s.id).join('|');
    if (sig === feedSigRef.current && homeRows.length) return; // sin cambios relevantes
    feedSigRef.current = sig;
    setHomeLoading(true);
    (async () => {
      // Helpers para construir mezclas (cada una es una "playlist" con carátula collage).
      const mixFromSeed = async (seed) => {
        try {
          const rel = await api.radio(seed.id);
          const tracks = capPerArtist(dedupeByTitle([seed, ...rel.map(normalizeTrack)]), 3).filter(t => t.id).slice(0, 25);
          return tracks.length >= 4 ? { label: seed.artist || 'Mezcla', tracks } : null;
        } catch { return null; }
      };
      const mixFromSearch = async (label, q) => {
        try {
          const raw = await api.search(q);
          const tracks = dedupeByTitle(raw.slice(0, 22).map(normalizeTrack)).filter(t => t.id);
          return tracks.length >= 4 ? { label, tracks } : null;
        } catch { return null; }
      };
      const clean = (arr) => arr.filter(Boolean);

      const sections = [];
      const pushSection = (section, mixes) => {
        if (!mixes.length || cancel) return;
        sections.push({ section, mixes });
        setHomeRows([...sections]);
        setHomeLoading(false);
      };

      // 1) Hecho para ti — mezclas personalizadas por artista semilla.
      pushSection('Hecho para ti', clean(await Promise.all(seeds.map(mixFromSeed))));
      // 2) Mezclas por género.
      pushSection('Mezclas por género', clean(await Promise.all(GENRES.map(g => mixFromSearch(g.label, g.q)))));
      // 3) Viaja en el tiempo — por década.
      const decades = [
        ['Éxitos 2020s', 'top hits 2023'], ['Lo mejor de los 2010s', 'best songs 2010s'],
        ['Clásicos de los 2000s', 'top hits 2000s'], ['Rock de los 90', 'best rock 90s'],
        ['Éxitos de los 80', 'greatest hits 80s'],
      ];
      pushSection('Viaja en el tiempo', clean(await Promise.all(decades.map(([l, q]) => mixFromSearch(l, q)))));
      // 4) Descubre — recomendaciones generales.
      pushSection('Descubre', clean(await Promise.all(SEED_ROWS.map(s => mixFromSearch(s.label, s.q)))));

      if (!cancel) setHomeLoading(false);
    })();
    return () => { cancel = true; };
  }, [authed, recent, favs, downloaded, catVer]);

  // ── Reanudar descargas pendientes al volver a la app ──
  useEffect(() => {
    if (!authed || resumedRef.current) return;
    const pend = [...pendingRef.current];
    if (pend.length) { resumedRef.current = true; setTimeout(() => downloadMany(pend), 1200); }
  }, [authed]);

  // ── Sincronizar elemento audio (playSrc incluido: reproduce al resolver archivo offline) ──
  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.play().catch(() => {});
    else audioRef.current.pause();
  }, [playing, track, playSrc]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);

  // ── Precargar la(s) siguiente(s) pista(s) al cambiar la actual o la cola ──
  // Cubre el modo radio (la cola se llena después de play()) y garantiza que
  // el cambio a la siguiente sea instantáneo (URL ya resuelta en el backend).
  useEffect(() => {
    if (!track) return;
    const qualityMap = { HQ: 'high', Standard: 'medium', FLAC: 'low' };
    const qParam = qualityMap[quality] || 'high';
    const ids = queue.length ? queue : [track.id];
    prefetchNext(track.id, ids, qParam);
  }, [track?.id, queue, quality]);

  // ── Media Session: estado de posición (barra de progreso en pantalla bloqueada) ──
  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (dur > 0 && isFinite(dur)) {
      try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(time, dur), playbackRate: 1 }); } catch {}
    }
  }, [time, dur]);
  // Salir del modo selección al navegar.
  useEffect(() => { if (selecting) { setSelecting(false); setSelection(new Set()); } /* eslint-disable-next-line */ }, [tab, view]);

  // ── Dispositivos de salida de audio ──
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = async () => { try { const list = await navigator.mediaDevices.enumerateDevices(); setOutputs(list.filter(d => d.kind === 'audiooutput')); } catch {} };
    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
  }, []);
  const setOutput = async (id) => {
    try { if (audioRef.current?.setSinkId) { await audioRef.current.setSinkId(id); setSinkId(id); showToast('Salida de audio cambiada'); } else showToast('Tu navegador no permite cambiar la salida'); }
    catch { showToast('No se pudo cambiar la salida'); }
  };

  // ── Acciones de reproducción ──
  // Fundido de entrada corto para evitar el "clic"/pop al empezar una pista.
  // Solo se aplica con la página visible: cuando está en segundo plano o la
  // pantalla bloqueada, requestAnimationFrame se congela, así que ahí ponemos
  // el volumen directo (sin fundido) para no dejar la música en silencio.
  const fadeRafRef = useRef(null);
  const fadeSafetyRef = useRef(null);
  const pendingFadeRef = useRef(false);
  const fadeInAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(fadeRafRef.current);
    clearTimeout(fadeSafetyRef.current);
    const target = vol;
    // Si la página no está visible, no arriesgamos el fundido (rAF congelado).
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      a.volume = target;
      return;
    }
    a.volume = 0;
    const start = performance.now();
    const dur = 130; // ms — imperceptible pero elimina el pop de inicio
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      a.volume = target * (p * (2 - p)); // ease-out
      if (p < 1) fadeRafRef.current = requestAnimationFrame(step);
      else a.volume = target;
    };
    fadeRafRef.current = requestAnimationFrame(step);
    // Red de seguridad: si el rAF se congela (bloqueo de pantalla a mitad del
    // fundido), garantizar que el volumen llegue al objetivo.
    fadeSafetyRef.current = setTimeout(() => { cancelAnimationFrame(fadeRafRef.current); if (audioRef.current) audioRef.current.volume = target; }, dur + 350);
  };

  // Precarga la(s) siguiente(s) pista(s) de la cola en la caché del backend,
  // para que al dar "siguiente" el arranque sea instantáneo (sin esperar a yt-dlp).
  const prefetchedRef = useRef(new Set());
  const prefetchNext = (currentId, ids, qParam) => {
    if (!ids || ids.length < 2) return;
    const i = ids.indexOf(currentId);
    if (i === -1) return;
    // Precargar las próximas 2 pistas de la cola.
    for (let n = 1; n <= 2; n++) {
      const nextId = ids[(i + n) % ids.length];
      if (!nextId || nextId === currentId) continue;
      if (prefetchedRef.current.has(nextId)) continue;   // ya precargada
      if (downloaded.has(nextId)) continue;               // ya está offline
      const nt = trackById(nextId);
      if (!nt) continue;
      prefetchedRef.current.add(nextId);
      api.prefetchStream({ artist: nt.artist, title: nt.title, id: nt.id, quality: qParam });
    }
    // Acotar el registro para que no crezca sin límite.
    if (prefetchedRef.current.size > 60) {
      prefetchedRef.current = new Set([...prefetchedRef.current].slice(-30));
    }
  };

  // opts.radio=true → inicia una "radio": la cola se llena con canciones
  // relacionadas a la elegida (tipo Spotify), en vez de una lista fija.
  const ensureRadio = async (seed, existingIds = []) => {
    if (!seed || !seed.id) return;
    radioSeedRef.current = seed.id;
    try {
      const raw = await api.radio(seed.id);
      if (radioSeedRef.current !== seed.id) return; // cambió la semilla mientras cargaba
      let more = capPerArtist(dedupeByTitle(raw.map(normalizeTrack)), 3)
        .filter(t => t.id && t.id !== seed.id && !existingIds.includes(t.id));
      if (!more.length) return;
      const addIds = more.slice(0, 30).map(t => t.id);
      setQueue(q => {
        const base = q && q.length ? q : [seed.id];
        const merged = [...base];
        addIds.forEach(id => { if (!merged.includes(id)) merged.push(id); });
        return merged;
      });
    } catch {}
  };

  const play = (t, list, opts = {}) => {
    if (!t) return;
    cacheTrack(t); saveMeta();
    // Detener limpiamente la pista anterior para evitar el "clic" al cortar la onda.
    const a = audioRef.current;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    if (a) { try { cancelAnimationFrame(fadeRafRef.current); clearTimeout(fadeSafetyRef.current); a.pause(); } catch {} }
    if (a && visible) { a.volume = 0; pendingFadeRef.current = true; }  // fundido al arrancar
    else { if (a) a.volume = vol; pendingFadeRef.current = false; }      // segundo plano: sin fundido
    const initialQueue = list && list.length ? list : [t.id];
    setQueue(initialQueue);
    // Mapear preferencia de calidad de la UI al ID del backend.
    const qualityMap = { HQ: 'high', Standard: 'medium', FLAC: 'low' };
    const qParam = qualityMap[quality] || 'high';
    // Reconstruir URL con la calidad actual en el momento de reproducir.
    const trackWithQuality = { ...t, url: api.streamUrl({ artist: t.artist, title: t.title, id: t.id, quality: qParam }) };
    setTrack(trackWithQuality); setPlaying(true); setLoadingAudio(true);
    // Fuente: archivo offline si existe, si no el stream del backend.
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    if (downloaded.has(t.id)) {
      offline.getBlob(t.id).then(b => { if (b) { const u = URL.createObjectURL(b); objUrlRef.current = u; setPlaySrc(u); } else setPlaySrc(trackWithQuality.url); }).catch(() => setPlaySrc(trackWithQuality.url));
    } else { setPlaySrc(trackWithQuality.url); }
    setRecent(r => [t.id, ...r.filter(x => x !== t.id)].slice(0, 30));
    api.recordHistory(t.id).catch(() => {});
    api.saveTracks([slimTrack(t)]); // sincronizar metadatos entre dispositivos
    try { localStorage.setItem('velocity.player', JSON.stringify({ track: trackWithQuality, queue: initialQueue, t: 0 })); } catch {}
    // Precargar la(s) siguiente(s) pista(s) de la cola para que el cambio sea instantáneo.
    prefetchNext(t.id, initialQueue, qParam);
    // Modo radio: llena la cola con relacionadas a la pista elegida.
    if (opts.radio) { radioRef.current = true; ensureRadio(t, initialQueue); }
    else { radioRef.current = false; radioSeedRef.current = null; }
  };
  const togglePlay = () => { if (track) setPlaying(p => !p); };
  const orderIds = queue.length ? queue : (track ? [track.id] : []);
  const next = () => {
    if (!track || !orderIds.length) return;
    if (shuffle && orderIds.length > 1) {
      let id; do { id = orderIds[Math.floor(Math.random()*orderIds.length)]; } while (id === track.id && orderIds.length > 1);
      const t = trackById(id); if (t) play(t, orderIds); return;
    }
    const i = orderIds.indexOf(track.id);
    const t = trackById(orderIds[(i+1) % orderIds.length]); if (t) play(t, orderIds);
  };
  const prev = () => {
    if (!track || !orderIds.length) return;
    const i = orderIds.indexOf(track.id);
    const t = trackById(orderIds[(i-1+orderIds.length) % orderIds.length]); if (t) play(t, orderIds);
  };
  const seek = (v) => { if (audioRef.current) audioRef.current.currentTime = v; setTime(v); };

  // ── Cola ──
  const addToQueue = (id) => {
    const t = trackById(id); if (!t) return;
    setQueue(q => {
      const base = q.length ? [...q] : (track ? [track.id] : []);
      const without = base.filter(x => x !== id);
      const ci = track ? without.indexOf(track.id) : -1;
      if (ci === -1) return [...without, id];          // sin actual: al final
      without.splice(ci + 1, 0, id);                    // justo después de la actual
      return without;
    });
    if (!track) play(t);
    showToast('Se reproducirá a continuación');
  };
  const reorderQueue = (from, to) => setQueue(q => { const a = [...q]; const [m] = a.splice(from, 1); a.splice(to, 0, m); return a; });
  const removeFromQueue = (id) => setQueue(q => q.filter(x => x !== id || x === track?.id));

  // ── Descargas offline (IndexedDB, sin diálogo de guardado) ──
  // URL de streaming con la calidad actual: coincide con la clave de caché que
  // usan reproducir/precargar, así una canción ya resuelta se descarga al instante.
  const streamUrlQ = (t) => api.streamUrl({ artist: t.artist, title: t.title, id: t.id, quality: ({ HQ:'high', Standard:'medium', FLAC:'low' }[quality] || 'high') });
  const fetchBlobWithTimeout = async (url, ms = 60000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.blob();
    } finally { clearTimeout(t); }
  };
  const download = async (tk) => {
    if (!tk || downloaded.has(tk.id) || downloading.has(tk.id)) return;
    setDownloading(d => { const n = new Set(d); n.add(tk.id); return n; });
    cacheTrack(tk); saveMeta(); pendingRef.current.add(tk.id); savePending();
    api.saveTracks([slimTrack(tk)]);
    try {
      const blob = await fetchBlobWithTimeout(streamUrlQ(tk), 60000);
      await offline.saveTrack(tk, blob);
      setDownloaded(d => { const n = new Set(d); n.add(tk.id); return n; });
      showToast('Descargada · disponible sin conexión');
    } catch { showToast(`No se pudo descargar: ${tk.title}`); }
    finally { setDownloading(d => { const n = new Set(d); n.delete(tk.id); return n; }); pendingRef.current.delete(tk.id); savePending(); }
  };
  const removeDownload = async (id) => {
    try { await offline.deleteTrack(id); } catch {}
    setDownloaded(d => { const n = new Set(d); n.delete(id); return n; });
    showToast('Descarga eliminada');
  };
  const downloadMany = async (ids) => {
    const todo = ids.filter(id => !downloaded.has(id) && !downloading.has(id) && trackById(id));
    if (!todo.length) { showToast('Ya está todo descargado'); return; }
    setDownloading(d => { const n = new Set(d); todo.forEach(id => n.add(id)); return n; });
    todo.forEach(id => pendingRef.current.add(id)); savePending(); saveMeta();
    api.saveTracks(todo.map(trackById).map(slimTrack).filter(Boolean));
    let ok = 0, done = 0;
    const worker = async (id) => {
      const tk = trackById(id);
      try {
        const blob = await fetchBlobWithTimeout(streamUrlQ(tk), 60000);
        await offline.saveTrack(tk, blob);
        setDownloaded(d => { const n = new Set(d); n.add(id); return n; });
        ok++;
      } catch {}
      finally {
        setDownloading(d => { const n = new Set(d); n.delete(id); return n; });
        pendingRef.current.delete(id); savePending();
        done++; showToast(`Descargando ${done}/${todo.length}…`);
      }
    };
    const queue = [...todo];
    const CONC = Math.min(4, queue.length);
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { await worker(queue.shift()); } }));
    showToast(`${ok}/${todo.length} descargadas`);
  };

  // ── Fin de pista: repeat / autoplay / radio de relacionadas ──
  const onEnded = async () => {
    if (repeat && audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play(); return; }
    if (!settings.autoplay) { setPlaying(false); return; }
    const ids = queue.length ? queue : (track ? [track.id] : []);
    const i = ids.indexOf(track?.id);
    if (i !== -1 && i < ids.length - 1) { next(); return; }
    // Fin de la cola: continuar con canciones relacionadas a la actual (radio),
    // NO con otras del mismo nombre. Igual que Spotify.
    if (track) {
      try {
        const rel = await api.radio(track.id);
        let more = capPerArtist(dedupeByTitle(rel.map(normalizeTrack)), 3)
          .filter(t => t.id !== track.id && !ids.includes(t.id));
        if (more.length) {
          const add = more.slice(0, 20).map(t => t.id);
          const nxt = trackById(add[0]);
          if (nxt) { play(nxt, [...ids, ...add]); return; }
        }
      } catch {}
      // Respaldo: relacionadas por artista si la radio no devolvió nada.
      try {
        const raw = await api.search(track.artist);
        const more = raw.map(normalizeTrack).filter(t => t.id !== track.id && !ids.includes(t.id));
        if (more.length) { const add = more.slice(0, 8).map(t => t.id); const nxt = trackById(add[0]); if (nxt) { play(nxt, [...ids, ...add]); return; } }
      } catch {}
    }
    setPlaying(false);
  };

  // ── Favoritos (backend) ──
  const toggleFav = async (id) => {
    const has = favs.includes(id);
    setFavs(f => has ? f.filter(x => x !== id) : [id, ...f]);
    if (!has) { const tk = trackById(id); if (tk) api.saveTracks([slimTrack(tk)]); }
    try { has ? await api.removeFavorite(id) : await api.addFavorite(id); }
    catch { setFavs(f => has ? [id, ...f] : f.filter(x => x !== id)); showToast('No se pudo actualizar Me gusta'); }
  };

  // ── Playlists (backend) ──
  const createPlaylist = async (name) => {
    try { const id = await api.createPlaylist(name); setPlaylists(p => [...p, { id, name, trackIds: [] }]); return id; }
    catch { showToast('No se pudo crear la playlist'); return null; }
  };
  const addToPlaylist = async (pid, tid) => {
    setPlaylists(p => p.map(pl => pl.id===pid && !pl.trackIds.includes(tid) ? { ...pl, trackIds:[...pl.trackIds, tid] } : pl));
    const tk = trackById(tid); if (tk) api.saveTracks([slimTrack(tk)]);
    try { await api.addToPlaylist(pid, tid); } catch { showToast('No se pudo añadir'); }
  };
  const removeFromPlaylist = async (pid, tid) => {
    setPlaylists(p => p.map(pl => pl.id===pid ? { ...pl, trackIds: pl.trackIds.filter(x => x !== tid) } : pl));
    try { await api.removeFromPlaylist(pid, tid); } catch { showToast('No se pudo quitar'); }
  };
  const deletePlaylist = async (pid) => {
    setPlaylists(p => p.filter(pl => pl.id !== pid));
    try { await api.deletePlaylist(pid); } catch { showToast('No se pudo eliminar'); }
  };

  const addSearch = (term) => setRecentSearches(s => [term, ...s.filter(x => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  const removeSearch = (term) => setRecentSearches(s => s.filter(x => x !== term));

  // ── Navegación a artista / álbum (metadatos reales del backend) ──
  const goArtist = (artistId, name) => {
    setExpanded(false); setView({ type:'artist', artistId, name });
    setDetailData(null); setDetailLoading(true);
    const fallback = () => api.search(name).then(raw => setDetailData({ type:'artist', name, topSongs: dedupeByTitle(raw.map(normalizeTrack)), albums: [] })).catch(() => {});
    if (!artistId) { fallback().finally(() => setDetailLoading(false)); return; }
    api.artist(artistId)
      .then(d => setDetailData({ type:'artist', name: d.name || name, thumbnail: d.thumbnail, topSongs: dedupeByTitle((d.topSongs || []).map(normalizeTrack)), albums: d.albums || [] }))
      .catch(fallback)
      .finally(() => setDetailLoading(false));
  };
  const goAlbum = (albumId, name, artist, songTitle) => {
    setExpanded(false); setView({ type:'album', albumId, name, artist });
    setDetailData(null); setDetailLoading(true);
    const loadAlbum = (aid) => api.album(aid).then(d => setDetailData({ type:'album', name: d.name || name, artist: d.artist || artist, artistId: d.artistId, cover: d.cover, year: d.year, tracks: (d.tracks || []).map(normalizeTrack) }));
    (async () => {
      try {
        let aid = albumId;
        if (!aid) {
          const raw = await api.search(`${songTitle || name} ${artist || ''}`.trim());
          aid = raw.map(normalizeTrack).find(t => t.albumId)?.albumId || null;
        }
        if (aid) await loadAlbum(aid);
        else setDetailData({ type:'album', name, artist, tracks: [], none: true });
      } catch { setDetailData({ type:'album', name, artist, tracks: [], none: true }); }
      finally { setDetailLoading(false); }
    })();
  };
  const shareTrack = (t) => {
    const url = `https://velocity.music/track/${t.id}`;
    if (navigator.share) navigator.share({ title:t.title, text:`${t.title} — ${t.artist}`, url }).catch(()=>{});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado')).catch(() => showToast('No se pudo copiar'));
    else showToast(url);
  };

  // ── Álbumes guardados en biblioteca ──
  const isAlbumSaved = (albumId) => savedAlbums.some(a => a.albumId === albumId);
  const saveAlbum = async (album) => {
    if (!album || !album.albumId || isAlbumSaved(album.albumId)) return;
    setSavedAlbums(s => [{ ...album, savedAt: Date.now() }, ...s]);
    try { await api.saveAlbum(album); showToast('Álbum guardado en tu biblioteca'); }
    catch { setSavedAlbums(s => s.filter(a => a.albumId !== album.albumId)); showToast('No se pudo guardar el álbum'); }
  };
  const unsaveAlbum = async (albumId) => {
    setSavedAlbums(s => s.filter(a => a.albumId !== albumId));
    try { await api.unsaveAlbum(albumId); showToast('Álbum quitado'); } catch {}
  };

  const onLogout = () => {
    api.logout(); localStorage.removeItem('velocity.email');
    setAuthed(false); setEmail(''); setFavs([]); setPlaylists([]); setRecent([]); setHomeRows([]); setSavedAlbums([]);
    setTrack(null); setPlaying(false); setView(null); setOpenPlaylist(null); setTab('home');
  };
  const handleAuthed = (em) => { if (em) { setEmail(em); localStorage.setItem('velocity.email', em); } setAuthed(true); };

  // ── Selección múltiple ──
  const toggleSelect = (id) => setSelection(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const startSelection = (id) => { setSelecting(true); setSelection(new Set(id ? [id] : [])); };
  const clearSelection = () => { setSelecting(false); setSelection(new Set()); };

  const pct = dur > 0 ? (time/dur)*100 : 0;
  persistRef.current = { track: track || null, queue, t: time };

  // reloj
  const [clockStr, setClockStr] = useState('');
  useEffect(() => {
    const tick = () => { const d = new Date(); let h = d.getHours()%12||12; setClockStr(`${h}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`); };
    tick(); const id = setInterval(tick, 30000); return () => clearInterval(id);
  }, []);

  // ── Media Session API: controles de pantalla de bloqueo y notificación del OS ──
  // (Debe declararse ANTES de cualquier return condicional para no romper el
  //  orden de los hooks de React.)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (track) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        artwork: track.cover && !track.cover.startsWith('data:') ? [
          { src: track.cover.replace(/=w\d+-h\d+/, '=w512-h512').replace(/=s\d+/, '=s512'), sizes: '512x512', type: 'image/jpeg' },
        ] : [],
      });
    }
    navigator.mediaSession.setActionHandler('play',     () => { if (audioRef.current) { audioRef.current.play(); setPlaying(true); } });
    navigator.mediaSession.setActionHandler('pause',    () => { if (audioRef.current) { audioRef.current.pause(); setPlaying(false); } });
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack',     () => next());
    navigator.mediaSession.setActionHandler('seekto', (e) => { if (e.seekTime != null) seek(e.seekTime); });
    return () => {
      ['play','pause','previoustrack','nexttrack','seekto'].forEach(a => {
        try { navigator.mediaSession.setActionHandler(a, null); } catch {}
      });
    };
  }, [track, playing]);

  // Sincronizar estado de reproducción con Media Session
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  if (!authed) return <AuthScreen onAuthed={handleAuthed} T={T} />;

  const NAV = [
    { id:'home', label:'Inicio', I: Icon.Home }, { id:'search', label:'Buscar', I: Icon.Search },
    { id:'library', label:'Biblioteca', I: Icon.Lib }, { id:'profile', label:'Yo', I: Icon.User },
  ];

  const ctx = {
    track, playing, play, T, favs, toggleFav, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist,
    recent, recentSearches, addSearch, removeSearch, homeRows, homeLoading, detailLoading,
    openPlaylist, setOpenPlaylist, setTab, addToTarget: setAddTarget, onMenu: setMenuTarget,
    themeKey, setThemeKey, quality, setQuality, glow, setGlow, eq, setEq, settings, setSettings,
    view, setView, goArtist, goAlbum, shareTrack, email, onLogout, detailData,
    addToQueue, download, removeDownload, downloadMany, downloaded, downloading, openQueue: () => setShowQueue(true),
    savedAlbums, saveAlbum, unsaveAlbum, isAlbumSaved,
    selecting, selection, toggleSelect, startSelection, clearSelection,
  };

  const playerProps = { track, playing, togglePlay, next, prev, time, dur, seek, vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved: track ? favs.includes(track.id) : false, toggleFav, T, loadingAudio };

  const TabContent = (
    <>
      {tab === 'home' && <HomeTab ctx={ctx} />}
      {tab === 'search' && <SearchTab ctx={ctx} />}
      {tab === 'library' && <LibraryTab ctx={ctx} />}
      {tab === 'profile' && <ProfileTab ctx={ctx} />}
    </>
  );
  const Content = view ? <DetailView view={view} ctx={ctx} /> : TabContent;

  const audioEl = (
    <audio ref={audioRef} src={playSrc || (track ? track.url : undefined)} preload="metadata"
      onTimeUpdate={() => { const ct = audioRef.current?.currentTime || 0; setTime(ct); if (ct > 0 && loadingAudio) setLoadingAudio(false); }}
      onLoadedMetadata={() => { setDur(audioRef.current?.duration||0); if (resumeRef.current != null && audioRef.current) { try { audioRef.current.currentTime = resumeRef.current; } catch {} setTime(resumeRef.current); resumeRef.current = null; } }}
      onCanPlay={() => setLoadingAudio(false)}
      onPlay={() => setLoadingAudio(false)}
      onPlaying={() => { setLoadingAudio(false); if (pendingFadeRef.current) { pendingFadeRef.current = false; fadeInAudio(); } }}
      onStalled={() => setLoadingAudio(true)}
      onWaiting={() => setLoadingAudio(true)}
      onError={() => { setLoadingAudio(false); setPlaying(false); showToast('No se pudo reproducir esta pista'); }}
      onEnded={onEnded}
    />
  );

  const expandedPlayer = (
    <ExpandedPlayer open={expanded} onClose={() => setExpanded(false)} {...playerProps} audioRef={audioRef}
      glow={glow} quality={quality} compact={!wide} desktop={wide} onAdd={setAddTarget} onMenu={setMenuTarget}
      onQueue={() => setShowQueue(true)} outputs={outputs} sinkId={sinkId} setOutput={setOutput}
      lyricOffset={lyricOffset} setLyricOffset={setLyricOffset} />
  );
  const addModal = <AddToPlaylistModal trackId={addTarget} onClose={() => { setAddTarget(null); if (selecting) clearSelection(); }} playlists={playlists} createPlaylist={createPlaylist} addToPlaylist={addToPlaylist} removeFromPlaylist={removeFromPlaylist} T={T} />;
  const trackMenu = <TrackMenu trackId={menuTarget} onClose={() => setMenuTarget(null)} ctx={ctx} />;
  const queuePanel = <QueuePanel open={showQueue} onClose={() => setShowQueue(false)} queue={queue} current={track} play={play} T={T} reorder={reorderQueue} remove={removeFromQueue} />;
  const selectionBar = selecting ? (
    <div className="fade-up glass" style={{ position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:'calc(env(safe-area-inset-bottom, 16px) + 92px)', zIndex:100, display:'flex', alignItems:'center', gap:12, background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:99, padding:'8px 10px 8px 16px', boxShadow:'0 12px 34px #000a' }}>
      <span style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)' }}>{selection.size} seleccionada(s)</span>
      <button disabled={!selection.size} onClick={() => selection.size && setAddTarget([...selection])} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:99, padding:'8px 16px', cursor:'pointer', color:'#04060a', fontSize:12, fontWeight:800, opacity: selection.size?1:.5 }}>Añadir a playlist</button>
      <button aria-label="Cancelar" onClick={clearSelection} className="press" style={{ background:'var(--surf-2)', border:'none', borderRadius:'50%', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={16} /></button>
    </div>
  ) : null;

  // ───────────── DESKTOP ─────────────
  if (wide) {
    return (
      <div style={{ position:'relative', height:'100vh', overflow:'hidden', background:'radial-gradient(circle at 25% 0%, #0d1320, #04060a 55%)', display:'flex', flexDirection:'column', fontFamily:'Inter,-apple-system,sans-serif' }}>
        {audioEl}
        <div style={{ position:'absolute', top:-120, left:'40%', width:520, height:320, background:grad(T), filter:'blur(120px)', opacity:.12, pointerEvents:'none', zIndex:0 }} />
        <div style={{ flex:1, display:'flex', overflow:'hidden', position:'relative', zIndex:1 }}>
          <Sidebar tab={tab} setTab={setTab} nav={NAV} T={T} playlists={playlists} setOpenPlaylist={setOpenPlaylist} setView={setView} />
          <main style={{ flex:1, overflowY:'auto' }}>
            <div style={{ maxWidth:1080, margin:'0 auto', padding:'30px 38px 40px' }}>{Content}</div>
          </main>
        </div>
        <PlayerBar {...playerProps} onExpand={() => setExpanded(true)} onMenu={setMenuTarget} onQueue={() => setShowQueue(true)} />
        {expandedPlayer}{addModal}{trackMenu}{queuePanel}{selectionBar}
        <Toast msg={toast} T={T} />
      </div>
    );
  }

  // ───────────── MÓVIL ─────────────
  return (
    <div style={{ position:'relative', height:'100dvh', overflow:'hidden', background:'radial-gradient(circle at 30% 0%, #0d1320, #04060a 60%)', display:'flex', flexDirection:'column', fontFamily:'Inter,-apple-system,sans-serif' }}>
      {audioEl}
      <div style={{ position:'absolute', top:-60, left:'50%', transform:'translateX(-50%)', width:300, height:200, background:grad(T), filter:'blur(70px)', opacity:.16, pointerEvents:'none', zIndex:0 }} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', paddingTop:'calc(env(safe-area-inset-top, 12px) + 12px)', position:'relative', zIndex:1 }}>
        <div style={{ display:'flex', justifyContent:'space-between', padding:'0 22px 6px', fontSize:12, fontWeight:700, color:'var(--txt-1)', userSelect:'none' }}>
          <span>{clockStr}</span>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'4px 18px 0' }}>{Content}</div>

        {track && (
          <div style={{ padding:'8px 14px 6px' }}>
            <div onClick={() => setExpanded(true)} className="glass" style={{ background:`linear-gradient(135deg, ${hex2rgba(T.accent,.1)}, var(--surf-0))`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:20, padding:'10px 12px', display:'flex', alignItems:'center', gap:12, cursor:'pointer', boxShadow:`0 8px 28px ${hex2rgba(T.accent,.16)}, 0 2px 8px #0006`, position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', bottom:0, left:0, height:2.5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${T.accent}`, transition:'width .15s linear' }} />
              <img src={track.cover} alt="" style={{ width:42, height:42, borderRadius:11, objectFit:'cover', flexShrink:0, boxShadow:'0 4px 12px #0007' }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
                <div style={{ fontSize:10, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
              </div>
              <button aria-label={playing?'Pausar':'Reproducir'} onClick={e=>{ e.stopPropagation(); togglePlay(); }} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:'50%', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, boxShadow:`0 0 14px ${hex2rgba(T.accent,.55)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
              <button aria-label="Más" onClick={e=>{ e.stopPropagation(); setMenuTarget(track.id); }} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Dots c="var(--txt-1)" sz={19} /></button>
            </div>
          </div>
        )}

        <div className="glass" style={{ display:'flex', justifyContent:'space-around', padding:'10px 0 calc(env(safe-area-inset-bottom, 14px) + 14px)', borderTop:'1px solid var(--line-soft)', background:'#06080faa', userSelect:'none' }}>
          {NAV.map(({ id, label, I }) => {
            const act = tab === id;
            return (
              <button key={id} aria-label={label} onClick={() => { setTab(id); setExpanded(false); setView(null); if (id==='library') setOpenPlaylist(null); }} className="press" style={{ background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'4px 12px', position:'relative' }}>
                {act && <div style={{ position:'absolute', top:-10, width:5, height:5, borderRadius:'50%', background:T.accent, boxShadow:`0 0 8px ${T.accent}` }} />}
                <I c={act ? T.accent : 'var(--txt-3)'} sz={22} />
                <span style={{ fontSize:10, fontWeight:700, color: act ? T.accent : 'var(--txt-3)' }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {expandedPlayer}{addModal}{trackMenu}{queuePanel}{selectionBar}
      <Toast msg={toast} T={T} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEVICE CHIP — salida de audio (auriculares / parlante)
// ═══════════════════════════════════════════════════════════════
function DeviceChip({ outputs, sinkId, setOutput, T }) {
  const [open, setOpen] = useState(false);
  const list = (outputs || []).filter(o => o.deviceId);
  const current = list.find(o => o.deviceId === sinkId);
  const label = current?.label || (list.find(o => o.deviceId === 'default')?.label) || 'Este dispositivo';
  const isBT = /blue|airpod|buds|head|auric/i.test(label);
  const Ico = isBT ? Icon.Headph : Icon.Speaker;
  const canPick = list.length > 1 && list.some(o => o.label);
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => canPick && setOpen(o => !o)} className="press" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'8px 14px', cursor: canPick ? 'pointer' : 'default', color:'var(--txt-1)', fontSize:11.5, fontWeight:700, maxWidth:200 }}>
        <Ico c={T.accent} sz={15} />
        <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label.replace(/\s*\(.*\)$/,'') || 'Salida de audio'}</span>
      </button>
      {open && canPick && (
        <div className="glass fade-up" style={{ position:'absolute', bottom:'calc(100% + 8px)', left:0, minWidth:220, background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:14, padding:6, zIndex:95, boxShadow:'0 20px 50px #000c' }}>
          {list.map(o => (
            <button key={o.deviceId} onClick={() => { setOutput(o.deviceId); setOpen(false); }} className="press" style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px', borderRadius:10, background: o.deviceId===sinkId ? hex2rgba(T.accent,.12) : 'none', border:'none', cursor:'pointer', textAlign:'left' }}>
              {/blue|airpod|buds|head|auric/i.test(o.label) ? <Icon.Headph c="var(--txt-1)" sz={15} /> : <Icon.Speaker c="var(--txt-1)" sz={15} />}
              <span style={{ fontSize:12, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{o.label || 'Dispositivo'}</span>
              {o.deviceId===sinkId && <Icon.Check c={T.accent} sz={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUEUE PANEL — cola con reordenamiento (arrastrar en escritorio + flechas)
// ═══════════════════════════════════════════════════════════════
function QueuePanel({ open, onClose, queue, current, play, T, reorder, remove }) {
  const [drag, setDrag] = useState(null);
  if (!open) return null;
  const ids = queue && queue.length ? queue : (current ? [current.id] : []);
  const items = ids.map(id => trackById(id)).map((t, i) => ({ t, id: ids[i] })).filter(x => x.t);
  const curIdx = current ? ids.indexOf(current.id) : -1;

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060ad9', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:110 }} />
      <div className="fade-up" style={{ position:'fixed', right:0, top:0, bottom:0, width:'min(440px, 100%)', background:'var(--surf-0)', borderLeft:'1px solid var(--line)', zIndex:111, display:'flex', flexDirection:'column', padding:'calc(env(safe-area-inset-top, 16px) + 18px) 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', boxShadow:'-30px 0 80px #000c' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ fontSize:18, fontWeight:900, color:'var(--txt-0)' }}>En cola</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={18} /></button>
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {items.length === 0 && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:40 }}>La cola está vacía.</div>}
          {items.map(({ t, id }, i) => {
            const isCur = id === current?.id;
            return (
              <div key={id + '_' + i} draggable
                onDragStart={() => setDrag(i)}
                onDragOver={e => { e.preventDefault(); if (drag !== null && drag !== i) { reorder(drag, i); setDrag(i); } }}
                onDragEnd={() => setDrag(null)}
                onDrop={() => setDrag(null)}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 8px', borderRadius:14, marginBottom:3, background: isCur ? hex2rgba(T.accent,.12) : (drag===i ? 'var(--surf-2)' : 'transparent'), border:`1px solid ${isCur ? hex2rgba(T.accent,.3) : 'transparent'}`, opacity: drag===i ? .85 : 1, transform: drag===i ? 'scale(1.02)' : 'none', boxShadow: drag===i ? '0 8px 24px #000a' : 'none', transition:'background .2s ease, transform .15s ease, box-shadow .2s ease', cursor: drag===i ? 'grabbing' : 'default' }}>
                <span style={{ cursor:'grab', display:'flex', flexShrink:0 }}><Icon.Grip c="var(--txt-3)" sz={16} /></span>
                <CoverImg src={t.cover} alt="" radius={9} style={{ width:40, height:40, flexShrink:0 }} />
                <div onClick={() => play(t, ids)} style={{ flex:1, minWidth:0, cursor:'pointer' }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color: isCur ? T.accent : 'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.title}{isCur ? ' · ▶' : ''}</div>
                  <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.artist}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}>
                  <button aria-label="Subir" disabled={i===0} onClick={() => i>0 && reorder(i, i-1)} className="press" style={{ background:'none', border:'none', cursor: i===0?'default':'pointer', padding:4, opacity: i===0?.3:1, transform:'rotate(180deg)' }}><Icon.ChevD c="var(--txt-2)" sz={16} /></button>
                  <button aria-label="Bajar" disabled={i===items.length-1} onClick={() => i<items.length-1 && reorder(i, i+1)} className="press" style={{ background:'none', border:'none', cursor: i===items.length-1?'default':'pointer', padding:4, opacity: i===items.length-1?.3:1 }}><Icon.ChevD c="var(--txt-2)" sz={16} /></button>
                  {!isCur && <button aria-label="Quitar" onClick={() => remove(id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.X c="var(--txt-3)" sz={15} /></button>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:10, color:'var(--txt-3)', textAlign:'center', marginTop:10 }}>Arrastra o usa las flechas para reordenar</div>
      </div>
    </>
  );
}
