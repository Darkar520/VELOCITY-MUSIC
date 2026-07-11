/**
 * PlayerBar — barra de reproductor desktop.
 * Props de App tienen prioridad; store es fallback de migración.
 */
import React from 'react';
import { fmt, hex2rgba, grad, hiResCover } from '../helpers.js';
import { FALLBACK_COVER } from '../constants.js';
import { Icon } from '../Icons.jsx';
import { Spinner, RangeSlider } from '../components.jsx';
import { usePlayerStore } from '../store/playerStore.js';

export function PlayerBar({
  track: trackProp, playing: playingProp, togglePlay: togglePlayProp,
  next, prev, time: timeProp, dur: durProp, seek: seekProp,
  vol: volProp, setVol: setVolProp, shuffle: shuffleProp, setShuffle: setShuffleProp,
  repeat: repeatProp, setRepeat: setRepeatProp, faved, toggleFav, T,
  onExpand, onMenu, loadingAudio: loadingAudioProp, onQueue,
}) {
  const sTrack = usePlayerStore((s) => s.track);
  const sPlaying = usePlayerStore((s) => s.playing);
  const sTime = usePlayerStore((s) => s.time);
  const sDur = usePlayerStore((s) => s.duration);
  const sVol = usePlayerStore((s) => s.volume);
  const sShuffle = usePlayerStore((s) => s.shuffle);
  const sRepeat = usePlayerStore((s) => s.repeat);
  const sLoading = usePlayerStore((s) => s.loadingAudio);
  const sToggle = usePlayerStore((s) => s.togglePlay);
  const sSeek = usePlayerStore((s) => s.seek);
  const sSetVol = usePlayerStore((s) => s.setVolume);
  const sSetShuffle = usePlayerStore((s) => s.setShuffle);
  const sSetRepeat = usePlayerStore((s) => s.setRepeat);

  const track = trackProp ?? sTrack;
  const playing = playingProp ?? sPlaying;
  const time = timeProp ?? sTime;
  const dur = durProp ?? sDur;
  const vol = volProp ?? sVol;
  const shuffle = shuffleProp ?? sShuffle;
  const repeat = repeatProp ?? sRepeat;
  const loadingAudio = loadingAudioProp ?? sLoading;
  const togglePlay = typeof togglePlayProp === 'function' ? togglePlayProp : sToggle;
  const seek = typeof seekProp === 'function' ? seekProp : sSeek;
  const setVol = typeof setVolProp === 'function' ? setVolProp : sSetVol;
  const setShuffle = typeof setShuffleProp === 'function' ? setShuffleProp : sSetShuffle;
  const setRepeat = typeof setRepeatProp === 'function' ? setRepeatProp : sSetRepeat;

  const pct = dur > 0 ? (time / dur) * 100 : 0;

  if (!track) return (
    <div className="glass" style={{ flexShrink:0, height:90, borderTop:'1px solid var(--line-soft)', background:'#06080fcc', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--txt-2)', fontSize:12.5 }}>Selecciona una canción para empezar</div>
  );

  return (
    <div className="glass" style={{ flexShrink:0, height:90, borderTop:'1px solid var(--line-soft)', background:'#06080fcc', display:'grid', gridTemplateColumns:'minmax(180px,1fr) 2fr minmax(140px,1fr)', alignItems:'center', gap:18, padding:'0 22px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
        <img src={track.cover ? hiResCover(track.cover, 128) : FALLBACK_COVER} alt="" onClick={onExpand} referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }} className="press" style={{ width:52, height:52, borderRadius:12, objectFit:'cover', cursor:'pointer', boxShadow:`0 4px 14px ${hex2rgba(T.accent,.3)}`, flexShrink:0 }} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }} onClick={onExpand}>{track.title}</div>
          <div style={{ fontSize:11, color:T.accent, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.artist}</div>
        </div>
        <button aria-label="Me gusta" onClick={() => toggleFav?.(track.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Heart c={faved ? T.accent : 'var(--txt-3)'} filled={faved} sz={18} /></button>
        <button aria-label="Más" onClick={() => onMenu?.(track.id)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0 }}><Icon.Dots c="var(--txt-3)" sz={18} /></button>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:7, justifyContent:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:22 }}>
          <button aria-label="Aleatorio" onClick={() => setShuffle(!shuffle)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: shuffle?1:.32 }}><Icon.Shuf c={shuffle?T.accent:'var(--txt-1)'} sz={16} /></button>
          <button aria-label="Anterior" onClick={prev} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Prev c="var(--txt-0)" sz={20} /></button>
          <button aria-label={playing?'Pausar':'Reproducir'} onClick={togglePlay} className="btn-tap" style={{ width:42, height:42, borderRadius:'50%', background:grad(T), border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:`0 0 16px ${hex2rgba(T.accent,.5)}` }}>{loadingAudio ? <Spinner c="#04060a" sz={18} /> : (playing ? <Icon.Pause c="#04060a" sz={20} /> : <Icon.Play c="#04060a" sz={20} />)}</button>
          <button aria-label="Siguiente" onClick={next} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer' }}><Icon.Next c="var(--txt-0)" sz={20} /></button>
          <button aria-label="Repetir" onClick={() => setRepeat(!repeat)} className="btn-tap" style={{ background:'none', border:'none', cursor:'pointer', opacity: repeat?1:.32 }}><Icon.Rep c={repeat?T.accent:'var(--txt-1)'} sz={16} /></button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:9.5, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:30, textAlign:'right' }}>{fmt(time)}</span>
          <div style={{ flex:1, position:'relative', height:14, display:'flex', alignItems:'center' }}>
            <div style={{ position:'absolute', left:0, right:0, height:4, background:'var(--surf-2)', borderRadius:99 }} />
            <div style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)', height:4, width:`${pct}%`, background:grad(T,90), borderRadius:99, boxShadow:`0 0 8px ${hex2rgba(T.accent,.6)}` }} />
            <input type="range" min="0" max={dur||100} step="0.1" value={time} aria-label="Progreso" onChange={e => seek(+e.target.value)} style={{ position:'absolute', inset:0, width:'100%', height:'100%', margin:0 }} />
          </div>
          <span style={{ fontSize:9.5, color:'var(--txt-2)', fontFamily:'monospace', fontWeight:700, width:30 }}>{fmt(dur)}</span>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, justifyContent:'flex-end' }}>
        <button aria-label="Cola" onClick={onQueue} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><Icon.Queue c="var(--txt-2)" sz={18} /></button>
        <Icon.Vol c="var(--txt-2)" sz={16} />
        <div style={{ width:110 }}><RangeSlider value={vol} min={0} max={1} step={0.01} onChange={setVol} accent={T.accent} ariaLabel="Volumen" /></div>
      </div>
    </div>
  );
}

export default PlayerBar;
