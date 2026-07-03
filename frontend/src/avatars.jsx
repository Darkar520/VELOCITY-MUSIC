// ═══════════════════════════════════════════════════════════════
// Avatares vectoriales originales (SVG suave, alta calidad, sin IP de terceros).
// Mezcla de animales, criaturas y arquetipos (DJ, astronauta, etc.).
// viewBox 0 0 100 100. Fondo con degradado + ilustración plana con relieve.
// ═══════════════════════════════════════════════════════════════
import React from 'react';

export const AVATARS = [
  { id:'fox', name:'Zorro', bg:['#3b4a6b','#161d30'], art:(
    <g>
      <polygon points="20,42 27,8 49,36" fill="#ef7d3a" />
      <polygon points="80,42 73,8 51,36" fill="#ef7d3a" />
      <polygon points="25,36 30,17 41,34" fill="#3a1e12" />
      <polygon points="75,36 70,17 59,34" fill="#3a1e12" />
      <path d="M50 20C74 20 84 40 82 58 80 78 66 90 50 90 34 90 20 78 18 58 16 40 26 20 50 20Z" fill="#f2823a" />
      <path d="M50 52c10 0 20 8 16 22-4 12-12 16-16 16s-12-4-16-16c-4-14 6-22 16-22Z" fill="#fff6ef" />
      <ellipse cx="38" cy="52" rx="5" ry="6.2" fill="#2a1a12" />
      <ellipse cx="62" cy="52" rx="5" ry="6.2" fill="#2a1a12" />
      <circle cx="39.6" cy="50" r="1.7" fill="#fff" />
      <circle cx="63.6" cy="50" r="1.7" fill="#fff" />
      <path d="M50 65l6 6-6 4-6-4Z" fill="#2a1a12" />
    </g>
  ) },
  { id:'cat', name:'Gato', bg:['#3a2b5e','#201440'], art:(
    <g>
      <polygon points="22,40 26,10 47,33" fill="#9b7ee0" />
      <polygon points="78,40 74,10 53,33" fill="#9b7ee0" />
      <polygon points="27,33 30,18 41,31" fill="#f4b8d0" />
      <polygon points="73,33 70,18 59,31" fill="#f4b8d0" />
      <ellipse cx="50" cy="56" rx="32" ry="30" fill="#9b7ee0" />
      <ellipse cx="40" cy="54" rx="4.6" ry="6.2" fill="#241436" />
      <ellipse cx="60" cy="54" rx="4.6" ry="6.2" fill="#241436" />
      <circle cx="41.4" cy="52" r="1.5" fill="#fff" />
      <circle cx="61.4" cy="52" r="1.5" fill="#fff" />
      <path d="M50 63l4 3-4 3-4-3Z" fill="#f4b8d0" />
      <path d="M50 69q-6 6-12 3M50 69q6 6 12 3" stroke="#241436" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <g stroke="#ffffffb0" strokeWidth="1.4" strokeLinecap="round">
        <line x1="31" y1="61" x2="15" y2="59" /><line x1="31" y1="66" x2="15" y2="68" />
        <line x1="69" y1="61" x2="85" y2="59" /><line x1="69" y1="66" x2="85" y2="68" />
      </g>
    </g>
  ) },
  { id:'panda', name:'Panda', bg:['#22d3ee','#0e7490'], art:(
    <g>
      <circle cx="27" cy="27" r="12" fill="#1c1c22" />
      <circle cx="73" cy="27" r="12" fill="#1c1c22" />
      <ellipse cx="50" cy="56" rx="33" ry="31" fill="#fdfdfd" />
      <ellipse cx="37" cy="52" rx="9" ry="11" fill="#1c1c22" transform="rotate(-12 37 52)" />
      <ellipse cx="63" cy="52" rx="9" ry="11" fill="#1c1c22" transform="rotate(12 63 52)" />
      <circle cx="37" cy="53" r="3.2" fill="#fff" /><circle cx="63" cy="53" r="3.2" fill="#fff" />
      <circle cx="37" cy="53" r="1.5" fill="#1c1c22" /><circle cx="63" cy="53" r="1.5" fill="#1c1c22" />
      <ellipse cx="50" cy="66" rx="4" ry="3" fill="#1c1c22" />
      <path d="M50 69q-5 5 -10 3M50 69q5 5 10 3" stroke="#1c1c22" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  ) },
  { id:'bear', name:'Oso', bg:['#7dd3fc','#2563eb'], art:(
    <g>
      <circle cx="28" cy="28" r="11" fill="#8a5a3b" /><circle cx="72" cy="28" r="11" fill="#8a5a3b" />
      <circle cx="28" cy="28" r="5.5" fill="#b5825f" /><circle cx="72" cy="28" r="5.5" fill="#b5825f" />
      <ellipse cx="50" cy="56" rx="32" ry="30" fill="#9c6842" />
      <ellipse cx="50" cy="66" rx="17" ry="14" fill="#e6c8a8" />
      <circle cx="40" cy="52" r="3.7" fill="#2a1a12" /><circle cx="60" cy="52" r="3.7" fill="#2a1a12" />
      <circle cx="41" cy="50.6" r="1.2" fill="#fff" /><circle cx="61" cy="50.6" r="1.2" fill="#fff" />
      <ellipse cx="50" cy="62" rx="4.5" ry="3.4" fill="#2a1a12" />
      <path d="M50 65v5" stroke="#2a1a12" strokeWidth="1.7" strokeLinecap="round" />
    </g>
  ) },
  { id:'bunny', name:'Conejo', bg:['#f9a8d4','#db2777'], art:(
    <g>
      <ellipse cx="39" cy="24" rx="8" ry="22" fill="#f7f2fb" /><ellipse cx="61" cy="24" rx="8" ry="22" fill="#f7f2fb" />
      <ellipse cx="39" cy="26" rx="4" ry="15" fill="#f4b8d0" /><ellipse cx="61" cy="26" rx="4" ry="15" fill="#f4b8d0" />
      <ellipse cx="50" cy="62" rx="28" ry="26" fill="#f7f2fb" />
      <circle cx="40" cy="58" r="4" fill="#3a2740" /><circle cx="60" cy="58" r="4" fill="#3a2740" />
      <circle cx="41.2" cy="56.7" r="1.2" fill="#fff" /><circle cx="61.2" cy="56.7" r="1.2" fill="#fff" />
      <path d="M50 67l3.5 2.5-3.5 2.5-3.5-2.5Z" fill="#f4b8d0" />
      <path d="M50 72v3" stroke="#c98aa2" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ) },
  { id:'frog', name:'Rana', bg:['#0e3b2e','#05201a'], art:(
    <g>
      <circle cx="34" cy="30" r="14" fill="#77c944" /><circle cx="66" cy="30" r="14" fill="#77c944" />
      <circle cx="34" cy="28" r="6" fill="#fff" /><circle cx="66" cy="28" r="6" fill="#fff" />
      <circle cx="34" cy="29" r="2.7" fill="#123" /><circle cx="66" cy="29" r="2.7" fill="#123" />
      <path d="M22 48c0-8 56-8 56 0 4 26-12 40-28 40S18 74 22 48Z" fill="#77c944" />
      <path d="M35 66q15 12 30 0" stroke="#2f6b18" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="41" cy="60" r="1.9" fill="#2f6b18" /><circle cx="59" cy="60" r="1.9" fill="#2f6b18" />
    </g>
  ) },
  { id:'penguin', name:'Pingüino', bg:['#7dd3fc','#0ea5e9'], art:(
    <g>
      <ellipse cx="50" cy="54" rx="32" ry="35" fill="#23272e" />
      <ellipse cx="50" cy="62" rx="20" ry="25" fill="#fdfdfd" />
      <circle cx="41" cy="45" r="4" fill="#23272e" /><circle cx="59" cy="45" r="4" fill="#23272e" />
      <path d="M50 51l7 5-7 6-7-6Z" fill="#f5a623" />
    </g>
  ) },
  { id:'owl', name:'Búho', bg:['#c4b5fd','#6d28d9'], art:(
    <g>
      <polygon points="24,30 30,11 41,27" fill="#7c5cff" /><polygon points="76,30 70,11 59,27" fill="#7c5cff" />
      <path d="M20 42C20 20 80 20 80 42 80 70 66 88 50 88 34 88 20 70 20 42Z" fill="#7c5cff" />
      <circle cx="38" cy="47" r="13" fill="#fff" /><circle cx="62" cy="47" r="13" fill="#fff" />
      <circle cx="38" cy="47" r="6" fill="#1e1330" /><circle cx="62" cy="47" r="6" fill="#1e1330" />
      <circle cx="40" cy="45" r="2" fill="#fff" /><circle cx="64" cy="45" r="2" fill="#fff" />
      <path d="M50 55l6 6-6 5-6-5Z" fill="#f5a623" />
    </g>
  ) },
  { id:'robot', name:'Robot', bg:['#334155','#0f172a'], art:(
    <g>
      <line x1="50" y1="8" x2="50" y2="20" stroke="#8fd6ff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="8" r="4" fill="#8fd6ff" />
      <rect x="22" y="24" width="56" height="52" rx="15" fill="#dfe8f5" />
      <rect x="30" y="35" width="40" height="23" rx="8" fill="#141a24" />
      <circle cx="42" cy="46.5" r="5" fill="#31e0c0" /><circle cx="58" cy="46.5" r="5" fill="#31e0c0" />
      <rect x="40" y="64" width="20" height="5" rx="2.5" fill="#9fb2c8" />
    </g>
  ) },
  { id:'alien', name:'Alien', bg:['#1e293b','#0b1220'], art:(
    <g>
      <path d="M50 16C72 16 82 34 80 52 78 72 64 86 50 86 36 86 22 72 20 52 18 34 28 16 50 16Z" fill="#8be04e" />
      <ellipse cx="38" cy="52" rx="7" ry="11" fill="#10261a" transform="rotate(-18 38 52)" />
      <ellipse cx="62" cy="52" rx="7" ry="11" fill="#10261a" transform="rotate(18 62 52)" />
      <circle cx="39" cy="49" r="2" fill="#c9ffea" /><circle cx="63" cy="49" r="2" fill="#c9ffea" />
      <path d="M44 72q6 4 12 0" stroke="#2f6b18" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>
  ) },
  { id:'astro', name:'Astronauta', bg:['#312e81','#0b1026'], art:(
    <g>
      <circle cx="50" cy="52" r="34" fill="#eef3fb" />
      <circle cx="50" cy="52" r="26" fill="#0d1524" />
      <path d="M31 49a20 20 0 0 1 21 -15" stroke="#4aa3ff" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.85" />
      <circle cx="61" cy="43" r="4" fill="#ffffff" opacity="0.85" />
    </g>
  ) },
  { id:'dj', name:'DJ', bg:['#fda4af','#e11d48'], art:(
    <g>
      <circle cx="50" cy="55" r="29" fill="#ffd27a" />
      <circle cx="41" cy="51" r="4" fill="#3a2a10" /><circle cx="59" cy="51" r="4" fill="#3a2a10" />
      <path d="M40 63q10 9 20 0" stroke="#3a2a10" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M22 53a28 28 0 0 1 56 0" stroke="#1f1f27" strokeWidth="6" fill="none" />
      <rect x="15" y="49" width="13" height="23" rx="6.5" fill="#141a24" />
      <rect x="72" y="49" width="13" height="23" rx="6.5" fill="#141a24" />
    </g>
  ) },
];

export function PixelAvatar({ av, size = 52, round = true }) {
  return (
    <div style={{ width:size, height:size, borderRadius: round ? '50%' : size * 0.24, overflow:'hidden', background:`linear-gradient(140deg, ${av.bg[0]}, ${av.bg[1]})`, boxShadow:`0 6px 18px ${av.bg[0]}55, inset 0 1px 0 #ffffff26`, flexShrink:0 }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display:'block' }}>{av.art}</svg>
    </div>
  );
}

// Avatar universal: ilustración elegida, o inicial con degradado del tema.
export function Avatar({ avatar, name, email, T, size = 52, round = true }) {
  const av = AVATARS.find(a => a.id === avatar);
  if (av) return <PixelAvatar av={av} size={size} round={round} />;
  const letter = ((name || email || 'V').trim()[0] || 'V').toUpperCase();
  return (
    <div style={{ width:size, height:size, borderRadius: round ? '50%' : size * 0.24, background:`linear-gradient(135deg, ${T.accent}, ${T.accent2})`, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, color:'#04060a', fontSize: size * 0.4, flexShrink:0, boxShadow:`0 4px 16px ${T.accent}55` }}>{letter}</div>
  );
}
