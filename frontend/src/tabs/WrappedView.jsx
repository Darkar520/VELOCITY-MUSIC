import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack } from '../catalog.js';

export function WrappedView({ ctx }) {
  const { T, favs, setView, play, playStats } = ctx;
  const stats = playStats || {};
  const favSet = new Set(favs || []);
  const entries = Object.entries(stats).map(([id, v]) => ({ id, ...v }));
  const totalPlays = entries.reduce((s, e) => s + (e.count || 0), 0);
  const topTracks = entries.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 5);
  const artistAgg = {};
  entries.forEach(e => { const a = e.artist || '?'; if (!artistAgg[a]) artistAgg[a] = { plays: 0, tracks: 0, cover: e.cover }; artistAgg[a].plays += e.count || 0; artistAgg[a].tracks += 1; if (!artistAgg[a].cover) artistAgg[a].cover = e.cover; });
  const topArtists = Object.entries(artistAgg).sort((a, b) => b[1].plays - a[1].plays).slice(0, 5);
  const totalMin = Math.round(entries.reduce((s, e) => s + ((e.durationSeconds || 0) * (e.count || 0)), 0) / 60);
  const stat = (n, l) => (<div style={{ flex:1, background:'var(--surf-0)', border:'1px solid var(--line-soft)', borderRadius:18, padding:'16px 10px', textAlign:'center' }}><div style={{ fontSize:26, fontWeight:900, background:grad(T), WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', lineHeight:1 }}>{n}</div><div style={{ fontSize:9.5, color:'var(--txt-2)', fontWeight:800, letterSpacing:.8, textTransform:'uppercase', marginTop:6 }}>{l}</div></div>);
  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <button onClick={() => setView(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:16, paddingTop:4, fontSize:13, fontWeight:700 }}><Icon.ChevL c="var(--txt-1)" sz={18} /> Atras</button>
      <div style={{ position:'relative', overflow:'hidden', borderRadius:26, padding:'28px 22px', marginBottom:18, background:`linear-gradient(135deg, ${T.accent}, ${T.accent2})`, color:'#04060a', boxShadow:`0 20px 48px ${hex2rgba(T.accent,.45)}` }}>
        <div style={{ position:'absolute', top:-40, right:-30, width:150, height:150, borderRadius:'50%', background:'#ffffff55', filter:'blur(44px)', pointerEvents:'none' }} />
        <div style={{ position:'relative' }}><div style={{ fontSize:10.5, fontWeight:900, letterSpacing:2.5, textTransform:'uppercase', opacity:.8 }}>Velocity</div><div style={{ fontSize:30, fontWeight:900, letterSpacing:-.8, marginTop:3, lineHeight:1 }}>Wrapped</div><div style={{ fontSize:12, fontWeight:700, opacity:.85, marginTop:9 }}>Todo lo que has escuchado.</div></div>
      </div>
      <div style={{ display:'flex', gap:10, marginBottom:22 }}>{stat(totalPlays, 'Reproducciones')}{stat(entries.length, 'Canciones')}{stat(totalMin > 0 ? totalMin : '—', 'Minutos')}</div>
      {topArtists.length > 0 && (<><SectionHeader label="Tus Artistas Top" accent={T.accent} /><div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:22 }}>{topArtists.map(([a, info], i) => (<div key={a} style={{ display:'flex', alignItems:'center', gap:14, padding:'9px 12px', borderRadius:16, background:'var(--surf-0)', border:'1px solid var(--line-soft)' }}><div style={{ fontSize:17, fontWeight:900, color:T.accent, width:20, textAlign:'center' }}>{i+1}</div>{info.cover ? <CoverImg src={info.cover} alt="" radius={99} style={{ width:44, height:44, flexShrink:0 }} /> : <div style={{ width:44, height:44, borderRadius:'50%', background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, color:'#04060a', flexShrink:0 }}>{(a[0]||'?').toUpperCase()}</div>}<div style={{ minWidth:0, flex:1 }}><div style={{ fontSize:14, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a}</div><div style={{ fontSize:10, color:'var(--txt-2)', fontWeight:700, marginTop:2 }}>{info.plays} reproducciones</div></div></div>))}</div></>)}
      {topTracks.length > 0 && (<><SectionHeader label="Tus Canciones Top" accent={T.accent} /><div style={{ display:'flex', flexDirection:'column', gap:6 }}>{topTracks.map((t, i) => (<div key={t.id} onClick={() => play(t, topTracks.map(x => x.id))} className="card-hover" style={{ display:'flex', alignItems:'center', gap:14, padding:'8px 12px', borderRadius:16, cursor:'pointer', background:'var(--surf-0)', border:'1px solid var(--line-soft)' }}><div style={{ fontSize:17, fontWeight:900, color:T.accent, width:20, textAlign:'center' }}>{i+1}</div><CoverImg src={t.cover} alt="" radius={11} style={{ width:44, height:44, flexShrink:0 }} /><div style={{ minWidth:0, flex:1 }}><div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.title}</div><div style={{ fontSize:11, color:'var(--txt-2)', marginTop:2 }}>{t.artist}</div></div><span style={{ fontSize:9.5, fontWeight:800, color:T.accent, flexShrink:0 }}>{t.count}x</span></div>))}</div></>)}
      {entries.length === 0 && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>Reproduce musica y aqui veras tu Wrapped.</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME TAB

