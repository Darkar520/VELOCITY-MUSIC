import React, { useState } from 'react';
import { SEED_ROWS, LATIN_ROWS, DISCOVERY, GENRES, ONBOARDING_GENRES, MOODS, ERAS, FALLBACK_COVER } from '../constants.js';
import { hex2rgba, grad, hiResCover, dedupeByTitle } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider } from '../components.jsx';
import { trackById } from '../catalog.js';
import { Avatar } from '../avatars.jsx';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

export function HomeTab({ T, play, onMenu, goMix, displayName, avatar, email, setTab, startAiDj, onboardPrefs, setOnboardPrefs, backendDown }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  const toggleFavInStore = useLibraryStore((s) => s.toggleFav);
  const recent = useLibraryStore((s) => s.recent);
  const playlists = useLibraryStore((s) => s.playlists);
  const homeRows = useLibraryStore((s) => s.homeRows);
  const homeLoading = useLibraryStore((s) => s.homeLoading);
  // Player store
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const downloaded = usePlayerStore((s) => s.downloaded);
  // Wrapper para toggleFav (App.jsx escuchara para llamar api)
  const toggleFav = (id) => toggleFavInStore(id);
  const [djBusy, setDjBusy] = useState(false);
  const [onboardSel, setOnboardSel] = useState([]);
  const recentTracks = dedupeByTitle(recent.map(trackById).filter(Boolean));
  const recentIds = recentTracks.map(t => t.id);
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      {onboardPrefs === null && !recent.length && !favs.length && (
        <div style={{ padding:'20px 0 30px', textAlign:'center' }}>
          <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', marginBottom:6 }}>¿Qué te gusta escuchar?</div>
          <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:20 }}>Elige al menos 3 para personalizar tu feed</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, justifyContent:'center', marginBottom:22 }}>
            {(GENRES || []).map(g => {
              const active = onboardSel.some(s => s.q === g.q);
              return (
                <button key={g.q} onClick={() => setOnboardSel(prev => active ? prev.filter(s => s.q !== g.q) : [...prev, { label: g.label, q: g.q }])} className="btn-tap" style={{ padding:'8px 16px', borderRadius:99, border: active ? `2px solid ${T.accent}` : '1.5px solid var(--line)', background: active ? hex2rgba(T.accent, .18) : 'var(--surf-1)', color: active ? T.accent : 'var(--txt-1)', fontSize:13, fontWeight:700, cursor:'pointer', transition:'all .15s ease' }}>
                  {g.label}
                </button>
              );
            })}
          </div>
          <button disabled={onboardSel.length < 3} onClick={() => setOnboardPrefs(onboardSel)} className="btn-tap" style={{ padding:'12px 36px', borderRadius:99, border:'none', background: onboardSel.length >= 3 ? T.accent : 'var(--surf-2)', color: onboardSel.length >= 3 ? '#000' : 'var(--txt-3)', fontSize:14, fontWeight:800, cursor: onboardSel.length >= 3 ? 'pointer' : 'not-allowed', opacity: onboardSel.length >= 3 ? 1 : .5, transition:'all .2s ease' }}>
            Continuar
          </button>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22, paddingTop:4 }}>
        <div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>{greet}</div>
          <div style={{ fontSize:12.5, color:'var(--txt-2)', marginTop:4 }}>¿Qué quieres escuchar hoy?</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:9, flexShrink:0 }}>
          <button aria-label="AI DJ" onClick={async () => { if (djBusy) return; setDjBusy(true); try { await startAiDj?.(); } finally { setDjBusy(false); } }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.35)}`, borderRadius:99, padding:'7px 13px', cursor:'pointer', color:T.accent, fontSize:11, fontWeight:800 }}>{djBusy ? <Spinner c={T.accent} sz={13} /> : <Icon.Play c={T.accent} sz={13} />} AI DJ</button>
          <button onClick={() => setTab('profile')} className="press" aria-label="Perfil" style={{ background:'none', border:'none', padding:0, cursor:'pointer' }}><Avatar avatar={avatar} name={displayName} email={email} T={T} size={40} /></button>
        </div>
      </div>

      {track && (
        <div onClick={() => play(track)} style={{ position:'relative', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.22)}, ${hex2rgba(T.accent2,.06)}), var(--surf-0)`, border:`1px solid ${hex2rgba(T.accent,.28)}`, borderRadius:22, padding:'15px 17px', marginBottom:24, display:'flex', alignItems:'center', gap:14, overflow:'hidden', boxShadow:`0 12px 34px ${hex2rgba(T.accent,.14)}`, cursor:'pointer' }}>
          <div style={{ position:'absolute', top:-30, right:-20, width:120, height:120, borderRadius:'50%', background:grad(T), filter:'blur(40px)', opacity:.35, pointerEvents:'none' }} />
          <img src={track.cover ? hiResCover(track.cover, 128) : FALLBACK_COVER} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_COVER; }} style={{ width:56, height:56, borderRadius:14, objectFit:'cover', boxShadow:`0 0 22px ${hex2rgba(T.accent,.5)}`, position:'relative' }} />
          <div style={{ flex:1, minWidth:0, position:'relative' }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2, color:T.accent, textTransform:'uppercase', marginBottom:5 }}>{playing ? '◉ Reproduciendo' : 'Última pista'}</div>
            <div style={{ fontSize:15.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{track.title}</div>
            <div style={{ fontSize:11, color:'var(--txt-1)', marginTop:2 }}>{track.artist}</div>
          </div>
          {playing && <EQViz color={T.accent} color2={T.accent2} playing={playing} bars={6} h={28} />}
        </div>
      )}

      {recentTracks.length > 0 && (
        <>
          <SectionHeader label="Escuchado Recientemente" accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
            {recentTracks.map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, recentIds)} onPlay={() => play(t, recentIds)} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
          </div>
        </>
      )}

      {homeLoading && homeRows.length === 0 && !backendDown && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:'40px 0', color:'var(--txt-2)' }}>
          <Spinner c={T.accent} sz={26} /><span style={{ fontSize:12.5 }}>Cargando música…</span>
        </div>
      )}

      {/* Modo sin conexión: mostrar biblioteca cacheada en vez del feed */}
      {backendDown && homeRows.length === 0 && (
        <>
          {recentTracks.length > 0 && (
            <>
              <SectionHeader label="Escuchado Recientemente" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {recentTracks.map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, recentIds)} onPlay={() => play(t, recentIds)} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {favs.length > 0 && (
            <>
              <SectionHeader label="Me Gusta" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {favs.slice(0, 20).map(id => trackById(id)).filter(Boolean).map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, favs)} onPlay={() => play(t, favs)} onFav={() => toggleFav(t.id)} faved={true} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {downloaded.size > 0 && (
            <>
              <SectionHeader label="Descargadas" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {[...downloaded].slice(0, 20).map(id => trackById(id)).filter(Boolean).map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, [...downloaded])} onPlay={() => play(t, [...downloaded])} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {recentTracks.length === 0 && favs.length === 0 && downloaded.size === 0 && (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--txt-2)' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--txt-1)', marginBottom:6 }}>Sin conexión al servidor</div>
              <div style={{ fontSize:12, lineHeight:1.5 }}>Tu biblioteca aparecerá aquí cuando vuelva la conexión. Las canciones descargadas siguen disponibles.</div>
            </div>
          )}
        </>
      )}

      {homeRows.map(sec => (
        <div key={sec.section}>
          <SectionHeader label={sec.section} accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, paddingTop:2, marginBottom:20 }}>
            {(sec.mixes || []).map(mix => (
              <MixCard key={mix.label} mix={mix} T={T}
                onOpen={() => goMix(mix)}
                onPlay={() => { const ids = mix.tracks.map(t => t.id); play(mix.tracks[0], ids, { mixLabel: mix.label }); }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEARCH TAB

