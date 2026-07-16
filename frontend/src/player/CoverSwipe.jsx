import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { bestCoverFor } from '../catalog.js';
import { usePersisted, useViewport, useDominantColor, useHSwipe } from '../hooks.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function CoverSwipe({ next, prev, playing, glowF, ambientRgba, art, track, loadingAudio, nextCover, prevCover }) {
  const [dragX, setDragX] = useState(0);
  const [slideTo, setSlideTo] = useState(null); // null | 'next' | 'prev' | 'back'
  const sx = useRef(0), sy = useRef(0), lock = useRef(null), wRef = useRef(0);
  const boxRef = useRef(null);

  // Al cambiar de pista, recentrar al instante (sin animación).
  useEffect(() => { setSlideTo(null); setDragX(0); lock.current = null; }, [track?.id]);

  const clamp = (v, w) => Math.max(-w, Math.min(w, v));
  const onTouchStart = (e) => { const t = e.touches[0]; sx.current = t.clientX; sy.current = t.clientY; lock.current = null; setSlideTo(null); if (boxRef.current) wRef.current = boxRef.current.clientWidth; };
  const onTouchMove = (e) => {
    const t = e.touches[0]; const dx = t.clientX - sx.current, dy = t.clientY - sy.current;
    if (!lock.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) lock.current = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
    if (lock.current === 'h') { e.preventDefault(); setDragX(clamp(dx, wRef.current || 320)); }
  };
  const onTouchEnd = (e) => {
    if (lock.current !== 'h') { lock.current = null; return; }
    lock.current = null;
    const dx = e.changedTouches[0].clientX - sx.current;
    const w = wRef.current || 320;
    const th = Math.min(80, w * 0.22);
    if (dx < -th && nextCover) setSlideTo('next');
    else if (dx > th && prevCover) setSlideTo('prev');
    else setSlideTo('back');
  };
  const onTransitionEnd = () => {
    if (slideTo === 'next') next();
    else if (slideTo === 'prev') prev();
    else if (slideTo === 'back') { setSlideTo(null); setDragX(0); }
  };

  const w = wRef.current || 0;
  const transition = slideTo ? 'transform .34s cubic-bezier(.22,1,.36,1)' : 'none';
  const groupTx = slideTo === 'next' ? -w : slideTo === 'prev' ? w : (slideTo === 'back' ? 0 : dragX);

  const coverFace = (src, alt, size = 512) => (
    <div style={{ position:'relative', width:'100%', height:'100%', borderRadius:28, overflow:'hidden', boxShadow:`0 24px 70px ${ambientRgba(.30)}` }}>
      <CoverImg src={src} alt={alt || ''} radius={28} size={size} style={{ width:'100%', height:'100%' }} />
      <div style={{ position:'absolute', inset:0, borderRadius:28, boxShadow:'inset 0 1px 0 #ffffff22, inset 0 0 0 1px #ffffff10', pointerEvents:'none' }} />
    </div>
  );

  return (
    <div style={{ position:'relative', display:'flex', justifyContent:'center', alignItems:'center', marginBottom:22, flexShrink:0, touchAction:'pan-y' }}>
      {/* Fondo difuminado suave (edge-to-edge, radial, sin bordes) */}
      <div aria-hidden className="breathe" style={{ position:'absolute', width:`calc(${art} * 1.9)`, height:`calc(${art} * 1.9)`, top:'50%', left:'50%', borderRadius:'50%', background:`radial-gradient(circle, ${ambientRgba(.8)}, ${ambientRgba(.34)} 46%, transparent 72%)`, filter:'blur(90px)', opacity: playing ? .55 + glowF*.45 : .3, transition:'opacity .6s ease, background 1.4s ease', pointerEvents:'none', zIndex:0 }} />
      {/* Carrusel: portada actual + vecinas para el peek al deslizar */}
      <div
        ref={boxRef}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ position:'relative', width:art, height:art, borderRadius:28, overflow:'hidden', zIndex:1, flexShrink:0, touchAction:'pan-y', transform:`scale(${playing ? 1 : .97})`, transition:'transform .5s cubic-bezier(.22,1,.36,1)' }}
      >
        <div onTransitionEnd={onTransitionEnd} style={{ position:'absolute', inset:0, transform:`translateX(${groupTx}px)`, transition, willChange:'transform' }}>
          {prevCover && <div style={{ position:'absolute', top:0, left:'-104%', width:'100%', height:'100%' }}>{coverFace(prevCover)}</div>}
          <div style={{ position:'absolute', inset:0 }}>
            {coverFace(bestCoverFor(track.id, track.cover), track.title, 900)}
            {loadingAudio && <div style={{ position:'absolute', inset:0, borderRadius:28, display:'flex', alignItems:'center', justifyContent:'center', background:'#0006' }}><Spinner c="#fff" sz={32} /></div>}
          </div>
          {nextCover && <div style={{ position:'absolute', top:0, left:'104%', width:'100%', height:'100%' }}>{coverFace(nextCover)}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPANDED PLAYER

