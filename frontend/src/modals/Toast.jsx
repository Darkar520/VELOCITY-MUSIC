import React, { useState, useEffect, useRef, useMemo } from 'react';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';

export function Toast({ msg, T }) {
  if (!msg) return null;
  return (
    <div className="fade-up glass" style={{ position:'fixed', bottom:'calc(env(safe-area-inset-bottom, 20px) + 96px)', left:'50%', transform:'translateX(-50%)', background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:99, padding:'11px 20px', zIndex:140, boxShadow:`0 10px 30px #000a, 0 0 20px ${hex2rgba(T.accent,.2)}`, fontSize:12.5, fontWeight:700, color:'var(--txt-0)', display:'flex', alignItems:'center', gap:8 }}>
      <Icon.Check c={T.accent} sz={16} /> {msg}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP

