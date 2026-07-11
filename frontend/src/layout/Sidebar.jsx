import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function Sidebar({ tab, setTab, nav, T, playlists, setOpenPlaylist, setView }) {
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

