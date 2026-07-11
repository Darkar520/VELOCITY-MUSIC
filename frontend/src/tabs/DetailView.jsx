import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { FALLBACK_COVER } from '../constants.js';
import { fmt, hex2rgba, grad, hiResCover, dedupeByTitle } from '../helpers.js';
import { cacheTrack, cacheTracks, trackById } from '../catalog.js';
import { Icon } from '../Icons.jsx';
import { Spinner, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard } from '../components.jsx';
import { SearchBar } from './SearchBar.jsx';
import { useListSearch } from './useListSearch.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

export function DetailView({ view, T, play, addToTarget, onMenu, goArtist, goAlbum, setView, detailLoading, detailData, downloadMany, saveAlbum, unsaveAlbum, savePlaylist, unsavePlaylist, selecting, selection, toggleSelect, startSelection, addToQueue, removeFromQueue }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  const toggleFavInStore = useLibraryStore((s) => s.toggleFav);
  const isAlbumSaved = useLibraryStore((s) => s.isAlbumSaved);
  const isPlaylistSaved = useLibraryStore((s) => s.isPlaylistSaved);
  // Player store
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const downloaded = usePlayerStore((s) => s.downloaded);
  const downloading = usePlayerStore((s) => s.downloading);
  // Wrapper
  const toggleFav = (id) => toggleFavInStore(id);
  const [showAll, setShowAll] = useState(false);
  // Búsqueda dentro de la vista de detalle (mix, álbum, artista). Hook al nivel
  // superior para cumplir con las Rules of Hooks de React.
  const [detailSearch, setDetailSearch] = useState('');
  useEffect(() => { setShowAll(false); setDetailSearch(''); }, [view]);
  const d = detailData && detailData.type === view.type ? detailData : null;

  // Fuzzy match: verifica si una pista está descargada por ID exacto o por
  // título+artista normalizados. Resuelve el mismatch entre IDs de YT Music
  // y los IDs con los que se guardó la descarga en IndexedDB.
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isDownloaded = useCallback((t) => {
    if (!t) return false;
    if (downloaded.has(t.id)) return true;
    // Fallback: comparar título+artista normalizados contra las metas cacheadas.
    const tk = norm(t.title) + '|' + norm(t.artist);
    for (const id of downloaded) {
      const cached = trackById(id);
      if (cached && norm(cached.title) + '|' + norm(cached.artist) === tk) return true;
    }
    return false;
  }, [downloaded]);

  const Back = () => (
    <button onClick={() => setView(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:18, paddingTop:4, fontSize:13, fontWeight:700 }}><Icon.ChevL c="var(--txt-1)" sz={18} /> Atrás</button>
  );

  // ── Mezcla / playlist generada (tracklist embebido en la vista) ──
  if (view.type === 'mix') {
    const songs = (view.tracks || []).map(t => trackById(t.id) || t).filter(Boolean);
    const ids = songs.map(s => s.id);
    // Búsqueda dentro del mix
    const showSearch = songs.length >= 8;
    const normS = (s) => String(s || '').toLowerCase();
    const filteredSongs = detailSearch.trim()
      ? songs.filter(t => normS(t.title).includes(normS(detailSearch)) || normS(t.artist).includes(normS(detailSearch)))
      : songs;
    // Origen para el botón "Ir a la playlist" del menú de 3 puntitos
    const mixFrom = { kind:'mix', label: view.label, tracks: view.tracks };
    let covers = [...new Set(songs.map(s => s.cover).filter(c => c && !c.startsWith('data:')))].slice(0, 4);
    if (!covers.length) covers = [FALLBACK_COVER];
    while (covers.length < 4) covers.push(covers[covers.length - 1]);
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <Back />
        <div style={{ display:'flex', alignItems:'flex-end', gap:18, marginBottom:24 }}>
          <div style={{ width:128, height:128, borderRadius:18, overflow:'hidden', flexShrink:0, boxShadow:`0 16px 40px ${hex2rgba(T.accent,.3)}`, display:'grid', gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr 1fr', gap:1, background:'var(--surf-2)' }}>
            {covers.map((c, i) => <img key={i} src={hiResCover(c)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />)}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Mezcla</div>
            <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{view.label}</div>
            <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:3 }}>{songs.length} canciones{detailSearch.trim() && filteredSongs.length !== songs.length ? ` · ${filteredSongs.length} resultados` : ''}</div>
          </div>
        </div>
        {songs.length > 0 && (
          <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
            <button onClick={() => play(songs[0], ids, { mixLabel: view.label, from: mixFrom })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>
            <DownloadAllButton ids={ids} downloaded={downloaded} downloading={downloading} onClick={() => downloadMany(ids)} T={T} />
            {(() => {
              const pid = 'mix:' + (view.label || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60);
              const saved = isPlaylistSaved && isPlaylistSaved(pid);
              return (
                <button onClick={() => saved ? unsavePlaylist(pid) : savePlaylist({ label: view.label, tracks: songs })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background: saved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${saved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:99, padding:'10px 18px', cursor:'pointer', color: saved ? T.accent : 'var(--txt-1)', fontSize:12, fontWeight:700 }}>
                  <Icon.Heart c={saved ? T.accent : 'var(--txt-1)'} filled={saved} sz={15} /> {saved ? 'Guardado' : 'Guardar'}
                </button>
              );
            })()}
            {!selecting && <button onClick={() => startSelection()} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Check c={T.accent} sz={15} /> Seleccionar</button>}
          </div>
        )}
        {showSearch && <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="Buscar en esta mezcla…" T={T} />}
        {filteredSongs.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{detailSearch}”.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {filteredSongs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, ids, { mixLabel: view.label, from: mixFrom })} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={isDownloaded(t)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
          </div>
        )}
      </div>
    );
  }

  if (view.type === 'artist') {
    const name = d?.name || view.name || 'Artista';
    const albums = d?.albums || [];
    const all = d?.topSongs || [];
    // Búsqueda dentro de las canciones populares del artista
    const showSearch = all.length >= 8;
    const normA = (s) => String(s || '').toLowerCase();
    const filteredAll = detailSearch.trim()
      ? all.filter(t => normA(t.title).includes(normA(detailSearch)) || normA(t.artist).includes(normA(detailSearch)))
      : all;
    const songs = showAll ? filteredAll : filteredAll.slice(0, 25);
    // Origen para el botón "Ir a la playlist" del menú de 3 puntitos
    const artistFrom = { kind:'artist', artistId: view.artistId, name };
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <Back />
        <div style={{ display:'flex', alignItems:'center', gap:18, marginBottom:24 }}>
          <div style={{ width:108, height:108, borderRadius:'50%', overflow:'hidden', flexShrink:0, boxShadow:`0 14px 40px ${hex2rgba(T.accent,.4)}`, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center' }}>
            {d?.thumbnail ? <CoverImg src={d.thumbnail} alt={name} radius={999} style={{ width:'100%', height:'100%' }} /> : <span style={{ fontSize:42, fontWeight:900, color:'#04060a' }}>{name[0]}</span>}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Artista</div>
            <div style={{ fontSize:26, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{name}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:5 }}>{albums.length} álbum(es) · {all.length} canciones{detailSearch.trim() && filteredAll.length !== all.length ? ` · ${filteredAll.length} resultados` : ''}</div>
            {all.length > 0 && <button onClick={() => play(all[0], all.map(s=>s.id), { from: artistFrom })} className="btn-tap" style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'9px 20px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>}
          </div>
        </div>
        {detailLoading && !d ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner c={T.accent} sz={24} /></div>
        ) : (
          <>
            {albums.length > 0 && <>
              <SectionHeader label="Álbumes" accent={T.accent} />
              <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6, marginBottom:20 }}>
                {albums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={a.year ? String(a.year) : 'Álbum'} T={T} onClick={() => goAlbum(a.albumId, a.name, name, null, a.cover)} />)}
              </div>
            </>}
            <SectionHeader label="Canciones populares" accent={T.accent} action={!selecting && <button onClick={() => startSelection()} className="press" style={{ background:'none', border:'none', cursor:'pointer', color:T.accent, fontSize:11.5, fontWeight:800 }}>Seleccionar</button>} />
            {showSearch && <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="Buscar canciones de este artista…" T={T} />}
            {songs.length === 0 && detailSearch.trim() ? (
              <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{detailSearch}”.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {songs.map(t => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, all.map(s=>s.id), { from: artistFrom })} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={isDownloaded(t)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
              </div>
            )}
            {!showAll && filteredAll.length > 25 && (
              <button onClick={() => setShowAll(true)} className="press" style={{ display:'block', margin:'16px auto 0', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'var(--txt-0)', fontSize:12.5, fontWeight:700 }}>Ver más canciones</button>
            )}
          </>
        )}
      </div>
    );
  }

  // álbum
  const name = d?.name || view.name || 'Álbum';
  const artist = d?.artist || view.artist;
  const allSongs = d?.tracks || [];
  // Búsqueda dentro del álbum
  const showSearch = allSongs.length >= 8;
  const normAl = (s) => String(s || '').toLowerCase();
  const songs = detailSearch.trim()
    ? allSongs.filter(t => normAl(t.title).includes(normAl(detailSearch)) || normAl(t.artist).includes(normAl(detailSearch)))
    : allSongs;
  const cover = d?.cover || view.cover || songs[0]?.cover;
  // Origen para el botón "Ir a la playlist" del menú de 3 puntitos
  const albumFrom = { kind:'album', albumId: view.albumId, name, artist, cover };
  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <Back />
      <div style={{ display:'flex', alignItems:'flex-end', gap:18, marginBottom:24 }}>
        <CoverImg src={cover} alt={name} radius={18} style={{ width:128, height:128, flexShrink:0, boxShadow:`0 16px 40px ${hex2rgba(T.accent,.3)}` }} />
        <div style={{ minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:9, fontWeight:900, letterSpacing:2.5, color:T.accent, textTransform:'uppercase' }}>Álbum{d?.year ? ` · ${d.year}` : ''}</div>
            {d?.offline && <span style={{ fontSize:8, fontWeight:900, letterSpacing:1.5, color:'var(--txt-2)', textTransform:'uppercase', background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'2px 8px' }}>Offline</span>}
          </div>
          <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6, marginTop:3 }}>{name}</div>
          <button onClick={() => goArtist(d?.artistId, artist)} className="press" style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:12.5, color:'var(--txt-1)', fontWeight:700, marginTop:5 }}>{artist}</button>
          <div style={{ fontSize:11, color:'var(--txt-2)', marginTop:3 }}>{allSongs.length} canciones{detailSearch.trim() && songs.length !== allSongs.length ? ` · ${songs.length} resultados` : ''}</div>
        </div>
      </div>
      {detailLoading && !d ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner c={T.accent} sz={24} /></div>
      ) : allSongs.length === 0 ? (
        <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontró el álbum de esta canción.</div>
      ) : (
        <>
          {allSongs.length > 0 && (
            <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
              <button onClick={() => play(allSongs[0], allSongs.map(s=>s.id), { from: albumFrom })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'10px 22px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>
              {(() => { const albumId = view.albumId || d?.albumId; const saved = albumId && isAlbumSaved(albumId); const meta = { albumId, name, artist, cover, year: d?.year }; return (
                <button onClick={() => saved ? unsaveAlbum(albumId) : saveAlbum(meta)} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background: saved ? hex2rgba(T.accent,.14) : 'var(--surf-1)', border:`1px solid ${saved ? hex2rgba(T.accent,.4) : 'var(--line)'}`, borderRadius:99, padding:'10px 18px', cursor:'pointer', color: saved ? T.accent : 'var(--txt-1)', fontSize:12, fontWeight:700 }}>
                  <Icon.Heart c={saved ? T.accent : 'var(--txt-1)'} filled={saved} sz={15} /> {saved ? 'Guardado' : 'Guardar'}
                </button>
              ); })()}
              <DownloadAllButton ids={allSongs.map(s=>s.id)} downloaded={downloaded} downloading={downloading} onClick={() => { const albumId = view.albumId || d?.albumId; downloadMany(allSongs.map(s=>s.id)); if (albumId) saveAlbum({ albumId, name, artist, cover, year: d?.year }); }} T={T} />
              {!selecting && <button onClick={() => startSelection()} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'10px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Check c={T.accent} sz={15} /> Seleccionar</button>}
            </div>
          )}
          {showSearch && <SearchBar value={detailSearch} onChange={setDetailSearch} placeholder="Buscar en este álbum…" T={T} />}
          {songs.length === 0 ? (
            <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{detailSearch}”.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {songs.map((t, i) => <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T} onClick={() => play(t, allSongs.map(s=>s.id), { from: albumFrom })} onSwipeRemove={removeFromQueue} onFav={toggleFav} faved={favs.includes(t.id)} onAdd={addToTarget} onMenu={onMenu} downloaded={isDownloaded(t)} downloading={downloading.has(t.id)} selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect} onSwipeQueue={addToQueue} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR (escritorio)

