import React from 'react';
import { createPortal } from 'react-dom';
import { trackById } from '../catalog.js';
import { Icon } from '../Icons.jsx';
import { CoverImg } from '../components.jsx';
import { useLibraryStore } from '../store/libraryStore.js';
import { usePlayerStore } from '../store/playerStore.js';

export function TrackMenu({ trackId, onClose, T, addToTarget, goArtist, goAlbum, shareTrack, addToQueue, download, removeDownload, playingFrom, goToPlayingPlaylist }) {
  // Library store
  const favs = useLibraryStore((s) => s.favs);
  const toggleFavInStore = useLibraryStore((s) => s.toggleFav);
  // Player store
  const track = usePlayerStore((s) => s.track);
  const downloaded = usePlayerStore((s) => s.downloaded);

  if (!trackId) return null;
  const tk = trackById(trackId);
  if (!tk) return null;
  const faved = favs.includes(trackId);
  const isDl = downloaded.has(trackId);
  const toggleFav = (id) => { toggleFavInStore(id); /* App.jsx escucha cambios para llamar api */ };
  const items = [
    { icon: Icon.Queue, label:'Añadir a la cola', action: () => { addToQueue(trackId); onClose(); } },
    { icon: Icon.Disc,  label:'Ir al álbum',      action: () => { goAlbum(tk.albumId, tk.album, tk.artist, tk.title, tk.cover); onClose(); } },
    { icon: Icon.User,  label:'Ir al artista',    action: () => { goArtist(tk.artistId, tk.artist); onClose(); } },
  ];
  // "Ir a la playlist/mix/álbum" — solo si la pista actual se reprodujo desde
  // un origen trackeable (playingFrom != null) Y la pista del menú es la que
  // se está reproduciendo ahora mismo.
  if (playingFrom && goToPlayingPlaylist && track?.id === trackId) {
    const label = playingFrom.kind === 'liked' ? 'Ir a Me gusta'
      : playingFrom.kind === 'mix' ? 'Ir a la mezcla'
      : playingFrom.kind === 'album' ? 'Ir al álbum'
      : playingFrom.kind === 'artist' ? 'Ir al artista'
      : 'Ir a la playlist';
    items.push({ icon: Icon.List, label, action: () => { goToPlayingPlaylist(); onClose(); }, hl: true });
  }
  items.push(
    { icon: Icon.Plus,  label:'Añadir a playlist',action: () => { addToTarget(trackId); onClose(); } },
    { icon: Icon.Heart, label: faved ? 'Quitar de Me gusta' : 'Añadir a Me gusta', action: () => { toggleFav(trackId); onClose(); }, filled: faved },
    isDl
      ? { icon: Icon.Trash, label:'Eliminar descarga', action: () => { removeDownload(trackId); onClose(); } }
      : { icon: Icon.Down,  label:'Descargar (offline)', action: () => { download(tk); onClose(); } },
    { icon: Icon.Share, label:'Compartir enlace', action: () => { shareTrack(tk); onClose(); } },
  );
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#04060acc', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', zIndex:130 }} />
      <div className="fade-up" style={{ position:'fixed', left:0, right:0, bottom:0, margin:'0 auto', width:'100%', maxWidth:460, maxHeight:'85dvh', overflowY:'auto', background:'linear-gradient(180deg, var(--surf-1), var(--surf-0))', border:'1px solid var(--line)', borderRadius:'26px 26px 0 0', padding:'10px 16px calc(env(safe-area-inset-bottom, 16px) + 18px)', zIndex:131, boxShadow:'0 -30px 80px #000d' }}>
        <div style={{ width:40, height:4, borderRadius:99, background:'var(--surf-2)', margin:'6px auto 12px' }} />
        <div style={{ display:'flex', alignItems:'center', gap:13, padding:'4px 6px 14px', borderBottom:'1px solid var(--line-soft)', marginBottom:8 }}>
          <CoverImg src={tk.cover} alt="" radius={12} style={{ width:52, height:52, flexShrink:0 }} />
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:14.5, fontWeight:800, color:'var(--txt-0)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tk.title}</div>
            <div style={{ fontSize:11.5, color:'var(--txt-2)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tk.artist}{tk.album ? ` · ${tk.album}` : ''}</div>
          </div>
        </div>
        {items.map((it, i) => (
          <button key={i} onClick={it.action} className="press" style={{ display:'flex', alignItems:'center', gap:15, width:'100%', padding:'13px 12px', borderRadius:13, background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <it.icon c={(it.filled || it.hl) ? T.accent : 'var(--txt-1)'} sz={19} filled={it.filled} />
            <span style={{ fontSize:14, fontWeight:600, color: it.hl ? T.accent : 'var(--txt-0)' }}>{it.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

