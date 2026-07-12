/**
 * MiniPlayerBar — barra de reproductor colapsada.
 * Props de App tienen prioridad; carátula resuelta vía bestCoverFor (catálogo/IDB).
 */
import React, { useMemo } from 'react';
import { hex2rgba, grad, hiResCover } from '../helpers.js';
import { useHSwipe } from '../hooks.js';
import { FALLBACK_COVER } from '../constants.js';
import { Icon } from '../Icons.jsx';
import { Spinner, CoverImg } from '../components.jsx';
import { bestCoverFor } from '../catalog.js';
import { usePlayerStore } from '../store/playerStore.js';

export function MiniPlayerBar({
  track: trackProp,
  playing: playingProp,
  togglePlay: togglePlayProp,
  loadingAudio: loadingAudioProp,
  T, pct, setExpanded, setMenuTarget, next, prev,
}) {
  const storeTrack = usePlayerStore((s) => s.track);
  const storePlaying = usePlayerStore((s) => s.playing);
  const storeLoading = usePlayerStore((s) => s.loadingAudio);
  const storeToggle = usePlayerStore((s) => s.togglePlay);

  const track = trackProp ?? storeTrack;
  const playing = playingProp ?? storePlaying;
  const loadingAudio = loadingAudioProp ?? storeLoading;
  const togglePlay = typeof togglePlayProp === 'function' ? togglePlayProp : storeToggle;

  const { dragX, handlers } = useHSwipe({ onLeft: next, onRight: prev, threshold: 60 });
  const isSliding = Math.abs(dragX) > 0;

  // Siempre preferir carátula del catálogo (HTTPS o data: offline) sobre estado vacío.
  const coverSrc = useMemo(() => {
    if (!track) return FALLBACK_COVER;
    const raw = bestCoverFor(track.id, track.cover || track.artworkUrl || '');
    if (!raw || typeof raw !== 'string') return FALLBACK_COVER;
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    return hiResCover(raw, 96) || FALLBACK_COVER;
  }, [track?.id, track?.cover, track?.artworkUrl]);

  if (!track) return null;

  return (
    <div
      {...handlers}
      onClick={() => !isSliding && setExpanded(true)}
      className="glass"
      style={{ background:`linear-gradient(135deg, ${hex2rgba(T.accent,.1)}, var(--surf-0))`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:20, padding:'10px 12px', display:'flex', alignItems:'center', gap:12, cursor:'pointer', boxShadow:`0 8px 28px ${hex2rgba(T.accent,.16)}, 0 2px 8px #0006`, position:'relative', overflow:'hidden', touchAction:'pan-y', userSelect:'none' }}
    >
      <div style={{ position:'absolute', bottom:0, left:0, height:2.5, width:`${pct || 0}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${T.accent}`, transition:'width .15s linear', zIndex:2 }} />
      <div
        style={{
          width:42, height:42, flexShrink:0, borderRadius:11, overflow:'hidden',
          boxShadow:'0 4px 12px #0007',
          transform: `translateX(${dragX * 0.6}px)`,
          transition: isSliding ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)',
          // Nunca bajar opacity a 0 en idle (bug visual de carátula “invisible”).
          opacity: isSliding ? Math.max(0.35, 1 - Math.abs(dragX) / 200) : 1,
        }}
      >
        <CoverImg
          key={`${track.id || 't'}-${coverSrc.slice(0, 48)}`}
          src={coverSrc}
          alt=""
          radius={11}
          size={96}
          style={{ width:42, height:42 }}
        />
      </div>
      <div style={{ flex:1, minWidth:0,
        transform: `translateX(${dragX * 0.25}px)`,
        transition: isSliding ? 'none' : 'transform .35s cubic-bezier(.22,1,.36,1)',
      }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title || '—'}</div>
        <div style={{ fontSize:10, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist || ''}</div>
      </div>
      <button aria-label={playing?'Pausar':'Reproducir'} onClick={e=>{ e.stopPropagation(); togglePlay(); }} className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:'50%', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0, boxShadow:`0 0 14px ${hex2rgba(T.accent,.55)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
      <button aria-label="Más" onClick={e=>{ e.stopPropagation(); if (track?.id) setMenuTarget(track.id); }} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Dots c="var(--txt-1)" sz={19} /></button>
    </div>
  );
}
