import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function MiniPlayerBar({ track, playing, togglePlay, loadingAudio, T, pct, setExpanded, setMenuTarget, next, prev }) {
  const { dragX, handlers } = useHSwipe({ onLeft: next, onRight: prev, threshold: 60 });
  const isSliding = Math.abs(dragX) > 0;
  return (
    <div
      {...handlers}
      onClick={() => !isSliding && setExpanded(true)}
      className="glass"
      style={{ background:`linear-gradient(135deg, ${hex2rgba(T.accent,.1)}, var(--surf-0))`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:20, padding:'10px 12px', display:'flex', alignItems:'center', gap:12, cursor:'pointer', boxShadow:`0 8px 28px ${hex2rgba(T.accent,.16)}, 0 2px 8px #0006`, position:'relative', overflow:'hidden', touchAction:'pan-y', userSelect:'none' }}
    >
      <div style={{ position:'absolute', bottom:0, left:0, height:2.5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${T.accent}`, transition:'width .15s linear' }} />
      <img
        src={track.cover ? hiResCover(track.cover, 96) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }}
        style={{ width:42, height:42, borderRadius:11, objectFit:'cover', flexShrink:0, boxShadow:'0 4px 12px #0007',
          transform: `translateX(${dragX * 0.6}px)`,
          transition: isSliding ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)',
          opacity: 1 - Math.abs(dragX) / 200,
        }}
      />
      <div style={{ flex:1, minWidth:0,
        transform: `translateX(${dragX * 0.25}px)`,
        transition: isSliding ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)',
      }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
        <div style={{ fontSize:10, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
      </div>
      <button aria-label={playing?'Pausar':'Reproducir'} onClick={e=>{ e.stopPropagation(); togglePlay(); }} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:'50%', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, boxShadow:`0 0 14px ${hex2rgba(T.accent,.55)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
      <button aria-label="Más" onClick={e=>{ e.stopPropagation(); setMenuTarget(track.id); }} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Dots c="var(--txt-1)" sz={19} /></button>
    </div>
  );
}


