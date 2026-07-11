import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function ImportResultModal({ job, onClose, onGoToPlaylist, T }) {
  if (!job) return null;
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:120 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:121, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Importación finalizada</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
        </div>
        {job.error ? (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:hex2rgba('#fb7185',.15), display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}><Icon.X c="#fb7185" sz={24} /></div>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--txt-0)', marginBottom:6 }}>Hubo un problema</div>
            <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.5 }}>{job.error}</div>
            <button onClick={onClose} className="btn-tap" style={{ background:'var(--surf-2)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 24px', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:800, marginTop:16 }}>Cerrar</button>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:hex2rgba(T.accent,.15), display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}><Icon.Check c={T.accent} sz={24} /></div>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--txt-0)', marginBottom:6 }}>¡Éxito al importar!</div>
            <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.5, marginBottom:16 }}>Se importó la playlist <b>{job.name}</b> con {job.total} canciones.</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={onClose} className="btn-tap" style={{ flex:1, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'12px 0', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:800 }}>Cerrar</button>
              <button onClick={onGoToPlaylist} className="btn-tap" style={{ flex:1, background:grad(T), border:'none', borderRadius:12, padding:'12px 0', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Ver playlist</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}


