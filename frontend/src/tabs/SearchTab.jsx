import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { hex2rgba, grad, hiResCover } from '../helpers.js';
import { GENRES, FALLBACK_COVER } from '../constants.js';
import { cacheTrack, trackById, normalizeTrack } from '../catalog.js';
import { Icon } from '../Icons.jsx';
import { Spinner, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard } from '../components.jsx';
import { SearchBar } from './SearchBar.jsx';
import { useListSearch } from './useListSearch.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';
import { enrichTracksInBackground } from '../coverEnrich.js';
import { dedupeByRelevance, searchSectionOrder } from '../searchRanking.js';
import {buildSeedMix, selectSearchSeed} from '../feed/seededMix.js';

export function SearchTab({ T, play, addToTarget, onMenu, onToggleFav, recentSearches, addSearch, removeSearch, goArtist, goAlbum, goMix, selecting, selection, toggleSelect, startSelection, addToQueue, removeFromQueue, backendDown, setTab }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  // Player store
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const downloaded = usePlayerStore((s) => s.downloaded);
  const downloading = usePlayerStore((s) => s.downloading);
  const toggleFav = onToggleFav || (() => {});
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ songs: [], albums: [], artists: [] });
  const [activeResultSection, setActiveResultSection] = useState('all');
  const [relatedMixes, setRelatedMixes] = useState([]);
  const [chosenSeed,setChosenSeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [slowWarning, setSlowWarning] = useState(false);
  // retryKey se incrementa para forzar un nuevo disparo del useEffect de búsqueda.
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const term = q.trim();
    setActiveResultSection('all');
    if (!term) { setRes({ songs: [], albums: [], artists: [] }); setErr(''); setLoading(false); setSlowWarning(false); return; }
    setLoading(true); setErr(''); setSlowWarning(false);
    const ctrl = new AbortController();
    let alive = true;                                  // solo la búsqueda vigente actualiza la UI
    const aborted = (e) => e && (e.name === 'AbortError' || ctrl.signal.aborted);
    // Aviso de lentitud: si el catálogo tarda más de 4s (probable cold-start), mostrar
    // un mensaje para que el usuario sepa que no está roto.
    const slowTimer = setTimeout(() => { if (alive) setSlowWarning(true); }, 4000);
    const id = setTimeout(async () => {
      // Intenta searchAll; si falla por algo transitorio, cae a search; y reintenta 1 vez.
      const attempt = async () => {
        try {
          const d = await api.searchAll(term, ctrl.signal);
          return { context: d.context, songs: dedupeByRelevance(term, (d.songs || []).map(normalizeTrack), d.context), albums: d.albums || [], artists: d.artists || [] };
        } catch (e) {
          if (aborted(e)) throw e;                      // cancelada: no es error real
          const raw = await api.search(term, ctrl.signal); // respaldo
          return { songs: dedupeByRelevance(term, raw.map(normalizeTrack)), albums: [], artists: [] };
        }
      };
      try {
        let data;
        try { data = await attempt(); }
        catch (e) {
          if (aborted(e)) return;                        // superada por otra búsqueda
          await new Promise(r => setTimeout(r, 700));    // breve pausa y un reintento
          if (!alive || ctrl.signal.aborted) return;
          data = await attempt();
        }
        if (!alive || ctrl.signal.aborted) return;
        setRes(data); setErr(''); setSlowWarning(false);
        // Enriquecer carátulas de YouTube en background: no bloquea la UI.
        enrichTracksInBackground(data.songs, (id, coverUrl) => {
          const existing = trackById(id);
          if (existing) {
            cacheTrack({ ...existing, cover: coverUrl });
            setRes((prev) => {
              if (!prev || !prev.songs) return prev;
              const updated = prev.songs.map((t) =>
                t.id === id ? { ...t, cover: coverUrl } : t
              );
              return { ...prev, songs: updated };
            });
          }
        });
      } catch (e) {
        if (!aborted(e) && alive) {
          // Distinguir error transitorio (backend lento / rate limit) de error
          // de red real. 429/502/503 → mensaje suave (no es culpa del usuario).
          const isTransient = e?.status === 429 || e?.status === 502 || e?.status === 503;
          setErr(isTransient
            ? 'El catálogo tarda en responder. Inténtalo de nuevo en unos segundos.'
            : 'No se pudo buscar. Revisa tu conexión e inténtalo de nuevo.');
        }
      } finally {
        clearTimeout(slowTimer);
        if (alive && !ctrl.signal.aborted) { setLoading(false); setSlowWarning(false); }
      }
    }, 380);
    return () => { alive = false; clearTimeout(id); clearTimeout(slowTimer); ctrl.abort(); };
  }, [q, retryKey]);

  const runGenre = (g) => { setQ(g.q); addSearch(g.label); };
  const empty = !res.songs.length && !res.albums.length && !res.artists.length;
  const searchSections = {
    artists: res.artists.length > 0 && <React.Fragment key="artists">
      <SectionHeader label="Artistas" accent={T.accent} action={activeResultSection === 'all' && <button onClick={() => setActiveResultSection('artists')} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Ver todos ({res.artists.length})</button>} />
      <div className={activeResultSection === 'all' ? 'carousel' : ''} style={activeResultSection === 'all' ? { gap:15, paddingBottom:6, paddingTop:2, marginBottom:18 } : { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(104px, 1fr))', gap:18, marginBottom:20 }}>
        {res.artists.map(a => (
          <div key={a.artistId} onClick={() => { goArtist(a.artistId, a.name); addSearch(a.name); }} className="card-hover" style={{ flexShrink:0, width:104, cursor:'pointer', textAlign:'center' }}>
            <CoverImg src={a.thumbnail} alt={a.name} radius={999} style={{ width:104, height:104, borderRadius:'50%', boxShadow:'0 8px 22px #0007' }} />
            <div style={{ fontSize:11.5, fontWeight:700, color:'var(--txt-0)', marginTop:8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.name}</div>
            <div style={{ fontSize:9.5, color:'var(--txt-2)' }}>Artista</div>
          </div>
        ))}
      </div>
    </React.Fragment>,
    albums: res.albums.length > 0 && <React.Fragment key="albums">
      <SectionHeader label="Álbumes" accent={T.accent} action={activeResultSection === 'all' && <button onClick={() => setActiveResultSection('albums')} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Ver todos ({res.albums.length})</button>} />
      <div className={activeResultSection === 'all' ? 'carousel' : ''} style={activeResultSection === 'all' ? { gap:15, paddingBottom:6, paddingTop:2, marginBottom:18 } : { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:15, marginBottom:20 }}>
        {res.albums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={`${a.artist || 'Álbum'}${a.year ? ' · ' + a.year : ''}`} T={T} onClick={() => goAlbum(a.albumId, a.name, a.artist, null, a.cover)} />)}
      </div>
    </React.Fragment>,
    songs: res.songs.length > 0 && <React.Fragment key="songs">
      <SectionHeader label="Canciones" accent={T.accent} action={<div style={{display:'flex',gap:12,alignItems:'center'}}>{activeResultSection === 'all' && <button onClick={() => setActiveResultSection('songs')} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Ver todas ({res.songs.length})</button>}{!selecting && <button onClick={() => startSelection()} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Seleccionar</button>}</div>} />
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {res.songs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => { setChosenSeed({query:q.trim(),track:t}); play(t, [t.id], { radio: true }); addSearch(q.trim(),t); }} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
      </div>
    </React.Fragment>,
  };

  // Generar mixes relacionados en background cuando hay resultados de canciones.
  // Resolve one recording; other text-search homonyms are not radio seeds.
  useEffect(() => {
    setRelatedMixes([]);
    const songs = res.songs;
    if (!songs.length || loading) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),45000);
    (async () => {
      const explicit = chosenSeed?.query === q.trim() ? chosenSeed.track : res.context ? songs[0] : null;
      const base=selectSearchSeed(q,songs,{explicit,recentTracks:useLibraryStore.getState().recent.map(trackById).filter(Boolean)});
      if(!base)return;
      const normalize=raw=>(raw||[]).map(normalizeTrack);
      try{
        const result=await buildSeedMix(base,{signal:controller.signal,
          radio:(...args)=>api.radio(...args).then(normalize),
          artist:(...args)=>api.artist(...args).then(d=>({...d,topSongs:normalize(d.topSongs)})),
          search:(...args)=>api.search(...args).then(normalize)});
        if(!cancelled&&result.tracks.length===50)setRelatedMixes([{label:`Desde ${base.title} · ${base.artist}`,tracks:result.tracks,seedId:base.id}]);
      }catch{/* keep search results usable when recommendations are unavailable */}
    })();
    return () => { cancelled = true; clearTimeout(timer);controller.abort(); };
  }, [res.songs,q,loading,chosenSeed]);

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginBottom:18, paddingTop:4 }}>Explorar</div>

      {backendDown && (
        <div style={{ textAlign:'center', padding:'24px 20px', background:'var(--surf-0)', border:'1px solid var(--line)', borderRadius:18, marginBottom:22 }}>
          <Icon.WifiOff c={T.accent} sz={28} />
          <div style={{ fontSize:15, fontWeight:800, color:'var(--txt-0)', marginTop:10, marginBottom:4 }}>Búsqueda no disponible</div>
          <div style={{ fontSize:12, color:'var(--txt-2)', lineHeight:1.5 }}>El servidor está sin conexión. Explora tu biblioteca y reproduce canciones descargadas mientras tanto.</div>
          <button onClick={() => setTab('library')} className="btn-tap" style={{ marginTop:14, background:grad(T), border:'none', borderRadius:99, padding:'9px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Ir a mi biblioteca</button>
        </div>
      )}

      <div style={{ position:'relative', marginBottom:22 }}>
        <div style={{ position:'absolute', left:15, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
          {loading ? <Spinner c={slowWarning ? '#f59e0b' : T.accent} sz={17} /> : <Icon.Search c={q ? T.accent : 'var(--txt-2)'} sz={17} />}
        </div>
        <input type="text" value={q} onChange={e => setQ(e.target.value)} onBlur={() => q.trim() && addSearch(q.trim())}
          placeholder="Artistas, canciones, álbumes…"
          style={{ width:'100%', background:'var(--surf-0)', border:`1px solid ${q ? hex2rgba(T.accent,.45) : 'var(--line-soft)'}`, borderRadius:16, padding:'13px 40px 13px 44px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif', transition:'border .2s, box-shadow .2s', boxShadow: q ? `0 0 0 4px ${hex2rgba(T.accent,.1)}` : 'none' }} />
        {q && <button aria-label="Limpiar" onClick={() => setQ('')} className="press" style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer' }}><Icon.X c="var(--txt-2)" sz={16} /></button>}
      </div>

      {q ? (
        <>
          {err && (
            <div style={{ textAlign:'center', paddingTop:20 }}>
              <div style={{ color:'#fb7185', fontSize:12.5, marginBottom:10 }}>{err}</div>
              <button
                onClick={() => setRetryKey((k) => k + 1)}
                className="btn-tap"
                style={{ background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'8px 20px', cursor:'pointer', color:'var(--txt-0)', fontSize:12, fontWeight:700 }}
              >
                Reintentar
              </button>
            </div>
          )}
          {loading && slowWarning && (
            <div style={{ textAlign:'center', paddingTop:12, display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
              <Spinner c="#f59e0b" sz={18} />
              <div style={{ color:'#f59e0b', fontSize:12, fontWeight:600 }}>Conectando con el catálogo de música…</div>
            </div>
          )}
          {!loading && !err && empty && <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:36 }}>Sin resultados para "{q}"</div>}

          {!empty && <div role="tablist" aria-label="Tipo de resultado" style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:12,marginBottom:10}}>
            {[['all','Todo',res.artists.length + res.albums.length + res.songs.length],['artists','Artistas',res.artists.length],['albums','Álbumes',res.albums.length],['songs','Canciones',res.songs.length]].map(([id,label,count]) => count > 0 && <button key={id} role="tab" aria-selected={activeResultSection === id} onClick={() => setActiveResultSection(id)} className="press" style={{flexShrink:0,background:activeResultSection === id ? hex2rgba(T.accent,.16) : 'var(--surf-1)',border:`1px solid ${activeResultSection === id ? hex2rgba(T.accent,.5) : 'var(--line)'}`,borderRadius:999,padding:'8px 13px',cursor:'pointer',color:activeResultSection === id ? T.accent : 'var(--txt-1)',fontSize:11.5,fontWeight:800}}>{label} · {count}</button>)}
          </div>}
          {(activeResultSection === 'all' ? searchSectionOrder(res.context) : [activeResultSection]).map(section => searchSections[section])}

          {/* Mixes relacionados: radio de la canción top + artistas top del resultado */}
          {relatedMixes.length > 0 && (<>
            <SectionHeader label="Mixes relacionados" accent={T.accent} />
            <div className="carousel" style={{ gap:15, paddingBottom:6, paddingTop:2, marginBottom:18 }}>
              {relatedMixes.map(m => <MixCard key={m.label} mix={m} T={T} onPlay={() => { play(m.tracks[0], m.tracks.map(t=>t.id)); addSearch(q.trim(),m.tracks[0]); }} onOpen={() => { goMix(m); addSearch(q.trim(),m.tracks[0]); }} />)}
            </div>
          </>)}
        </>
      ) : (
        <>
          {recentSearches.length > 0 && (
            <>
              <SectionHeader label="Búsquedas Recientes" accent={T.accent} />
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:22 }}>
                {recentSearches.map(s => (
                  <div key={s} onClick={() => setQ(s)} className="press" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line-soft)', borderRadius:99, padding:'7px 12px', cursor:'pointer' }}>
                    <Icon.Clock c="var(--txt-2)" sz={13} />
                    <span style={{ fontSize:12, fontWeight:600, color:'var(--txt-0)' }}>{s}</span>
                    <button aria-label="Quitar" onClick={e => { e.stopPropagation(); removeSearch(s); }} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex' }}><Icon.X c="var(--txt-3)" sz={13} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
          <SectionHeader label="Explorar Géneros" accent={T.accent} />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:11 }}>
            {GENRES.map((g,i) => (
              <div key={g.label} onClick={() => runGenre(g)} className="card-hover fade-up" style={{ height:76, borderRadius:18, cursor:'pointer', overflow:'hidden', position:'relative', background:`linear-gradient(135deg, ${g.color}40, ${g.color}0a)`, border:`1px solid ${g.color}30`, animationDelay:`${i*.04}s`, display:'flex', alignItems:'flex-end', padding:'12px 14px', boxShadow:`0 6px 18px ${g.color}1f` }}>
                <div style={{ position:'absolute', top:-14, right:-14, width:60, height:60, background:g.color, borderRadius:'50%', opacity:.3, filter:'blur(8px)' }} />
                <span style={{ fontSize:12.5, fontWeight:800, color:'#fff', position:'relative' }}>{g.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEARCH BAR — input reutilizable para filtrar dentro de cualquier lista
// de canciones (playlist, mix, álbum, artista). Solo se muestra si la lista
// tiene 8+ canciones para no ocupar espacio en listas chicas.

