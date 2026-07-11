import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api.js';
import * as offline from '../offline.js';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle, capPerArtist, slimTrack, parseLRC, lyricsOverlapRatio, plainFromSyncedLines, tintedVars } from '../helpers.js';
import { usePersisted, useViewport, useDominantColor, useHSwipe } from '../hooks.js';
import { FALLBACK_COVER } from '../constants.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, ProgressRing, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider, SettingCard, ToggleRow, ColorField } from '../components.jsx';
import { cacheTrack, cacheTracks, trackById, allCached, loadMeta, loadPlayerState, saveMeta, normalizeTrack } from '../catalog.js';
import { CoverSwipe } from './CoverSwipe.jsx';
import { DeviceChip } from './DeviceChip.jsx';

export function ExpandedPlayer({ open, onClose, track, playing, togglePlay, next, prev, time, dur, seek,
  vol, setVol, shuffle, setShuffle, repeat, setRepeat, faved, toggleFav, T, quality, glow, compact, desktop, onAdd, onMenu, loadingAudio, onQueue, outputs, sinkId, setOutput, lyricOffset = 0, setLyricOffset, audioRef, nextCover, prevCover, inLibrary = false }) {
  const [showLyrics, setShowLyrics] = useState(false);
  // iOS no permite controlar el volumen por software (solo botones físicos).
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  // Deslizar hacia abajo para minimizar (solo móvil, si el panel está arriba del todo).
  const swipeStartY = useRef(null);
  const swipeScrollTop = useRef(0);
  const onPanelTouchStart = (e) => { swipeStartY.current = e.touches[0].clientY; swipeScrollTop.current = e.currentTarget.scrollTop || 0; };
  const onPanelTouchEnd = (e) => {
    if (swipeStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    const startedAtTop = swipeScrollTop.current <= 4;
    swipeStartY.current = null;
    if (!desktop && startedAtTop && dy > 90) onClose();
  };
  const [lyricState, setLyricState] = useState({ status:'idle', synced:[], plain:[] });
  const lyricBoxRef = useRef(null);
  // Tiempo de alta frecuencia para la sincronía de la letra.
  // El evento timeUpdate del <audio> solo dispara ~4 veces/seg, lo que hace que
  // el resaltado vaya a saltos. Aquí leemos currentTime a ~15 Hz mientras la
  // letra está abierta y reproduciendo, para un seguimiento fluido y preciso.
  const [lyricTime, setLyricTime] = useState(0);
  useEffect(() => {
    if (!showLyrics && !desktop) return;
    const read = () => { const a = audioRef?.current; if (a) setLyricTime(a.currentTime || 0); };
    read();
    const id = setInterval(read, 66);
    return () => clearInterval(id);
  }, [showLyrics, desktop, audioRef, playing, track?.id]);
  // Tiempo efectivo: el de alta frecuencia si la letra está abierta, si no el prop.
  const effTime = showLyrics ? lyricTime : time;
  // Color dominante extraído de la portada actual
  const dominantColor = useDominantColor(track?.cover);
  const ambientHex = dominantColor?.hex || T.accent;
  const ambientR = dominantColor?.r ?? parseInt(T.accent.slice(1,3),16);
  const ambientG = dominantColor?.g ?? parseInt(T.accent.slice(3,5),16);
  const ambientB = dominantColor?.b ?? parseInt(T.accent.slice(5,7),16);
  const ambientRgba = (a) => `rgba(${ambientR},${ambientG},${ambientB},${a})`;

  useEffect(() => { if (!open) setShowLyrics(false); }, [open]);
  useEffect(() => {
    if ((!showLyrics && !desktop) || !track) return;
    let cancel = false;
    setLyricState({ status:'loading', synced:[], plain:[] });
    const base = { artist: track.artist, title: track.title, album: track.album, duration: track.durationSeconds, id: track.id };

    const applyLyrics = (d, { allowSynced = true } = {}) => {
      if (cancel || !d) return;
      const synced = allowSynced ? parseLRC(d.synced) : [];
      const plain = (d.plain || '').split(/\r?\n/).filter((l, i, a) => l || (i > 0 && i < a.length - 1));
      setLyricState((prev) => {
        // No degradar una letra sincronizada válida por una respuesta sin sync.
        if (prev.status === 'ok' && prev.synced.length && !synced.length) return prev;
        return { status: 'ok', synced, plain: plain.length ? plain : prev.plain || [], source: d.source };
      });
      // Offline: solo si la canción está en biblioteca (likes / playlist / mezcla guardada).
      if (inLibrary && track.id && (synced.length || plain.length)) {
        const lrcRaw = d.synced || null;
        offline.saveLyrics(track.id, {
          synced: lrcRaw,
          plain: d.plain || plain.join('\n'),
          source: d.source,
        }).catch(() => {});
      }
    };

    // 1) Caché offline primero (modo sin red o respuesta instantánea).
    offline.getLyrics(track.id).then((cached) => {
      if (cancel || !cached) return;
      if (cached.synced || cached.plain) {
        applyLyrics({ synced: cached.synced, plain: cached.plain, source: cached.source || 'offline' });
      }
    }).catch(() => {});

    // 2) Rápido (YT / lrclib filtrado / ovh)
    api.lyrics(base)
      .then((d) => {
        if (cancel) return;
        if (!d) {
          setLyricState((s) => (s.status === 'ok' ? s : { status: 'none', synced: [], plain: [] }));
          return;
        }
        applyLyrics(d);
      })
      .catch(() => {
        if (!cancel) setLyricState((s) => (s.status === 'ok' ? s : { status: 'none', synced: [], plain: [] }));
      });

    // 3) Sync largo: SOLO aceptar si la letra coincide con la plain ya mostrada
    //    (o si aún no había plain). Evita el "salto" a otra canción.
    api.lyrics({ ...base, sync: true })
      .then((d) => {
        if (cancel || !d || !d.synced) return;
        const synced = parseLRC(d.synced);
        if (!synced.length) return;
        const syncedPlain = plainFromSyncedLines(synced);
        setLyricState((prev) => {
          const prevPlain = (prev.plain || []).join('\n') || plainFromSyncedLines(prev.synced || []);
          if (prevPlain && prevPlain.trim().length > 40) {
            const ratio = lyricsOverlapRatio(prevPlain, syncedPlain || d.plain || '');
            if (ratio < 0.35) {
              // Letra sincronizada de OTRA canción → conservar la plain correcta.
              return prev;
            }
          }
          const plain = prev.plain?.length
            ? prev.plain
            : (d.plain || syncedPlain || '').split(/\r?\n/);
          if (inLibrary && track.id) {
            offline.saveLyrics(track.id, {
              synced: d.synced,
              plain: plain.join('\n'),
              source: 'lrclib',
            }).catch(() => {});
          }
          return { status: 'ok', synced, plain, source: 'lrclib' };
        });
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [showLyrics, desktop, track?.id, inLibrary]);

  const activeLyric = useMemo(() => {
    if (!lyricState.synced || !lyricState.synced.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyricState.synced.length; i++) { if (lyricState.synced[i].t <= effTime + lyricOffset) idx = i; else break; }
    return idx;
  }, [lyricState, effTime, lyricOffset]);

  useEffect(() => {
    if (activeLyric < 0 || !lyricBoxRef.current) return;
    const box = lyricBoxRef.current;
    const el = box.querySelector(`[data-li="${activeLyric}"]`);
    if (el) {
      // Scroll SOLO dentro de la caja de letra (no del panel completo),
      // centrando la línea activa. Evita saltos bruscos de toda la UI.
      const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [activeLyric]);

  if (!track) return null;
  const pct = dur > 0 ? (time / dur) * 100 : 0;
  const glowF = glow / 100;
  const art = desktop ? 'clamp(170px, 32vh, 300px)' : 'min(80vw, 360px)';
  const pad = compact ? 'calc(env(safe-area-inset-top, 14px) + 18px) 22px calc(env(safe-area-inset-bottom, 16px) + 26px)' : '52px 26px 36px';

  const panelBg = desktop
    ? `radial-gradient(130% 85% at 50% 0%, ${ambientRgba(.18 + glowF * .25)}, transparent 62%), var(--surf-0)`
    : `radial-gradient(130% 80% at 50% 0%, ${ambientRgba(.16 + glowF * .28)}, transparent 60%), var(--bg-0)`;

  const panelStyle = desktop ? {
    position:'fixed', top:'50%', left:'50%', transform:`translate(-50%,-50%) scale(${open?1:.95})`,
    width:'min(440px, 92vw)', maxHeight:'94vh', background: panelBg,
    border:'1px solid var(--line)', borderRadius:30, boxShadow:'0 40px 110px #000e',
    opacity: open?1:0, pointerEvents: open?'auto':'none',
    transition:'transform .42s cubic-bezier(.22,1,.36,1), opacity .3s ease, background 1.4s ease',
    zIndex:90, display:'flex', flexDirection:'column', padding:'22px 26px 26px', overflow:'hidden',
  } : {
    position:'absolute', inset:0, width:'100%', background: panelBg,
    transform: open ? 'translateY(0)' : 'translateY(100%)', opacity: open ? 1 : 0,
    transition:'transform .46s cubic-bezier(.22,1,.36,1), opacity .3s ease, background 1.4s ease',
    zIndex:90, display:'flex', flexDirection:'column', padding:pad, overflowY:'auto',
    boxSizing:'border-box', touchAction:'pan-y',
  };

  // ─────────── LAYOUT DESKTOP (estilo Spotify, pantalla completa) ───────────
  if (desktop) {
    const dArt = 'min(46vh, 440px)';
    const Transport = (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:26 }}>
        <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle ? 1 : .4 }}><Icon.Shuf c={shuffle ? T.accent : 'var(--txt-1)'} sz={19} /></button>
        <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={26} /></button>
        <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:60, height:60, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 ${20+glowF*26}px ${hex2rgba(T.accent,.55)}, 0 8px 24px #000a` }}>{loadingAudio ? <Spinner c="#04060a" sz={24} /> : (playing ? <Icon.Pause c="#04060a" sz={26} /> : <Icon.Play c="#04060a" sz={26} />)}</button>
        <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={26} /></button>
        <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat ? 1 : .4 }}><Icon.Rep c={repeat ? T.accent : 'var(--txt-1)'} sz={19} /></button>
      </div>
    );
    return (
      <div style={{ position:'fixed', inset:0, zIndex:90, opacity: open?1:0, pointerEvents: open?'auto':'none', transition:'opacity .38s ease', display:'flex', flexDirection:'column', background:`radial-gradient(120% 90% at 50% -10%, ${ambientRgba(.28 + glowF*.22)}, transparent 58%), var(--bg-0)`, fontFamily:'Inter,sans-serif' }}>
        {/* Barra superior */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 32px', flexShrink:0 }}>
          <button aria-label="Minimizar" onClick={onClose} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.ChevD c="var(--txt-1)" sz={20} /></button>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:9.5, fontWeight:900, letterSpacing:3, color:'var(--txt-2)', textTransform:'uppercase' }}>Reproduciendo desde</div>
            <div style={{ fontSize:13, fontWeight:800, color:'var(--txt-0)', marginTop:3 }}>{track.album || track.artist}</div>
          </div>
          <button aria-label="Cola de reproducción" onClick={onQueue} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Queue c={T.accent} sz={19} /></button>
        </div>

        {/* Cuerpo: portada + letra (bloque centrado con ancho máximo) */}
        <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'clamp(24px,4vw,56px)', padding:'0 clamp(20px,4vw,48px)', alignItems:'center', justifyContent:'center', width:'100%', maxWidth:1120, margin:'0 auto' }}>
          {/* Columna izquierda: portada + info */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minWidth:0 }}>
            <CoverSwipe next={next} prev={prev} playing={playing} glowF={glowF} ambientRgba={ambientRgba} art={dArt} track={track} loadingAudio={loadingAudio} nextCover={nextCover} prevCover={prevCover} />
            <div style={{ width:dArt, maxWidth:'100%', display:'flex', alignItems:'center', gap:14, marginTop:6 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:26, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
                <div style={{ fontSize:15, color:T.accent, marginTop:5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
              </div>
              <button aria-label="Me gusta" onClick={() => toggleFav(track.id)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:6, flexShrink:0 }}><Icon.Heart c={T.accent} filled={faved} sz={26} /></button>
              {onAdd && <button aria-label="Añadir" onClick={() => onAdd(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.Plus c="var(--txt-1)" sz={20} /></button>}
            </div>
          </div>

          {/* Columna derecha: letra */}
          <div style={{ height:'min(72vh, 620px)', display:'flex', flexDirection:'column', minWidth:0, background:'linear-gradient(180deg, var(--surf-0), transparent)', border:'1px solid var(--line-soft)', borderRadius:24, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, padding:'18px 24px 12px', flexShrink:0 }}>
              <Icon.Mic c={T.accent} sz={18} /><span style={{ fontSize:14, fontWeight:900, color:'var(--txt-0)' }}>Letra</span>
              {lyricState.status==='ok' && lyricState.synced.length>0 && setLyricOffset && (
                <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
                  <button aria-label="Atrasar letra" onClick={() => setLyricOffset(o => Math.round((o - 0.5) * 10) / 10)} className="press" style={{ width:26, height:26, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:14, fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontSize:10, color:'var(--txt-2)', fontWeight:700, minWidth:60, textAlign:'center' }}>{lyricOffset>0?'+':''}{lyricOffset.toFixed(1)}s</span>
                  <button aria-label="Adelantar letra" onClick={() => setLyricOffset(o => Math.round((o + 0.5) * 10) / 10)} className="press" style={{ width:26, height:26, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:14, fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              )}
            </div>
            <div ref={lyricBoxRef} style={{ flex:1, overflowY:'auto', padding:'6px 28px 28px' }}>
              {lyricState.status === 'loading' && <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, paddingTop:'30%', color:'var(--txt-2)' }}><Spinner c={T.accent} sz={22} /><span style={{ fontSize:13 }}>Buscando letra…</span></div>}
              {lyricState.status === 'none' && <div style={{ fontSize:14, color:'var(--txt-2)', paddingTop:'34%', textAlign:'center' }}>Letra no disponible para esta pista.</div>}
              {lyricState.status === 'ok' && lyricState.synced.length > 0 && (<>
                {lyricState.synced.map((l, i) => (
                  <div key={i} data-li={i} onClick={() => seek(l.t)} style={{ fontSize: i===activeLyric ? 26 : 20, fontWeight: i===activeLyric ? 800 : 700, color: i===activeLyric ? 'var(--txt-0)' : (i < activeLyric ? 'var(--txt-2)' : 'var(--txt-1)'), margin:'14px 0', lineHeight:1.35, transition:'all .25s ease', cursor:'pointer', opacity: i===activeLyric ? 1 : .55 }}>{l.text || '♪'}</div>
                ))}
                <div style={{ fontSize:10, color:'var(--txt-3)', marginTop:14 }}>Letra sincronizada · {lyricState.source}</div>
              </>)}
              {lyricState.status === 'ok' && lyricState.synced.length === 0 && (<>
                {lyricState.plain.map((line, i) => <div key={i} style={{ fontSize:19, fontWeight:700, color:'var(--txt-1)', margin:'11px 0', lineHeight:1.5 }}>{line || '♪'}</div>)}
                <div style={{ fontSize:10, color:'var(--txt-3)', marginTop:14 }}>Letra · {lyricState.source}</div>
              </>)}
            </div>
          </div>
        </div>

        {/* Barra inferior de control */}
        <div style={{ flexShrink:0, padding:'14px clamp(24px,5vw,64px) 26px', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <span style={{ fontSize:11, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:40, textAlign:'right' }}>{fmt(time)}</span>
            <div style={{ position:'relative', flex:1, height:16, display:'flex', alignItems:'center' }}>
              <div style={{ position:'absolute', left:0, right:0, height:5, background:'var(--surf-2)', borderRadius:99 }} />
              <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 10px ${hex2rgba(T.accent,.6)}`, transition:'width .12s linear' }} />
              <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0, opacity:0, cursor:'pointer' }} />
            </div>
            <span style={{ fontSize:11, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:40 }}>{fmt(dur)}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
              <img src={track.cover ? hiResCover(track.cover, 128) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }} style={{ width:52, height:52, borderRadius:12, objectFit:'cover', flexShrink:0, boxShadow:`0 4px 14px ${hex2rgba(T.accent,.3)}` }} />
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
                <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
              </div>
            </div>
            {Transport}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:12, minWidth:0 }}>
              <DeviceChip outputs={outputs} sinkId={sinkId} setOutput={setOutput} T={T} />
              {!isIOS && <div style={{ display:'flex', alignItems:'center', gap:8, width:150 }}><Icon.Vol c="var(--txt-2)" sz={17} /><div style={{ flex:1 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {desktop && <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060ad9', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', opacity: open?1:0, pointerEvents: open?'auto':'none', transition:'opacity .3s ease', zIndex:89 }} />}
      <div style={panelStyle} onTouchStart={!desktop ? onPanelTouchStart : undefined} onTouchEnd={!desktop ? onPanelTouchEnd : undefined}>
        {!desktop && <div style={{ width:44, height:5, borderRadius:99, background:'var(--surf-2)', margin:'0 auto 12px', flexShrink:0 }} />}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexShrink:0 }}>
          <button aria-label="Cerrar" onClick={onClose} className="btn-tap glass" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.ChevD c="var(--txt-1)" sz={18} /></button>
          <div style={{ textAlign:'center', flex:1, minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:3, color:'var(--txt-2)', textTransform:'uppercase' }}>Reproduciendo desde</div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--txt-0)', marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.album || track.artist}</div>
          </div>
          <div style={{ width:38, height:38, flexShrink:0 }} />
        </div>

        <div style={{ display:'flex', gap:6, background:'var(--surf-1)', borderRadius:12, padding:4, marginBottom:16, flexShrink:0, alignSelf:'center' }}>
          {[['Portada',false],['Letra',true]].map(([lbl,val]) => (
            <button key={lbl} onClick={() => setShowLyrics(val)} className="press" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:9, border:'none', cursor:'pointer', background: showLyrics===val ? grad(T) : 'transparent', color: showLyrics===val ? '#04060a' : 'var(--txt-2)', fontSize:11, fontWeight:800 }}>
              {val ? <Icon.Mic c={showLyrics===val?'#04060a':'var(--txt-2)'} sz={14} /> : <Icon.Play c={showLyrics===val?'#04060a':'var(--txt-2)'} sz={13} />}{lbl}
            </button>
          ))}
        </div>

        {!showLyrics ? (
          <CoverSwipe next={next} prev={prev} playing={playing} glowF={glowF} ambientRgba={ambientRgba} art={art} track={track} loadingAudio={loadingAudio} nextCover={nextCover} prevCover={prevCover} />
        ) : (
          <div ref={lyricBoxRef} style={{ position:'relative', height:art, overflowY:'auto', marginBottom:22, padding:'16px 6px', textAlign:'center', flexShrink:0 }}>
            {lyricState.status === 'loading' && <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, paddingTop:'28%', color:'var(--txt-2)' }}><Spinner c={T.accent} sz={22} /><span style={{ fontSize:13 }}>Buscando letra…</span></div>}
            {lyricState.status === 'none' && <div style={{ fontSize:13, color:'var(--txt-2)', paddingTop:'30%' }}>Letra no disponible para esta pista.</div>}
            {lyricState.status === 'ok' && lyricState.synced.length > 0 && (<>
              {lyricState.synced.map((l, i) => (
                <div key={i} data-li={i} style={{ fontSize: i===activeLyric ? 17 : 14.5, fontWeight: i===activeLyric ? 800 : 600, color: i===activeLyric ? T.accent : (i < activeLyric ? 'var(--txt-2)' : 'var(--txt-1)'), margin:'9px 0', lineHeight:1.4, transition:'all .25s ease' }}>{l.text || '♪'}</div>
              ))}
              {setLyricOffset && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:16 }}>
                  <button aria-label="Atrasar letra" onClick={() => setLyricOffset(o => Math.round((o - 0.5) * 10) / 10)} className="press" style={{ width:30, height:30, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:16, fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontSize:10.5, color:'var(--txt-2)', fontWeight:700, minWidth:90, textAlign:'center' }}>Sincronía {lyricOffset>0?'+':''}{lyricOffset.toFixed(1)}s</span>
                  <button aria-label="Adelantar letra" onClick={() => setLyricOffset(o => Math.round((o + 0.5) * 10) / 10)} className="press" style={{ width:30, height:30, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', color:'var(--txt-0)', fontSize:16, fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              )}
              <div style={{ fontSize:9.5, color:'var(--txt-3)', marginTop:8 }}>Letra sincronizada · {lyricState.source}</div>
            </>)}
            {lyricState.status === 'ok' && lyricState.synced.length === 0 && (<>
              {lyricState.plain.map((line, i) => <div key={i} style={{ fontSize:14.5, fontWeight:600, color:'var(--txt-0)', margin:'7px 0', lineHeight:1.5 }}>{line || '♪'}</div>)}
              <div style={{ fontSize:9.5, color:'var(--txt-3)', marginTop:14 }}>Letra · {lyricState.source}</div>
            </>)}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexShrink:0 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:21, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
            <div style={{ fontSize:13, color:T.accent, marginTop:5, fontWeight:700 }}>{track.artist}</div>
          </div>
          <button aria-label={faved?'Quitar de Me gusta':'Añadir a Me gusta'} onClick={() => toggleFav(track.id)} className="btn-tap" style={{ background: faved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${faved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', marginRight:10, flexShrink:0 }}><Icon.Heart c={faved ? T.accent : 'var(--txt-1)'} filled={faved} sz={18} /></button>
          {onAdd && <button aria-label="Añadir" onClick={() => onAdd(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', marginRight:10, flexShrink:0 }}><Icon.Plus c="var(--txt-1)" sz={18} /></button>}
          {onMenu && <button aria-label="Más" onClick={() => onMenu(track.id)} className="btn-tap" style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:'50%', width:38, height:38, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}><Icon.Dots c="var(--txt-1)" sz={18} /></button>}
        </div>

        <div style={{ marginBottom:18, flexShrink:0 }}>
          <div style={{ position:'relative', height:16, display:'flex', alignItems:'center', marginBottom:4 }}>
            <div style={{ position:'absolute', left:0, right:0, height:5, background:'var(--surf-2)', borderRadius:99 }} />
            <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:5, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 10px ${hex2rgba(T.accent,.6)}`, transition:'width .12s linear' }} />
            <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--txt-2)', fontWeight:700, fontFamily:'monospace' }}><span>{fmt(time)}</span><span>{fmt(dur)}</span></div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, flexShrink:0 }}>
          <button aria-label="Aleatorio" onClick={() => setShuffle(s=>!s)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle ? 1 : .3 }}><Icon.Shuf c={shuffle ? T.accent : 'var(--txt-1)'} sz={18} /></button>
          <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={24} /></button>
          <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:64, height:64, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 ${20+glowF*26}px ${hex2rgba(T.accent,.55)}, 0 8px 24px #000a` }}>{loadingAudio ? <Spinner c="#04060a" sz={26} /> : (playing ? <Icon.Pause c="#04060a" sz={26} /> : <Icon.Play c="#04060a" sz={26} />)}</button>
          <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={24} /></button>
          <button aria-label="Repetir" onClick={() => setRepeat(r=>!r)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat ? 1 : .3 }}><Icon.Rep c={repeat ? T.accent : 'var(--txt-1)'} sz={18} /></button>
        </div>

        <div className="glass" style={{ display:'flex', alignItems:'center', gap:13, background:'var(--surf-0)', border:'1px solid var(--line-soft)', borderRadius:16, padding:'12px 16px', flexShrink:0 }}>
          <Icon.Vol c="var(--txt-2)" sz={16} />
          {isIOS ? (
            <div style={{ flex:1, fontSize:11, color:'var(--txt-2)' }}>Usa los botones de volumen del teléfono</div>
          ) : (
            <div style={{ flex:1 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div>
          )}
          {!isIOS && <span style={{ fontSize:10, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:34, textAlign:'right' }}>{Math.round(vol*100)}%</span>}
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:12, flexShrink:0 }}>
          <DeviceChip outputs={outputs} sinkId={sinkId} setOutput={setOutput} T={T} />
          <button aria-label="Cola de reproducción" onClick={onQueue} className="press" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'8px 14px', cursor:'pointer', color:'var(--txt-1)', fontSize:11.5, fontWeight:700 }}>
            <Icon.Queue c={T.accent} sz={16} /> En cola
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// DETAIL VIEW — artista / álbum (metadatos reales de YouTube Music)

