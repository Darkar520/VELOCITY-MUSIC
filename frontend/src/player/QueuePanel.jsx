import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack } from '../catalog.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function QueuePanel({ open, onClose, queue, current, play, T, reorder, remove }) {
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


