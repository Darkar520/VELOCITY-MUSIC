import React from 'react';
import {CoverImg} from '../components.jsx';
import {Icon} from '../Icons.jsx';
export function DiscoverySongs({tracks,title='Tu próxima favorita',eyebrow='DALE PLAY',play,onMenu,onToggleFav,favs=[]}){
 if(!tracks.length)return null;
 const ids=tracks.map(t=>t.id);
 return <section className="discovery-songs"><header><div><span className="discovery-eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="discovery-detail">Desliza para descubrir más</span></header>
   <div className="discovery-song-grid discovery-song-scroll" role="region" aria-label={title} tabIndex={0}>{tracks.map(t=><div className="discovery-song" key={t.id}>
     <button className="discovery-song-main" onClick={()=>play(t,ids)} aria-label={`Reproducir ${t.title}`}><CoverImg src={t.cover} alt="" size={128} eager={false} radius={8}/><span><strong>{t.title}</strong><small>{t.artist}</small></span></button>
     <button className="discovery-icon" aria-label={favs.includes(t.id)?`Quitar Me gusta de ${t.title}`:`Me gusta ${t.title}`} aria-pressed={favs.includes(t.id)} onClick={()=>onToggleFav?.(t.id)}><Icon.Heart sz={18} filled={favs.includes(t.id)}/></button>
     <button className="discovery-icon" aria-label={`Opciones de ${t.title}`} onClick={()=>onMenu?.(t.id)}><Icon.Dots sz={18}/></button>
   </div>)}</div>
 </section>;
}
