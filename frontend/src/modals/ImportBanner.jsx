import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';

export function ImportBanner({ job, T }) {
  if (!job || !job.busy) return null;
  return (
    <div className="fade-up glass" style={{ position:'fixed', bottom: 90, left: 16, right: 16, margin: '0 auto', maxWidth: 428, zIndex: 125, display:'flex', alignItems:'center', gap:12, background:`linear-gradient(135deg, ${hex2rgba(T.accent,.15)}, var(--surf-0))`, border:`1px solid ${hex2rgba(T.accent,.3)}`, borderRadius:18, padding:'12px 16px', boxShadow:'0 10px 30px #0008' }}>
      <Spinner c={T.accent} sz={18} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>Importando: {job.name}</div>
        <div style={{ fontSize:10, color:'var(--txt-2)', marginTop:2 }}>{job.total > 0 ? `Procesando ${job.current} de ${job.total} canciones (${job.progress}%)` : 'Conectando con YouTube...'}</div>
        <div style={{ width: '100%', height: 3, background: 'var(--surf-2)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
          <div style={{ width: `${job.progress}%`, height: '100%', background: grad(T), borderRadius: 99, transition: 'width .2s ease' }} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT RESULT MODAL

