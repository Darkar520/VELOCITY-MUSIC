import React, { useState } from 'react';
import { ONBOARDING_GENRES } from '../constants.js';
import { hex2rgba, grad, dedupeByTitle } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, CoverImg, SectionHeader, MediaCard } from '../components.jsx';
import { trackById } from '../catalog.js';
import { Avatar } from '../avatars.jsx';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';
import { useOnboardingArtists } from '../hooks/useOnboardingArtists.js';
import { HomeDiscovery } from '../components/HomeDiscovery.jsx';
import { ArtistPortrait } from '../components/ArtistPortrait.jsx';

export function HomeTab({ T, play, track: trackProp, playing: playingProp, onMenu, onToggleFav, goMix, displayName, avatar, email, setTab, startAiDj, onboardPrefs, setOnboardPrefs, backendDown }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  const recent = useLibraryStore((s) => s.recent);
  const homeRows = useLibraryStore((s) => s.homeRows);
  const homeLoading = useLibraryStore((s) => s.homeLoading);
  const catVer = useLibraryStore((s) => s.catVer);
  // Player: props de App tienen prioridad (fuente de verdad del playback)
  const storeTrack = usePlayerStore((s) => s.track);
  const storePlaying = usePlayerStore((s) => s.playing);
  const downloaded = usePlayerStore((s) => s.downloaded);
  const track = trackProp ?? storeTrack;
  const playing = playingProp ?? storePlaying;
  const toggleFav = onToggleFav || (() => {});
  const [djBusy, setDjBusy] = useState(false);
  const [onboardSel, setOnboardSel] = useState([]);
  const [onboardStep, setOnboardStep] = useState(1); // 1=géneros, 2=artistas
  const [artistSel, setArtistSel] = useState([]);
  const [artistFilter, setArtistFilter] = useState('');
  const [editingPrefs, setEditingPrefs] = useState(false);
  const showOnboarding = editingPrefs || (onboardPrefs === null && !recent.length && !favs.length);
  const finishOnboarding = value => {
    setOnboardPrefs(value);
    useLibraryStore.setState(s=>({homeRows:[],homeLoading:true,feedNonce:s.feedNonce+1}));
    setEditingPrefs(false);
  };
  const editPrefs = () => {
    setOnboardSel(Array.isArray(onboardPrefs) ? onboardPrefs : onboardPrefs?.genres || []);
    setArtistSel(onboardPrefs?.artists || []);setArtistFilter('');setOnboardStep(1);setEditingPrefs(true);
  };
  const [relatedArtists, setRelatedArtists] = useState([]);
  const { artists: artistSuggestions, loading: artistsLoading } = useOnboardingArtists(onboardStep, onboardSel);
  // Similarity here means shared selected genre, not song-upload cooccurrence.
  const fetchRelated = artist => {
    const candidates = artistSuggestions.filter(a => a.genre && a.genre === artist.genre && a._key !== artist._key);
    setRelatedArtists(candidates.slice(0,8));
  };

  // Listening history must never be fabricated from recommended tracks.
  const recentTracks = React.useMemo(() => dedupeByTitle((recent || []).map(trackById).filter(Boolean)).slice(0,12), [recent, catVer]);
  const recentIds = recentTracks.map(t => t.id);
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      {showOnboarding && (
        <div style={{ padding:'20px 0 30px', textAlign:'center' }}>
          {/* Indicador de paso */}
          <div style={{ display:'flex', gap:6, justifyContent:'center', marginBottom:16 }}>
            {[1,2].map(n => (
              <div key={n} style={{ width:6, height:6, borderRadius:'50%',
                background: onboardStep >= n ? T.accent : 'var(--line)' }} />
            ))}
          </div>

          {onboardStep === 1 && (
            <>
              <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', marginBottom:6 }}>¿Qué te gusta escuchar?</div>
              <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:20 }}>Elige al menos 3 géneros para personalizar tu feed</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:10, justifyContent:'center', marginBottom:22,
                maxHeight:'55vh', overflowY:'auto' }}>
                {(ONBOARDING_GENRES || []).map(g => {
                  const active = onboardSel.some(s => s.q === g.q);
                  return (
                    <button key={g.q} onClick={() => setOnboardSel(prev => active ? prev.filter(s => s.q !== g.q) : [...prev, { label: g.label, q: g.q }])} className="btn-tap" style={{ padding:'8px 16px', borderRadius:99, border: active ? `2px solid ${T.accent}` : '1.5px solid var(--line)', background: active ? hex2rgba(T.accent, .18) : 'var(--surf-1)', color: active ? T.accent : 'var(--txt-1)', fontSize:13, fontWeight:700, cursor:'pointer', transition:'all .15s ease' }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
              <button disabled={onboardSel.length < 3} onClick={() => setOnboardStep(2)} className="btn-tap" style={{ padding:'12px 36px', borderRadius:99, border:'none', background: onboardSel.length >= 3 ? T.accent : 'var(--surf-2)', color: onboardSel.length >= 3 ? '#000' : 'var(--txt-3)', fontSize:14, fontWeight:800, cursor: onboardSel.length >= 3 ? 'pointer' : 'not-allowed', opacity: onboardSel.length >= 3 ? 1 : .5, transition:'all .2s ease' }}>
                Continuar
              </button>
            </>
          )}

          {onboardStep === 2 && (
            <>
              <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', marginBottom:6 }}>¿Qué artistas te gustan?</div>
              <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:20 }}>Selecciona los que quieras — o sáltate este paso</div>
              <input aria-label="Filtrar artistas sugeridos" placeholder="Encuentra tus artistas entre las sugerencias" value={artistFilter} onChange={e=>setArtistFilter(e.target.value)} style={{width:'min(100%, 420px)',boxSizing:'border-box',padding:'13px 16px',marginBottom:18,borderRadius:12,border:'1px solid var(--line)',background:'var(--surf-1)',color:'var(--txt-0)',fontSize:13}} />

              {artistsLoading && artistSuggestions.length === 0 && (
                <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:10, padding:'24px 0', color:'var(--txt-2)' }}>
                  <Spinner c={T.accent} sz={20} /><span style={{ fontSize:12 }}>Buscando artistas…</span>
                </div>
              )}
              {!artistsLoading && artistSuggestions.length === 0 && (
                <div style={{ padding:'24px 0', color:'var(--txt-2)', fontSize:12.5 }}>
                  No encontramos sugerencias para tus géneros. Podés continuar igual.
                </div>
              )}

              {artistSuggestions.length > 0 && (() => {
                const ArtistChip = (a) => {
                  const active = artistSel.some(s => (s._key || s.artistId) === (a._key || a.artistId));
                  return (
                    <button key={a._key || a.artistId || a.name} onClick={() => {
                      if (active) {
                        setArtistSel(prev => prev.filter(s => (s._key || s.artistId) !== (a._key || a.artistId)));
                      } else {
                        setArtistSel(prev => [...prev, a]);
                        fetchRelated(a);
                      }
                    }} aria-pressed={active} className="btn-tap press" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', padding:'4px 6px', width:80 }}>
                      <div style={{ position:'relative' }}>
                        <ArtistPortrait artist={a} active={active} accent={T.accent}/>
                        {active && (
                          <div style={{ position:'absolute', bottom:0, right:0, width:18, height:18, borderRadius:'50%', background:T.accent, display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <Icon.Check c="#000" sz={11} />
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, color: active ? T.accent : 'var(--txt-1)', textAlign:'center', lineHeight:1.25, maxWidth:72, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name}</span>
                    </button>
                  );
                };
                return (
                  <div style={{ marginBottom:24, maxHeight:'60vh', overflowY:'auto' }}>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:14, justifyContent:'center' }}>
                      {artistSuggestions.filter(a=>a.name.toLocaleLowerCase().includes(artistFilter.toLocaleLowerCase())).map(ArtistChip)}
                    </div>
                    {relatedArtists.length > 0 && (
                      <>
                        <div style={{ display:'flex', alignItems:'center', gap:8, margin:'18px 0 12px', padding:'0 4px' }}>
                          <div style={{ flex:1, height:1, background:'var(--line-soft)' }} />
                          <span style={{ fontSize:10, fontWeight:700, color:'var(--txt-3)', letterSpacing:1.5, textTransform:'uppercase' }}>Relacionados</span>
                          <div style={{ flex:1, height:1, background:'var(--line-soft)' }} />
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:14, justifyContent:'center' }}>
                          {relatedArtists.map(ArtistChip)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                <button onClick={() => setOnboardStep(1)} className="btn-tap" style={{ padding:'12px 22px', borderRadius:99, border:'1.5px solid var(--line)', background:'var(--surf-1)', color:'var(--txt-1)', fontSize:14, fontWeight:700, cursor:'pointer' }}>
                  Atrás
                </button>
                <button onClick={() => finishOnboarding({ genres: onboardSel, artists: artistSel })} className="btn-tap" style={{ padding:'12px 36px', borderRadius:99, border:'none', background:T.accent, color:'#000', fontSize:14, fontWeight:800, cursor:'pointer' }}>
                  Empezar
                </button>
              </div>
              <button onClick={() => finishOnboarding({ genres: onboardSel, artists: [] })} className="btn-tap" style={{ background:'transparent', border:`1px solid var(--line)`, borderRadius:99, padding:'7px 18px', color:'var(--txt-2)', fontSize:11.5, fontWeight:600, cursor:'pointer', marginTop:10, letterSpacing:.3 }}>
                Omitir este paso
              </button>
            </>
          )}
          {editingPrefs && <button className="discovery-link" onClick={()=>setEditingPrefs(false)}>Cancelar</button>}
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22, paddingTop:4 }}>
        <div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>{greet}</div>
          <div style={{ fontSize:12.5, color:'var(--txt-2)', marginTop:4 }}>¿Qué quieres escuchar hoy?</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:9, flexShrink:0 }}>
          <button aria-label="AI DJ" onClick={async () => { if (djBusy) return; setDjBusy(true); try { await startAiDj?.(); } finally { setDjBusy(false); } }} className="btn-tap" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, minHeight:'var(--touch-min)', background:'var(--surf-1)', border:`1px solid ${hex2rgba(T.accent,.35)}`, borderRadius:99, padding:'7px 13px', cursor:'pointer', color:T.accent, fontSize:'var(--fs-label)', fontWeight:800 }}>{djBusy ? <Spinner c={T.accent} sz={13} /> : <Icon.Play c={T.accent} sz={13} />} AI DJ</button>
          {/* minWidth/minHeight = --touch-min: el avatar mide 40px, por debajo del
              mínimo táctil de 44px. Se agranda el área pulsable sin agrandar el avatar. */}
          <button onClick={() => setTab('profile')} className="press" aria-label="Perfil" style={{ display:'flex', alignItems:'center', justifyContent:'center', minWidth:'var(--touch-min)', minHeight:'var(--touch-min)', background:'none', border:'none', padding:0, cursor:'pointer' }}><Avatar avatar={avatar} name={displayName} email={email} T={T} size={40} /></button>
        </div>
      </div>

      {track && <button className="home-resume" onClick={() => play(track)} aria-label={`Volver a ${track.title}`}>
        <CoverImg src={track.cover} alt="" size={128} radius={8} style={{width:40,height:40}} />
        <span><small>{playing ? 'SONANDO AHORA' : 'CONTINÚA ESCUCHANDO'}</small><strong>{track.title} · {track.artist}</strong></span>
        {playing ? <EQViz color={T.accent} color2={T.accent2} playing bars={4} h={20}/> : <Icon.Play sz={20}/>}
      </button>}


      {/* Modo sin conexión: mostrar biblioteca cacheada en vez del feed */}
      {backendDown && homeRows.length === 0 && (
        <>
          {recentTracks.length > 0 && (
            <>
              <SectionHeader label="Escuchado Recientemente" accent={T.accent} />
              <div className="carousel" style={{ gap:15, paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {recentTracks.map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, recentIds)} onPlay={() => play(t, recentIds)} onFav={() => toggleFav(t.id)} faved={favs.includes(t.id)} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {favs.length > 0 && (
            <>
              <SectionHeader label="Me Gusta" accent={T.accent} />
              <div className="carousel" style={{ gap:15, paddingBottom:6, paddingTop:2, marginBottom:18 }}>
                {favs.slice(0, 20).map(id => trackById(id)).filter(Boolean).map((t,i) => <MediaCard key={t.id+'_'+i} cover={t.cover} title={t.title} subtitle={t.artist} T={T} onClick={() => play(t, favs)} onPlay={() => play(t, favs)} onFav={() => toggleFav(t.id)} faved={true} onMenu={() => onMenu(t.id)} />)}
              </div>
            </>
          )}
          {downloaded.size > 0 && (
            <>
              <SectionHeader label="Descargadas" accent={T.accent} />
              <div className="carousel" style={{ gap:15, paddingBottom:6, paddingTop:2, marginBottom:18 }}>
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

      {!showOnboarding && (onboardPrefs !== null || recent.length > 0 || favs.length > 0) && <HomeDiscovery onEditPrefs={editPrefs} rows={homeRows} prefs={onboardPrefs} play={play} goMix={goMix} onMenu={onMenu} onToggleFav={toggleFav} favs={favs} loading={homeLoading} offline={backendDown} retry={() => useLibraryStore.getState().setFeedNonce(useLibraryStore.getState().feedNonce + 1)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEARCH TAB

