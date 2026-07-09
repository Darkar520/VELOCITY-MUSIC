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
  { id:'dog', name:'Perro', bg:['#fbbf24','#b45309'], art:(
    <g>
      <ellipse cx="24" cy="48" rx="10" ry="20" fill="#7a5230" transform="rotate(-10 24 48)" />
      <ellipse cx="76" cy="48" rx="10" ry="20" fill="#7a5230" transform="rotate(10 76 48)" />
      <ellipse cx="50" cy="54" rx="30" ry="29" fill="#d9a066" />
      <ellipse cx="50" cy="66" rx="16" ry="13" fill="#f0dcc0" />
      <circle cx="40" cy="50" r="3.6" fill="#2a1a12" /><circle cx="60" cy="50" r="3.6" fill="#2a1a12" />
      <circle cx="41" cy="48.7" r="1.1" fill="#fff" /><circle cx="61" cy="48.7" r="1.1" fill="#fff" />
      <ellipse cx="50" cy="61" rx="4.6" ry="3.4" fill="#2a1a12" />
      <path d="M50 64v5" stroke="#2a1a12" strokeWidth="1.8" strokeLinecap="round" />
    </g>
  ) },
  { id:'wolf', name:'Lobo', bg:['#334155','#0f172a'], art:(
    <g>
      <polygon points="22,42 28,10 46,36" fill="#8792a3" /><polygon points="78,42 72,10 54,36" fill="#8792a3" />
      <polygon points="27,36 30,18 41,34" fill="#4b5563" /><polygon points="73,36 70,18 59,34" fill="#4b5563" />
      <path d="M50 22C72 22 82 42 80 58 78 76 66 90 50 90 34 90 22 76 20 58 18 42 28 22 50 22Z" fill="#9aa5b5" />
      <path d="M50 54c9 0 18 7 15 20-3 11-11 15-15 15s-12-4-15-15c-3-13 6-20 15-20Z" fill="#e5e9ef" />
      <ellipse cx="38" cy="52" rx="4.6" ry="6" fill="#20262e" /><ellipse cx="62" cy="52" rx="4.6" ry="6" fill="#20262e" />
      <path d="M50 65l5 5-5 4-5-4Z" fill="#20262e" />
    </g>
  ) },
  { id:'tiger', name:'Tigre', bg:['#0f172a','#020617'], art:(
    <g>
      <circle cx="30" cy="28" r="9" fill="#f2823a" /><circle cx="70" cy="28" r="9" fill="#f2823a" />
      <circle cx="30" cy="28" r="4.5" fill="#3a1e12" /><circle cx="70" cy="28" r="4.5" fill="#3a1e12" />
      <ellipse cx="50" cy="56" rx="31" ry="30" fill="#f2823a" />
      <ellipse cx="50" cy="66" rx="15" ry="12" fill="#fff6ef" />
      <path d="M50 26v11" stroke="#2a1a12" strokeWidth="3" strokeLinecap="round" />
      <path d="M41 30l-2 9M59 30l2 9" stroke="#2a1a12" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M22 50l9 3M78 50l-9 3" stroke="#2a1a12" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="40" cy="52" r="3.4" fill="#2a1a12" /><circle cx="60" cy="52" r="3.4" fill="#2a1a12" />
      <path d="M50 62l4 3-4 3-4-3Z" fill="#2a1a12" />
    </g>
  ) },
  { id:'lion', name:'León', bg:['#1f2937','#0b1220'], art:(
    <g>
      <circle cx="50" cy="52" r="37" fill="#a65a1e" />
      <g fill="#c47a2c">
        <circle cx="50" cy="15" r="8" /><circle cx="78" cy="26" r="8" /><circle cx="87" cy="52" r="8" /><circle cx="78" cy="78" r="8" />
        <circle cx="50" cy="89" r="8" /><circle cx="22" cy="78" r="8" /><circle cx="13" cy="52" r="8" /><circle cx="22" cy="26" r="8" />
      </g>
      <circle cx="50" cy="54" r="27" fill="#e3a862" />
      <circle cx="40" cy="50" r="3.4" fill="#3a1f10" /><circle cx="60" cy="50" r="3.4" fill="#3a1f10" />
      <path d="M50 57l4 3-4 3-4-3Z" fill="#3a1f10" />
      <path d="M50 63q-6 5-11 3M50 63q6 5 11 3" stroke="#3a1f10" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </g>
  ) },
  { id:'koala', name:'Koala', bg:['#94a3b8','#475569'], art:(
    <g>
      <circle cx="24" cy="42" r="15" fill="#9ca3af" /><circle cx="76" cy="42" r="15" fill="#9ca3af" />
      <circle cx="24" cy="42" r="8" fill="#cbd5e1" /><circle cx="76" cy="42" r="8" fill="#cbd5e1" />
      <ellipse cx="50" cy="56" rx="27" ry="27" fill="#aeb6c1" />
      <circle cx="41" cy="52" r="3.4" fill="#1f2733" /><circle cx="59" cy="52" r="3.4" fill="#1f2733" />
      <ellipse cx="50" cy="64" rx="7" ry="9" fill="#1f2733" />
    </g>
  ) },
  { id:'monkey', name:'Mono', bg:['#a16207','#5b3a0a'], art:(
    <g>
      <circle cx="23" cy="48" r="11" fill="#8a5a3b" /><circle cx="77" cy="48" r="11" fill="#8a5a3b" />
      <circle cx="23" cy="48" r="6" fill="#c98f63" /><circle cx="77" cy="48" r="6" fill="#c98f63" />
      <ellipse cx="50" cy="52" rx="28" ry="28" fill="#8a5a3b" />
      <ellipse cx="50" cy="63" rx="20" ry="19" fill="#e8c9a0" />
      <circle cx="42" cy="50" r="3.4" fill="#2a1a12" /><circle cx="58" cy="50" r="3.4" fill="#2a1a12" />
      <ellipse cx="46" cy="63" rx="2" ry="1.4" fill="#2a1a12" /><ellipse cx="54" cy="63" rx="2" ry="1.4" fill="#2a1a12" />
      <path d="M44 70q6 4 12 0" stroke="#2a1a12" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </g>
  ) },
  { id:'dino', name:'Dino', bg:['#065f46','#022c22'], art:(
    <g>
      <polygon points="38,22 42,10 47,22" fill="#3f8f43" /><polygon points="50,20 54,8 59,20" fill="#3f8f43" />
      <path d="M50 20C72 20 84 40 82 60 80 80 66 90 50 90 34 90 20 80 18 60 16 40 28 20 50 20Z" fill="#5eb85a" />
      <circle cx="40" cy="48" r="6.5" fill="#fff" /><circle cx="60" cy="48" r="6.5" fill="#fff" />
      <circle cx="41" cy="49" r="2.8" fill="#123" /><circle cx="61" cy="49" r="2.8" fill="#123" />
      <path d="M37 66h26" stroke="#245b28" strokeWidth="3" strokeLinecap="round" />
    </g>
  ) },
  { id:'unicorn', name:'Unicornio', bg:['#f9a8d4','#a855f7'], art:(
    <g>
      <polygon points="50,6 45,27 55,27" fill="#fde68a" />
      <ellipse cx="50" cy="57" rx="29" ry="29" fill="#fbfaff" />
      <path d="M31 36q7-12 17-7" stroke="#a855f7" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M69 36q-7-12-17-7" stroke="#22d3ee" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx="41" cy="55" r="3.6" fill="#3a2740" /><circle cx="59" cy="55" r="3.6" fill="#3a2740" />
      <ellipse cx="50" cy="67" rx="9" ry="6" fill="#f4b8d0" />
      <circle cx="46" cy="67" r="1.4" fill="#3a2740" /><circle cx="54" cy="67" r="1.4" fill="#3a2740" />
    </g>
  ) },
  { id:'ghost', name:'Fantasma', bg:['#6d28d9','#312e81'], art:(
    <g>
      <path d="M24 46C24 22 76 22 76 46 L76 84 L67 75 L58 84 L50 75 L42 84 L33 75 L24 84 Z" fill="#f5f6fa" />
      <circle cx="40" cy="46" r="5" fill="#2a2340" /><circle cx="60" cy="46" r="5" fill="#2a2340" />
      <ellipse cx="50" cy="57" rx="4" ry="6" fill="#2a2340" />
    </g>
  ) },
  { id:'ninja', name:'Ninja', bg:['#1f2937','#0b1220'], art:(
    <g>
      <circle cx="50" cy="52" r="33" fill="#232c3f" />
      <rect x="17" y="45" width="66" height="14" rx="7" fill="#f0d0a8" />
      <circle cx="40" cy="52" r="3.4" fill="#232c3f" /><circle cx="60" cy="52" r="3.4" fill="#232c3f" />
      <rect x="17" y="40" width="66" height="7" rx="2" fill="#e11d48" />
      <path d="M80 41l15-3v9l-15-2Z" fill="#e11d48" />
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
