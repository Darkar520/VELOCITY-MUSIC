// ═══════════════════════════════════════════════════════════════
// Constantes globales: CSS, temas, semillas de descubrimiento.
// ═══════════════════════════════════════════════════════════════

export const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  :root {
    --bg-0:#04060a; --bg-1:#080c12; --surf-0:#0b0f16; --surf-1:#10151e; --surf-2:#161c27;
    --line:#ffffff10; --line-soft:#ffffff08;
    --txt-0:#f4f7fb; --txt-1:#aab4c2; --txt-2:#7a8694; --txt-3:#737e8c;
  }
  *, *::before, *::after { box-sizing: border-box; }
  @keyframes fadeUp      { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes eqBar       { from { transform:scaleY(.16); } to { transform:scaleY(1); } }
  @keyframes breathe     { 0%,100%{ opacity:.26; transform:translate(-50%,-50%) scale(.9); } 50%{ opacity:.6; transform:translate(-50%,-50%) scale(1.12); } }
  @keyframes spinSlow    { to { transform:rotate(360deg); } }
  @keyframes spin360     { to { transform:rotate(360deg); } }
  @keyframes coverInLeft  { from { opacity:.4; transform:scale(.94) translateX(60px);  } to { opacity:1; transform:scale(1) translateX(0); } }
  @keyframes coverInRight { from { opacity:.4; transform:scale(.94) translateX(-60px); } to { opacity:1; transform:scale(1) translateX(0); } }
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

// Paleta base (tema oscuro por defecto). Los skins pueden sobrescribir estas
// variables CSS para cambiar por completo el aspecto del reproductor.
export const BASE_VARS = {
  '--bg-0':'#04060a', '--bg-1':'#080c12', '--surf-0':'#0b0f16', '--surf-1':'#10151e', '--surf-2':'#161c27',
  '--line':'#ffffff10', '--line-soft':'#ffffff08',
  '--txt-0':'#f4f7fb', '--txt-1':'#aab4c2', '--txt-2':'#7a8694', '--txt-3':'#737e8c',
};

export const THEMES = {
  // ── Acentos sobre el tema oscuro base ──
  emerald: { name:'Esmeralda', accent:'#10d9a0', accent2:'#06b6d4' },
  violet:  { name:'Violeta',   accent:'#a78bfa', accent2:'#ec4899' },
  ocean:   { name:'Océano',    accent:'#38bdf8', accent2:'#6366f1' },
  solar:   { name:'Solar',     accent:'#fbbf24', accent2:'#f97316' },
  rose:    { name:'Rosa',      accent:'#fb7185', accent2:'#f43f5e' },
  gold:    { name:'Oro',       accent:'#eab308', accent2:'#f59e0b' },
  ice:     { name:'Hielo',     accent:'#7dd3fc', accent2:'#e0f2fe' },

  // ── Neón intenso (colores saturados que "brillan" sobre el fondo oscuro) ──
  neonLime:   { name:'Neón Lima',    accent:'#39ff14', accent2:'#00ffa3' },
  neonMagenta:{ name:'Neón Magenta', accent:'#ff10f0', accent2:'#ff5fd2' },
  neonCyan:   { name:'Neón Cian',    accent:'#00fff7', accent2:'#18e0ff' },
  neonPurple: { name:'Neón Púrpura', accent:'#b026ff', accent2:'#e000ff' },
  neonOrange: { name:'Neón Fuego',   accent:'#ff6a00', accent2:'#ff2e00' },
  neonPink:   { name:'Neón Rosa',    accent:'#ff2e88', accent2:'#ff0059' },
  neonBlue:   { name:'Neón Azul',    accent:'#2d5bff', accent2:'#00d4ff' },
  neonYellow: { name:'Neón Ácido',   accent:'#eaff00', accent2:'#aaff00' },
  neonRed:    { name:'Neón Láser',   accent:'#ff073a', accent2:'#ff2e63' },
  neonTeal:   { name:'Neón Menta',   accent:'#00ffc8', accent2:'#00e0ff' },

  // ── Skins completos (cambian todo el aspecto) ──
  matrix: {
    name:'Matrix', accent:'#22ff88', accent2:'#00cc66',
    vars: {
      '--bg-0':'#000500', '--bg-1':'#001200', '--surf-0':'#021705', '--surf-1':'#04240a', '--surf-2':'#063311',
      '--line':'#22ff8820', '--line-soft':'#22ff8810',
      '--txt-0':'#c8ffd8', '--txt-1':'#5fdc8a', '--txt-2':'#2f8a55', '--txt-3':'#1c5636',
    },
  },
  cyberpunk: {
    name:'Cyberpunk', accent:'#ff2bd6', accent2:'#00e5ff',
    vars: {
      '--bg-0':'#0a0014', '--bg-1':'#12001f', '--surf-0':'#160a24', '--surf-1':'#1f1030', '--surf-2':'#2a163f',
      '--line':'#ff2bd620', '--line-soft':'#00e5ff10',
      '--txt-0':'#fdeaff', '--txt-1':'#c39ad6', '--txt-2':'#7c5a92', '--txt-3':'#4d3a5e',
    },
  },
  vapor: {
    name:'Vaporwave', accent:'#ff71ce', accent2:'#01cdfe',
    vars: {
      '--bg-0':'#12082a', '--bg-1':'#1a0f3a', '--surf-0':'#1d1140', '--surf-1':'#271650', '--surf-2':'#331e63',
      '--line':'#ff71ce22', '--line-soft':'#01cdfe12',
      '--txt-0':'#fdf0ff', '--txt-1':'#c4a8e8', '--txt-2':'#8268b0', '--txt-3':'#544080',
    },
  },
  crimson: {
    name:'Carmesí', accent:'#ff3b3b', accent2:'#ff7849',
    vars: {
      '--bg-0':'#0d0303', '--bg-1':'#160505', '--surf-0':'#1a0808', '--surf-1':'#240c0c', '--surf-2':'#331313',
      '--line':'#ff3b3b1e', '--line-soft':'#ff3b3b0e',
      '--txt-0':'#ffecec', '--txt-1':'#d6a3a3', '--txt-2':'#8a5b5b', '--txt-3':'#563a3a',
    },
  },
  mono: {
    name:'Mono', accent:'#e5e7eb', accent2:'#9ca3af',
    vars: {
      '--bg-0':'#000000', '--bg-1':'#050505', '--surf-0':'#0c0c0c', '--surf-1':'#141414', '--surf-2':'#1e1e1e',
      '--line':'#ffffff14', '--line-soft':'#ffffff0a',
      '--txt-0':'#fafafa', '--txt-1':'#b4b4b4', '--txt-2':'#6b6b6b', '--txt-3':'#3f3f3f',
    },
  },
};

// Búsquedas semilla actuales y relevantes (rotan dinámicamente).
export const SEED_ROWS = [
  { label:'Éxitos del Momento', q:'top hits 2025' },
  { label:'Virales Ahora',      q:'viral hits 2025' },
  { label:'Novedades',          q:'new music this week' },
  { label:'En Ascenso',         q:'rising hits 2025' },
  { label:'Indie Fresco',       q:'indie 2025' },
  { label:'Acústico',           q:'acoustic sessions' },
  { label:'En Vivo',            q:'live sessions' },
  { label:'Joyas Ocultas',      q:'underrated 2025' },
  { label:'Remixes',            q:'best remixes 2025' },
  { label:'Éxitos Globales',    q:'global top 50' },
];

// Lo que suena en Latinoamérica (foco regional, actual).
export const LATIN_ROWS = [
  { label:'Reggaetón Ahora',    q:'reggaeton 2025' },
  { label:'Corridos Tumbados',  q:'corridos tumbados 2025' },
  { label:'Regional Mexicano',  q:'regional mexicano 2025' },
  { label:'Pop Latino',         q:'pop latino 2025' },
  { label:'Trap Latino',        q:'trap latino 2025' },
  { label:'Salsa y Timba',      q:'salsa hits' },
  { label:'Bachata',            q:'bachata 2025' },
  { label:'Cumbia',             q:'cumbia hits' },
  { label:'Rock en Español',    q:'rock en español' },
  { label:'Baladas en Español', q:'baladas romanticas español' },
  { label:'Perreo',             q:'perreo intenso 2025' },
  { label:'Éxitos Latinos',     q:'latino top hits 2025' },
];

// Descubrimiento "fuera de la burbuja": escenas y estilos para expandir el gusto.
export const DISCOVERY = [
  { label:'Afrobeats',        q:'afrobeats 2025' },
  { label:'Amapiano',         q:'amapiano hits' },
  { label:'Neo Soul',         q:'neo soul' },
  { label:'Jazz Moderno',     q:'modern jazz' },
  { label:'Bossa Nova',       q:'bossa nova classics' },
  { label:'Funk Brasileño',   q:'funk brasileiro' },
  { label:'Flamenco Fusión',  q:'flamenco fusion' },
  { label:'Dream Pop',        q:'dream pop' },
  { label:'City Pop',         q:'japanese city pop' },
  { label:'Soul Clásico',     q:'classic soul motown' },
  { label:'Afro House',       q:'afro house' },
  { label:'Indie Latino',     q:'indie latino' },
];

export const GENRES = [
  { label:'Reggaetón', color:'#a78bfa', q:'reggaeton 2025' },        { label:'Regional Mexicano', color:'#fb923c', q:'regional mexicano 2025' },
  { label:'Pop Latino', color:'#fb7185', q:'pop latino' },           { label:'Trap Latino', color:'#a3e635', q:'trap latino' },
  { label:'Salsa', color:'#f97316', q:'salsa' },                     { label:'Bachata', color:'#fca5a5', q:'bachata' },
  { label:'Cumbia', color:'#f59e0b', q:'cumbia' },                   { label:'Pop', color:'#f472b6', q:'pop hits 2025' },
  { label:'Hip-Hop', color:'#10d9a0', q:'hip hop' },                 { label:'Rock', color:'#38bdf8', q:'rock' },
  { label:'Rock en Español', color:'#60a5fa', q:'rock en español' }, { label:'Electrónica', color:'#818cf8', q:'electronic' },
  { label:'R&B', color:'#c084fc', q:'r&b soul' },                    { label:'Indie', color:'#f9a8d4', q:'indie' },
  { label:'Lo-Fi', color:'#fbbf24', q:'lofi' },                      { label:'Baladas', color:'#e2e8f0', q:'baladas' },
  { label:'Trap', color:'#94a3b8', q:'trap music' },                 { label:'House', color:'#22d3ee', q:'house music' },
];

// Selección amplia y curada de géneros/estilos para el onboarding. Cada uno con
// una búsqueda semilla que devuelve una pista real coherente (no ruido).
export const ONBOARDING_GENRES = [
  { label:'Reggaetón', q:'reggaeton 2025' },
  { label:'Regional Mexicano', q:'regional mexicano 2025' },
  { label:'Corridos Tumbados', q:'corridos tumbados 2025' },
  { label:'Pop Latino', q:'pop latino 2025' },
  { label:'Trap Latino', q:'trap latino 2025' },
  { label:'Salsa', q:'salsa clasicos' },
  { label:'Bachata', q:'bachata 2025' },
  { label:'Cumbia', q:'cumbia 2025' },
  { label:'Merengue', q:'merengue clasico' },
  { label:'Pop', q:'pop hits 2025' },
  { label:'Pop en Inglés', q:'english pop hits 2025' },
  { label:'Hip-Hop', q:'hip hop 2025' },
  { label:'Rap en Español', q:'rap en español 2025' },
  { label:'Trap', q:'trap music 2025' },
  { label:'R&B', q:'rnb soul 2025' },
  { label:'Rock', q:'rock hits' },
  { label:'Rock en Español', q:'rock en español clasicos' },
  { label:'Rock Alternativo', q:'alternative rock' },
  { label:'Indie', q:'indie hits 2025' },
  { label:'Indie Pop', q:'indie pop' },
  { label:'Metal', q:'metal hits' },
  { label:'Punk', q:'punk rock' },
  { label:'Electrónica', q:'electronic dance 2025' },
  { label:'House', q:'house music 2025' },
  { label:'Techno', q:'techno 2025' },
  { label:'EDM', q:'edm festival 2025' },
  { label:'Lo-Fi', q:'lofi beats' },
  { label:'K-Pop', q:'kpop 2025' },
  { label:'Afrobeats', q:'afrobeats 2025' },
  { label:'Amapiano', q:'amapiano 2025' },
  { label:'Jazz', q:'jazz classics' },
  { label:'Soul', q:'soul classics' },
  { label:'Funk', q:'funk classics' },
  { label:'Disco', q:'disco classics' },
  { label:'Baladas', q:'baladas romanticas' },
  { label:'Clásica', q:'classical music' },
  { label:'Country', q:'country hits 2025' },
  { label:'Blues', q:'blues classics' },
  { label:'Reggae', q:'reggae classics' },
  { label:'Dembow', q:'dembow 2025' },
  { label:'Neo Soul', q:'neo soul hits' },
  { label:'Drill', q:'uk drill music' },
  { label:'Phonk', q:'phonk music 2024' },
  { label:'Flamenco', q:'flamenco moderno' },
  { label:'Bossa Nova', q:'bossa nova classics' },
  { label:'Cumbia Villera', q:'cumbia villera argentina' },
  { label:'Vallenato', q:'vallenato colombiano' },
  { label:'Grupero', q:'musica grupera mexicana' },
  { label:'Gospel', q:'gospel music' },
  { label:'Alternativo', q:'alternative music 2024' },
];

// Mixes por estado de ánimo / momento (se muestrean aleatoriamente cada vez).
export const MOODS = [
  { label:'Chill',          q:'chill music' },
  { label:'Sad',            q:'sad songs' },
  { label:'Synthwave',      q:'synthwave' },
  { label:'Buen Rollo',     q:'feel good music' },
  { label:'Fiesta',         q:'party hits' },
  { label:'Concentración',  q:'deep focus music' },
  { label:'Romántico',      q:'love songs' },
  { label:'Entrenamiento',  q:'workout music' },
  { label:'Para Dormir',    q:'calm sleep music' },
  { label:'Nostalgia',      q:'throwback hits' },
  { label:'Lluvia',         q:'rainy day music' },
  { label:'Café',           q:'coffee shop music' },
  { label:'Carretera',      q:'road trip songs' },
  { label:'Verano',         q:'summer hits' },
  { label:'Melancolía',     q:'melancholic songs' },
  { label:'Energía',        q:'high energy music' },
  { label:'Relax',          q:'relaxing music' },
  { label:'Motivación',     q:'motivation music' },
  { label:'Domingo',        q:'sunday chill' },
  { label:'Madrugada',      q:'late night vibes' },
  { label:'Desamor',        q:'heartbreak songs' },
  { label:'Bailar',         q:'dance hits' },
  { label:'Retro',          q:'retro classics' },
  { label:'Estudiar',       q:'study music' },
];

// Épocas / décadas (se muestrean aleatoriamente en "Viaja en el tiempo").
export const ERAS = [
  { label:'Éxitos 2020s',        q:'top hits 2023' },
  { label:'Lo mejor de los 2010s', q:'best songs 2010s' },
  { label:'Clásicos de los 2000s', q:'top hits 2000s' },
  { label:'Rock de los 90',      q:'best rock 90s' },
  { label:'Éxitos de los 80',    q:'greatest hits 80s' },
  { label:'Disco de los 70',     q:'70s disco hits' },
  { label:'Grunge de los 90',    q:'90s grunge' },
  { label:'Pop Y2K',             q:'y2k pop hits' },
  { label:'Oldies de los 60',    q:'60s oldies' },
  { label:'Latinos Clásicos',    q:'latin classics' },
  { label:'Pop 2010s',           q:'2010s pop hits' },
  { label:'Baladas de Antaño',   q:'classic ballads' },
];

export const FALLBACK_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2230"/><stop offset="1" stop-color="#0b0f16"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="50%" y="54%" font-size="44" text-anchor="middle" fill="#39414f">♪</text></svg>`
);
