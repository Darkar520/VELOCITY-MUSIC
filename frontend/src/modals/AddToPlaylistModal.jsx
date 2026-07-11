import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack } from '../catalog.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function AddToPlaylistModal({ trackId, onClose, playlists, createPlaylist, addToPlaylist, removeFromPlaylist, T }) {
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
// IMPORT PLAYLIST MODAL

