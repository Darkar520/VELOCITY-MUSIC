import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';
import { parseTextPlaylist } from '../import/parsePlaylist.js';
import { isSpotifyUrl } from '../spotifyImport.js';

export function ImportPlaylistModal({ onClose, onImport, onImportText, T }) {
  const [mode, setMode] = useState('yt'); // 'yt' | 'spotify'
  const [url, setUrl] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [trackList, setTrackList] = useState('');
  const [busy, setBusy] = useState(false);
  const [bmCopied, setBmCopied] = useState(false);
  const parsedCount = useMemo(() => parseTextPlaylist(trackList).length, [trackList]);

  const submitYt = (e) => {
    e.preventDefault();
    const v = url.trim();
    if (!v || busy) return;
    if (isSpotifyUrl(v)) {
      setMode('spotify');
      return;
    }
    setBusy(true);
    Promise.resolve(onImport(v)).finally(() => setBusy(false));
  };

  const submitSpotify = (e) => {
    e.preventDefault();
    if (!trackList.trim() || busy) return;
    const name = playlistName.trim() || 'Playlist de Spotify';
    setBusy(true);
    Promise.resolve(onImportText(name, trackList.trim())).finally(() => setBusy(false));
  };

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(SPOTIFY_BOOKMARKLET);
      setBmCopied(true);
      setTimeout(() => setBmCopied(false), 2500);
    } catch {
      window.prompt('Copia este marcador y guárdalo en favoritos:', SPOTIFY_BOOKMARKLET);
    }
  };

  const pasteClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) {
        setTrackList(t.trim());
        if (!playlistName.trim()) setPlaylistName('Playlist de Spotify');
      }
    } catch {
      /* permisos denegados: el usuario pega con Ctrl+V */
    }
  };

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setTrackList(String(ev.target.result || ''));
      if (!playlistName.trim()) setPlaylistName(file.name.replace(/\.[^.]+$/, '') || 'Playlist importada');
    };
    reader.readAsText(file);
  };

  const segBtn = (id, label) => (
    <button type="button" onClick={() => setMode(id)} style={{ flex:1, padding:'9px 0', border:'none', borderRadius:11, background: mode === id ? 'var(--surf-0)' : 'transparent', color: mode === id ? 'var(--txt-0)' : 'var(--txt-2)', fontSize:12, fontWeight:800, cursor:'pointer', boxShadow: mode === id ? '0 1px 4px #0005' : 'none' }}>{label}</button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', zIndex:120 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'88dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 18px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:121, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 14px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:16, fontWeight:900, color:'var(--txt-0)' }}>Importar playlist</div>
          <button aria-label="Cerrar" onClick={onClose} className="press" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-1)" sz={20} /></button>
        </div>

        <div style={{ display:'flex', gap:4, background:'var(--surf-2)', padding:4, borderRadius:14, marginBottom:16 }}>
          {segBtn('yt', 'YouTube Music')}
          {segBtn('spotify', 'Spotify (gratis)')}
        </div>

        {mode === 'yt' && (
          <>
            <div style={{ fontSize:12, color:'var(--txt-2)', marginBottom:14, lineHeight:1.5 }}>
              Pega el enlace de una playlist <b style={{ color:'var(--txt-1)' }}>pública</b> de YouTube o YouTube Music. Se importa con un toque.
            </div>
            <form onSubmit={submitYt} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <input autoFocus type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://music.youtube.com/playlist?list=…" style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'12px 14px', fontSize:13, color:'var(--txt-0)', outline:'none' }} />
              <button type="submit" disabled={!url.trim() || busy} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:14, padding:'13px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity: (!url.trim() || busy) ? 0.55 : 1 }}>
                {busy ? <Spinner c="#04060a" sz={18} /> : <Icon.Down c="#04060a" sz={18} />}
                Empezar importación
              </button>
            </form>
          </>
        )}

        {mode === 'spotify' && (
          <>
            <div style={{ fontSize:12, color:'var(--txt-2)', marginBottom:12, lineHeight:1.55 }}>
              Spotify bloqueó su API gratis (exige Premium). Esta vía es <b style={{ color:'var(--txt-1)' }}>100% gratis</b>: lees la playlist en el navegador y Velocity busca cada tema en YouTube Music.
            </div>

            <div style={{ background:'var(--surf-2)', borderRadius:14, padding:'12px 14px', marginBottom:14, fontSize:11.5, color:'var(--txt-1)', lineHeight:1.55 }}>
              <div style={{ fontWeight:800, color:'var(--txt-0)', marginBottom:8 }}>En 3 pasos</div>
              <div style={{ marginBottom:6 }}><b style={{ color:T.accent }}>1.</b> Abre tu playlist o mix en <b>open.spotify.com</b> (navegador web, con tu cuenta).</div>
              <div style={{ marginBottom:6 }}><b style={{ color:T.accent }}>2.</b> Usa el <b>extractor</b> (marcador) para copiar todas las canciones.</div>
              <div><b style={{ color:T.accent }}>3.</b> Vuelve aquí, pega la lista e importa.</div>
            </div>

            <button type="button" onClick={copyBookmarklet} className="btn-tap" style={{ width:'100%', marginBottom:10, background: hex2rgba(T.accent, 0.14), border:`1px solid ${hex2rgba(T.accent, 0.35)}`, borderRadius:12, padding:'12px 14px', cursor:'pointer', color:T.accent, fontSize:12.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              <Icon.List c={T.accent} sz={16} />
              {bmCopied ? '✓ Extractor copiado — pégalo como marcador' : 'Copiar extractor (marcador)'}
            </button>
            <div style={{ fontSize:10.5, color:'var(--txt-3)', marginBottom:14, lineHeight:1.45 }}>
              Cómo instalarlo una vez: en el navegador crea un marcador nuevo y como URL pega lo copiado. En la playlist de Spotify, toca ese marcador.
            </div>

            <form onSubmit={submitSpotify} style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <input type="text" value={playlistName} onChange={e => setPlaylistName(e.target.value)} placeholder="Nombre de la playlist en Velocity" style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 14px', fontSize:13, color:'var(--txt-0)', outline:'none' }} />
              <textarea value={trackList} onChange={e => setTrackList(e.target.value)} placeholder={'Pega aquí la lista, una por línea:\nCanción - Artista\nCanción - Artista'} rows={6} style={{ width:'100%', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:12, padding:'11px 14px', fontSize:12, color:'var(--txt-0)', outline:'none', resize:'vertical', fontFamily:'ui-monospace,monospace', lineHeight:1.45 }} />
              <div style={{ display:'flex', gap:8 }}>
                <button type="button" onClick={pasteClipboard} className="press" style={{ flex:1, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:11, padding:'10px 0', cursor:'pointer', color:'var(--txt-1)', fontSize:11.5, fontWeight:700 }}>Pegar portapapeles</button>
                <label className="press" style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:11, padding:'10px 0', cursor:'pointer', color:'var(--txt-1)', fontSize:11.5, fontWeight:700 }}>
                  Archivo CSV
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} style={{ display:'none' }} />
                </label>
              </div>
              {parsedCount > 0 && (
                <div style={{ fontSize:11, color:T.accent, fontWeight:700 }}>{parsedCount} canciones detectadas</div>
              )}
              <button type="submit" disabled={parsedCount < 1 || busy} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:14, padding:'13px 0', cursor:'pointer', color:'#04060a', fontSize:13, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity: (parsedCount < 1 || busy) ? 0.55 : 1 }}>
                {busy ? <Spinner c="#04060a" sz={18} /> : <Icon.Down c="#04060a" sz={18} />}
                Buscar en YouTube Music e importar
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT PROGRESS BANNER

