// ═══════════════════════════════════════════════════════════════
// Componentes presentacionales reutilizables.
// ═══════════════════════════════════════════════════════════════
import React, { useState, useRef } from 'react';
import { Icon } from './Icons.jsx';
import { hex2rgba, grad, hiResCover } from './helpers.js';
import { FALLBACK_COVER } from './constants.js';

// Ecualizador visual (barras animadas).
export function EQViz({ color, color2, playing, bars = 10, h = 24, gap = 2.5 }) {
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

export function Spinner({ c, sz = 22 }) {
  return <svg className="loader" width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>;
}

// Anillo de progreso de descarga (estilo Spotify).
export function ProgressRing({ pct = 0, active = false, done = false, T, size = 22 }) {
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

// Botón "descargar todo" con anillo de progreso real.
export function DownloadAllButton({ ids, downloaded, downloading, onClick, T }) {
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

// Imagen de carátula robusta: carga diferida, estado de carga y fallback al fallar.
export function CoverImg({ src, alt = '', radius = 12, className = '', style = {} }) {
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

export const SectionHeader = ({ label, accent, action }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:13, marginTop:4 }}>
    <div style={{ display:'flex', alignItems:'center', gap:9 }}>
      <div style={{ width:3, height:13, borderRadius:9, background:accent, boxShadow:`0 0 8px ${accent}` }} />
      <div style={{ fontSize:10.5, fontWeight:900, letterSpacing:2.5, color:'var(--txt-1)', textTransform:'uppercase' }}>{label}</div>
    </div>
    {action}
  </div>
);

export function TrackRow({ track, active, playing, T, onClick, onFav, faved, onAdd, onRemove, onMenu, downloaded, downloading, selecting, selected, onSelect, onSwipeQueue }) {
  const [dragX, setDragX] = useState(0);
  const sx = useRef(0), sy = useRef(0), swiping = useRef(false), moved = useRef(false);
  const canSwipe = !!onSwipeQueue && !selecting;
  const onTouchStart = (e) => { if (!canSwipe) return; sx.current = e.touches[0].clientX; sy.current = e.touches[0].clientY; swiping.current = false; moved.current = false; };
  const onTouchMove = (e) => {
    if (!canSwipe) return;
    const dx = e.touches[0].clientX - sx.current, dy = e.touches[0].clientY - sy.current;
    if (!swiping.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) swiping.current = true;
    if (swiping.current) { moved.current = true; setDragX(Math.max(-100, Math.min(100, dx))); }
  };
  const onTouchEnd = () => {
    if (!canSwipe) return;
    if (swiping.current && Math.abs(dragX) > 64) onSwipeQueue(track.id);
    setDragX(0); swiping.current = false;
  };
  const handleClick = selecting ? () => onSelect(track.id) : (e) => { if (moved.current) { moved.current = false; return; } onClick && onClick(e); };
  return (
    <div style={{ position:'relative', borderRadius:16, overflow:'hidden' }}>
      {canSwipe && dragX !== 0 && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent: dragX > 0 ? 'flex-start' : 'flex-end', padding:'0 22px', background: hex2rgba(T.accent, .16), borderRadius:16 }}>
          <span style={{ display:'flex', alignItems:'center', gap:6, color:T.accent, fontSize:11, fontWeight:800 }}><Icon.Queue c={T.accent} sz={16} /> A la cola</span>
        </div>
      )}
      <div onClick={handleClick} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="card-hover" style={{
        display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer',
        transform: dragX ? `translateX(${dragX}px)` : 'none', transition: dragX ? 'none' : 'transform .2s ease',
        background: (selected) ? hex2rgba(T.accent,.14) : active ? `linear-gradient(135deg, ${hex2rgba(T.accent,.14)}, ${hex2rgba(T.accent2,.05)})` : 'var(--bg-0)',
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
    </div>
  );
}

export function MediaCard({ cover, title, subtitle, T, onClick, onPlay, onFav, onMenu, faved }) {
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

// Tarjeta de mezcla/playlist (collage de carátulas).
export function MixCard({ mix, T, onPlay, onOpen }) {
  const tracks = mix.tracks || [];
  let covers = [...new Set(tracks.map(t => t.cover).filter(c => c && !c.startsWith('data:')))].slice(0, 4);
  if (!covers.length) covers = [FALLBACK_COVER];
  while (covers.length < 4) covers.push(covers[covers.length - 1]);
  const artists = [...new Set(tracks.map(t => t.artist).filter(Boolean))].slice(0, 3).join(' · ');
  return (
    <div className="card-hover media-card" style={{ flexShrink:0, width:150 }}>
      <div onClick={onOpen} style={{ position:'relative', width:150, height:150, borderRadius:16, overflow:'hidden', marginBottom:9, cursor:'pointer', boxShadow:'0 8px 22px #0007' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr 1fr', width:'100%', height:'100%', gap:1 }}>
          {covers.map((c, i) => <img key={i} src={hiResCover(c)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />)}
        </div>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, transparent 40%, #000c)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:8, left:10, fontSize:8.5, fontWeight:900, letterSpacing:1.5, color:'#fff', textTransform:'uppercase', opacity:.9, textShadow:'0 1px 3px #000' }}>Mezcla</div>
        <button aria-label="Reproducir mezcla" onClick={e => { e.stopPropagation(); onPlay(); }} className="btn-tap" style={{ position:'absolute', bottom:8, right:8, width:38, height:38, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 4px 14px ${hex2rgba(T.accent,.6)}` }}><Icon.Play c="#04060a" sz={18} /></button>
      </div>
      <div onClick={onOpen} style={{ fontSize:12, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }}>{mix.label.replace(/^Mezcla · /, '')}</div>
      <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{artists || `${tracks.length} canciones`}</div>
    </div>
  );
}

export function RangeSlider({ value, min, max, onChange, accent, step=1, ariaLabel }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ position:'relative', height:14, display:'flex', alignItems:'center' }}>
      <div style={{ position:'absolute', left:0, right:0, height:4, background:'var(--surf-2)', borderRadius:99 }} />
      <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:4, width:`${pct}%`, background:accent, borderRadius:99, boxShadow:`0 0 8px ${accent}` }} />
      <input type="range" min={min} max={max} step={step} value={value} aria-label={ariaLabel} onChange={e => onChange(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
    </div>
  );
}

export function SettingCard({ title, children, badge, accent }) {
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

export function ToggleRow({ label, desc, on, onToggle, T }) {
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
