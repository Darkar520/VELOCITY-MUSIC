import React, { useState, useEffect } from 'react';
import { hex2rgba, grad, hiResCover, dedupeByTitle } from '../helpers.js';
import { trackById } from '../catalog.js';
import { Icon } from '../Icons.jsx';
import { Spinner, DownloadAllButton, CoverImg, SectionHeader, TrackRow, MediaCard, MixCard } from '../components.jsx';
import { SearchBar } from './SearchBar.jsx';
import { useListSearch } from './useListSearch.js';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

export function LibraryTab({ T, play, openPlaylist, setOpenPlaylist, addToTarget, onMenu, downloadMany, goAlbum, goMix, selecting, selection, toggleSelect, startSelection, addToQueue, removeFromQueue, setShowImport, hydrateTracks, createPlaylist, removeFromPlaylist, deletePlaylist, savePlaylist, unsavePlaylist }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  const toggleFavInStore = useLibraryStore((s) => s.toggleFav);
  const playlists = useLibraryStore((s) => s.playlists);
  const savedAlbums = useLibraryStore((s) => s.savedAlbums);
  const savedPlaylists = useLibraryStore((s) => s.savedPlaylists);
  const isPlaylistSaved = useLibraryStore((s) => s.isPlaylistSaved);
  // Player store
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const downloaded = usePlayerStore((s) => s.downloaded);
  const downloading = usePlayerStore((s) => s.downloading);
  // Wrapper
  const toggleFav = (id) => toggleFavInStore(id);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // Búsqueda dentro de la playlist abierta. Hook al nivel superior (no dentro
  // del if openPlaylist) para cumplir con las Rules of Hooks de React.
  const [plSearch, setPlSearch] = useState('');

  // Al abrir una playlist / Me gusta, recuperar metadatos faltantes del backend.
  useEffect(() => {
    if (!openPlaylist || !hydrateTracks) return;
    const ids = openPlaylist === 'liked' ? favs
      : openPlaylist.startsWith('saved:') ? (savedPlaylists.find(p => p.playlistId === openPlaylist.slice(6))?.trackIds || [])
      : (playlists.find(p => p.id === openPlaylist)?.trackIds || []);
    hydrateTracks(ids);
  }, [openPlaylist]);

  // Limpiar la búsqueda al cambiar de playlist (no heredar filtro entre vistas).
  useEffect(() => { setPlSearch(''); }, [openPlaylist]);

  // Mapea el openPlaylist string al formato de objeto que usa playingFrom.
  // Se pasa como opts.from en las llamadas a play() dentro de esta vista.
  const fromForOpenPlaylist = (op) => {
    if (!op) return undefined;
    if (op === 'liked') return { kind: 'liked' };
    if (op.startsWith('saved:')) return { kind: 'saved-playlist', id: op.slice(6) };
    return { kind: 'user-playlist', id: op };
  };

  if (openPlaylist) {
    const isLiked = openPlaylist === 'liked';
    const isSaved = openPlaylist.startsWith('saved:');
    const savedPl = isSaved ? savedPlaylists.find(p => p.playlistId === openPlaylist.slice(6)) : null;
    if (isSaved && !savedPl) { setOpenPlaylist(null); return null; }
    const pl = isLiked ? { name:'Me gusta', trackIds:favs } : isSaved ? { name: savedPl.name, trackIds: savedPl.trackIds || [] } : playlists.find(p => p.id === openPlaylist);
    if (!pl) { setOpenPlaylist(null); return null; }
    const list = pl.trackIds.map(trackById).filter(Boolean);
    // ── Búsqueda dentro de la playlist ──
    const showSearch = list.length >= 8;
    const norm = (s) => String(s || '').toLowerCase();
    const filtered = plSearch.trim()
      ? list.filter(t => norm(t.title).includes(norm(plSearch)) || norm(t.artist).includes(norm(plSearch)))
      : list;
    return (
      <div className="fade-up" style={{ paddingBottom:8 }}>
        <button onClick={() => setOpenPlaylist(null)} className="press" style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--txt-1)', marginBottom:16, paddingTop:4, fontSize:13, fontWeight:700 }}>
          <Icon.ChevL c="var(--txt-1)" sz={18} /> Biblioteca
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
          <div style={{ width:96, height:96, borderRadius:18, background: isLiked ? grad(T) : 'var(--surf-1)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 12px 30px ${hex2rgba(T.accent,.3)}`, overflow:'hidden', flexShrink:0 }}>
            {isLiked ? <Icon.Heart c="#04060a" filled sz={40} /> : <Icon.List c={T.accent} sz={38} />}
          </div>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:22, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{pl.name}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:4 }}>{list.length} {list.length===1?'canción':'canciones'}{plSearch.trim() && filtered.length !== list.length ? ` · ${filtered.length} resultados` : ''}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
          {list.length > 0 && <button onClick={() => play(list[0], pl.trackIds, { from: fromForOpenPlaylist(openPlaylist) })} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:8, background:grad(T), border:'none', borderRadius:99, padding:'9px 20px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800, boxShadow:`0 6px 18px ${hex2rgba(T.accent,.45)}` }}><Icon.Play c="#04060a" sz={16} /> Reproducir</button>}
          {pl.trackIds.length > 0 && <DownloadAllButton ids={pl.trackIds} downloaded={downloaded} downloading={downloading} onClick={() => downloadMany(pl.trackIds)} T={T} />}
          {!isLiked && !isSaved && <button onClick={() => { deletePlaylist(pl.id); setOpenPlaylist(null); }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'9px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Trash c="var(--txt-1)" sz={15} /> Eliminar</button>}
          {isSaved && <button onClick={() => { unsavePlaylist(savedPl.playlistId); setOpenPlaylist(null); }} className="btn-tap" style={{ display:'flex', alignItems:'center', gap:7, background:'var(--surf-1)', border:'1px solid var(--line)', borderRadius:99, padding:'9px 16px', cursor:'pointer', color:'var(--txt-1)', fontSize:12, fontWeight:700 }}><Icon.Trash c="var(--txt-1)" sz={15} /> Eliminar</button>}
        </div>
        {/* Barra de búsqueda — solo si hay 8+ canciones */}
        {showSearch && <SearchBar value={plSearch} onChange={setPlSearch} placeholder="Buscar en esta playlist…" T={T} />}
        {pl.trackIds.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>Esta playlist está vacía. Añade canciones con el botón +.</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--txt-2)', fontSize:13, paddingTop:30 }}>No se encontraron canciones para “{plSearch}”.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {filtered.map(t => (
              <TrackRow key={t.id} track={t} active={t.id===track?.id} playing={playing} T={T}
                onClick={() => play(t, pl.trackIds, { from: fromForOpenPlaylist(openPlaylist) })}
                onFav={toggleFav} faved={favs.includes(t.id)} onMenu={onMenu}
                downloaded={downloaded.has(t.id)} downloading={downloading.has(t.id)}
                selecting={selecting} selected={selection.has(t.id)} onSelect={toggleSelect}
                onRemove={isLiked || isSaved ? undefined : (id => removeFromPlaylist(pl.id, id))} onSwipeQueue={addToQueue} onSwipeRemove={removeFromQueue} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ paddingBottom:8 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:4 }}>
        <div style={{ fontSize:24, fontWeight:900, color:'var(--txt-0)', letterSpacing:-.6 }}>Tu Biblioteca</div>
        <div style={{ display:'flex', gap:10 }}>
          <button aria-label="Me gusta" onClick={() => setOpenPlaylist('liked')} className="press" style={{ width:36, height:36, borderRadius:'50%', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.18)}, ${hex2rgba(T.accent2,.06)})`, border:`1px solid ${hex2rgba(T.accent,.3)}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Heart c={T.accent} filled sz={18} /></button>
          <button aria-label="Crear playlist" onClick={() => setCreating(c=>!c)} className="press" style={{ width:36, height:36, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Plus c={T.accent} sz={20} /></button>
          <button aria-label="Importar playlist" onClick={() => setShowImport(true)} className="press" style={{ width:36, height:36, borderRadius:'50%', background:'var(--surf-1)', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}><Icon.Down c={T.accent} sz={18} /></button>
        </div>
      </div>
      <div style={{ fontSize:12.5, color:'var(--txt-2)', marginBottom:18, marginTop:4 }}>{playlists.length + 1 + (savedPlaylists?.length || 0)} playlists</div>

      {creating && (
        <form onSubmit={e => { e.preventDefault(); if (name.trim()) { createPlaylist(name.trim()); setName(''); setCreating(false); } }} style={{ display:'flex', gap:8, marginBottom:16 }}>
          <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la playlist" style={{ flex:1, background:'var(--surf-0)', border:`1px solid ${hex2rgba(T.accent,.4)}`, borderRadius:12, padding:'10px 14px', fontSize:13, color:'var(--txt-0)', outline:'none', fontFamily:'Inter,sans-serif' }} />
          <button type="submit" className="btn-tap" style={{ background:grad(T), border:'none', borderRadius:12, padding:'0 16px', cursor:'pointer', color:'#04060a', fontSize:12.5, fontWeight:800 }}>Crear</button>
        </form>
      )}

      <div onClick={() => setOpenPlaylist('liked')} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', background:`linear-gradient(135deg, ${hex2rgba(T.accent,.14)}, ${hex2rgba(T.accent2,.04)})`, border:`1px solid ${hex2rgba(T.accent,.25)}`, marginBottom:6 }}>
        <div style={{ width:46, height:46, borderRadius:12, background:grad(T), display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 4px 14px ${hex2rgba(T.accent,.4)}` }}><Icon.Heart c="#04060a" filled sz={22} /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)' }}>Me gusta</div>
          <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist · {favs.length} canciones</div>
        </div>
        <Icon.ChevL c="var(--txt-3)" sz={18} />
      </div>

      {playlists.map(p => (
        <div key={p.id} onClick={() => setOpenPlaylist(p.id)} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', border:'1px solid transparent', marginBottom:2 }}>
          <div style={{ width:46, height:46, borderRadius:12, background:'var(--surf-1)', border:'1px solid var(--line-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.List c={T.accent} sz={20} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist · {p.trackIds.length} canciones</div>
          </div>
          <Icon.ChevL c="var(--txt-3)" sz={18} />
        </div>
      ))}

      {savedAlbums && savedAlbums.length > 0 && (
        <>
          <SectionHeader label="Álbumes Guardados" accent={T.accent} />
          <div style={{ display:'flex', gap:15, overflowX:'auto', paddingBottom:6 }}>
            {savedAlbums.map(a => <MediaCard key={a.albumId} cover={a.cover} title={a.name} subtitle={a.artist || 'Álbum'} T={T} onClick={() => goAlbum(a.albumId, a.name, a.artist, null, a.cover)} />)}
          </div>
        </>
      )}

      {savedPlaylists && savedPlaylists.length > 0 && (
        <>
          <SectionHeader label="Playlists Guardadas" accent={T.accent} />
          {savedPlaylists.map(p => (
            <div key={p.playlistId} onClick={() => setOpenPlaylist('saved:' + p.playlistId)} className="card-hover" style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 12px', borderRadius:16, cursor:'pointer', border:'1px solid transparent', marginBottom:2 }}>
              <div style={{ width:46, height:46, borderRadius:12, background:hex2rgba(T.accent,.12), border:`1px solid ${hex2rgba(T.accent,.3)}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><Icon.Heart c={T.accent} filled sz={20} /></div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:700, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
                <div style={{ fontSize:10.5, color:'var(--txt-2)', marginTop:3 }}>Playlist guardada · {p.trackIds?.length || 0} canciones</div>
              </div>
              <Icon.ChevL c="var(--txt-3)" sz={18} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE / YO TAB

