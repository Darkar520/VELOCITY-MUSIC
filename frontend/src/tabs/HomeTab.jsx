import React, { useState, useEffect } from 'react';
import { SEED_ROWS, LATIN_ROWS, DISCOVERY, GENRES, ONBOARDING_GENRES, MOODS, ERAS, FALLBACK_COVER } from '../constants.js';
import { hex2rgba, grad, hiResCover, dedupeByTitle } from '../helpers.js';
import { Icon } from '../Icons.jsx';
import { EQViz, Spinner, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard, RangeSlider } from '../components.jsx';
import { trackById } from '../catalog.js';
import { Avatar } from '../avatars.jsx';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';
import { api } from '../api.js';

export function HomeTab({ T, play, track: trackProp, playing: playingProp, onMenu, goMix, displayName, avatar, email, setTab, startAiDj, onboardPrefs, setOnboardPrefs, backendDown }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  const toggleFavInStore = useLibraryStore((s) => s.toggleFav);
  const recent = useLibraryStore((s) => s.recent);
  const playlists = useLibraryStore((s) => s.playlists);
  const homeRows = useLibraryStore((s) => s.homeRows);
  const homeLoading = useLibraryStore((s) => s.homeLoading);
  const catVer = useLibraryStore((s) => s.catVer);
  // Player: props de App tienen prioridad (fuente de verdad del playback)
  const storeTrack = usePlayerStore((s) => s.track);
  const storePlaying = usePlayerStore((s) => s.playing);
  const downloaded = usePlayerStore((s) => s.downloaded);
  const track = trackProp ?? storeTrack;
  const playing = playingProp ?? storePlaying;
  // Wrapper para toggleFav (App.jsx escuchara para llamar api)
  const toggleFav = (id) => toggleFavInStore(id);
  const [djBusy, setDjBusy] = useState(false);
  const [onboardSel, setOnboardSel] = useState([]);
  const [onboardStep, setOnboardStep] = useState(1); // 1=géneros, 2=artistas
  const [artistSel, setArtistSel] = useState([]);
  const [artistSuggestions, setArtistSuggestions] = useState([]);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [relatedArtists, setRelatedArtists] = useState([]);

  // Paso 2: cargar artistas sugeridos en base a los géneros elegidos
  useEffect(() => {
    if (onboardStep !== 2) return;
    setArtistsLoading(true);
    setArtistSuggestions([]);
    setRelatedArtists([]);
    let cancelled = false;
    const seeds = onboardSel.slice(0, 10);
    Promise.allSettled(
      seeds.map(g => api.searchAll(g.q + ' artistas').catch(() => ({ artists: [] })))
    ).then(results => {
      if (cancelled) return;
      const seen = new Set();
      const artists = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const a of (r.value?.artists || [])) {
          if (!a?.artistId || seen.has(a.artistId)) continue;
          seen.add(a.artistId);
          artists.push({ artistId: a.artistId, name: a.name, thumbnail: a.thumbnail });
        }
      }
      setArtistSuggestions(artists.slice(0, 24));
      setArtistsLoading(false);
    });
    return () => { cancelled = true; };
  }, [onboardStep, onboardSel]);
  // Carga artistas relacionados cuando el usuario selecciona uno en el onboarding.
  const fetchRelated = async (artist) => {
    try {
      const data = await api.artist(artist.artistId);
      const songs = data.topSongs || [];
      const seen = new Set([
        ...artistSuggestions.map(a => a.artistId),
        ...relatedArtists.map(a => a.artistId),
        artist.artistId,
      ]);
      const newRelated = [];
      for (const s of songs) {
        if (!s.artistId || seen.has(s.artistId)) continue;
        seen.add(s.artistId);
        newRelated.push({ artistId: s.artistId, name: s.artist, thumbnail: s.cover });
        if (newRelated.length >= 8) break;
      }
      if (newRelated.length > 0) {
        setRelatedArtists(prev => {
          const existing = new Set(prev.map(a => a.artistId));
          const fresh = newRelated.filter(a => !existing.has(a.artistId));
          return [...prev, ...fresh].slice(0, 20);
        });
      }
    } catch { /* ignorar */ }
  };

  // Recientes: ids de historial → catálogo; si faltan metas, rellenar con pistas del feed.
  const recentTracks = React.useMemo(() => {
    const fromHist = dedupeByTitle((recent || []).map(trackById).filter(Boolean));
    if (fromHist.length >= 3) return fromHist.slice(0, 30);
    const fromFeed = [];
    for (const sec of homeRows || []) {
      for (const mix of sec.mixes || []) {
        for (const t of mix.tracks || []) {
          if (t?.id) fromFeed.push(t);
        }
      }
    }
    return dedupeByTitle([...fromHist, ...fromFeed]).slice(0, 30);
  }, [recent, homeRows, catVer]);
  const recentIds = recentTracks.map(t => t.id);
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      {onboardPrefs === null && !recent.length && !favs.length && (
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
                  const active = artistSel.some(s => s.artistId === a.artistId);
                  return (
                    <button key={a.artistId} onClick={() => {
                      if (active) {
                        setArtistSel(prev => prev.filter(s => s.artistId !== a.artistId));
                      } else {
                        setArtistSel(prev => [...prev, a]);
                        fetchRelated(a);
                      }
                    }} className="btn-tap press" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', padding:'4px 6px', width:80 }}>
                      <div style={{ position:'relative' }}>
                        <CoverImg src={a.thumbnail} alt={a.name} radius={999} size={56} style={{ width:56, height:56, boxShadow: active ? `0 0 0 2.5px ${T.accent}` : 'none', transition:'box-shadow .15s ease' }} />
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
                      {artistSuggestions.map(ArtistChip)}
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
                <button onClick={() => setOnboardPrefs({ genres: onboardSel, artists: artistSel })} className="btn-tap" style={{ padding:'12px 36px', borderRadius:99, border:'none', background:T.accent, color:'#000', fontSize:14, fontWeight:800, cursor:'pointer' }}>
                  Empezar
                </button>
              </div>
              <button onClick={() => setOnboardPrefs({ genres: onboardSel, artists: [] })} className="btn-tap" style={{ background:'transparent', border:`1px solid var(--line)`, borderRadius:99, padding:'7px 18px', color:'var(--txt-2)', fontSize:11.5, fontWeight:600, cursor:'pointer', marginTop:10, letterSpacing:.3 }}>
                Omitir este paso
              </button>
            </>
          )}
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
          <CoverImg src={track.cover} alt="" radius={14} size={128} style={{ width:56, height:56, boxShadow:`0 0 22px ${hex2rgba(T.accent,.5)}` }} />
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
        <div style={{ opacity: 0.5 }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ marginBottom: 24 }}>
              <div style={{ height:14, width:160, borderRadius:7,
                background:'var(--surf-2)', marginBottom:12 }} />
              <div style={{ display:'flex', gap:12 }}>
                {[1,2,3,4].map(j => (
                  <div key={j} style={{ flexShrink:0, width:128, height:128,
                    borderRadius:14, background:'var(--surf-2)' }} />
                ))}
              </div>
            </div>
          ))}
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

