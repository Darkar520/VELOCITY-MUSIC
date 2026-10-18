import React from 'react';
import {CoverImg} from '../components.jsx';
import {Icon} from '../Icons.jsx';
import './homeDiscovery.css';

export function HomeDiscovery({rows,prefs,play,goMix,onMenu,onToggleFav,favs=[],loading,retry,onEditPrefs}) {
  const mixes=rows.flatMap(s=>s.mixes || []).filter(m=>m.tracks?.length);
  const preferred=(prefs?.artists||[]).map(a=>a.name.toLocaleLowerCase());
  const featured=mixes.find(m=>preferred.includes(m.label.toLocaleLowerCase()))||mixes[0];
  const ordered=featured?[featured,...mixes.filter(m=>m!==featured)]:mixes;
  const songs=[],seenSongs=new Set(),artistCounts=new Map();
  for(let i=0;i<60&&songs.length<6;i++)for(const mix of ordered){
    const t=mix.tracks[i];if(!t||seenSongs.has(t.id)||(artistCounts.get(t.artist)||0)>=2)continue;
    songs.push(t);seenSongs.add(t.id);artistCounts.set(t.artist,(artistCounts.get(t.artist)||0)+1);
    if(songs.length===6)break;
  }
  const uniqueArt=[...new Map((featured?.tracks||[]).filter(t=>t.cover).map(t=>[t.cover,t])).values()].slice(0,4);
  const heroArt=uniqueArt.length===4?uniqueArt:[featured?.tracks[0]].filter(Boolean);
  const genres=Array.isArray(prefs)?prefs:prefs?.genres || [];
  const start=m=>play(m.tracks[0],m.tracks.map(t=>t.id),{mixLabel:m.label});
  if(!featured)return <section className="discovery-empty" aria-live="polite">
    <span className="discovery-eyebrow">TU SELECCIÓN PERSONAL</span>
    <h2>{loading?'Afinando tu selección…':'Tu música empieza contigo.'}</h2>
    <p>{loading?'Buscamos canciones de los géneros y artistas que elegiste.':'No pudimos cargar las recomendaciones. Tus preferencias están guardadas.'}</p>
    {loading?<div className="discovery-skeleton" aria-label="Cargando recomendaciones"/>:<button onClick={retry}>Volver a intentar</button>}
  </section>;
  return <div className="discovery">
    <section className="discovery-hero" aria-label="Selección destacada">
      <div className="discovery-hero-copy">
        <span className="discovery-eyebrow">EN TU FRECUENCIA</span>
        <h2>Un mundo por<br/><em>escuchar.</em></h2>
        <p>Empieza con {featured.label}. Sigue con todo lo que conecta con tu música.</p>
        <div className="discovery-tags">{genres.slice(0,5).map(g=><span key={g.q}>{g.label}</span>)}{onEditPrefs&&<button className="discovery-tune" onClick={onEditPrefs}>Ajustar gustos</button>}</div>
        <div className="discovery-hero-actions"><button className="discovery-play" onClick={()=>start(featured)}><Icon.Play sz={18}/> Reproducir selección</button><button className="discovery-link" onClick={()=>goMix(featured)}>Explorar mix <span aria-hidden="true">↗</span></button></div>
      </div>
      <button className={`discovery-mosaic ${heroArt.length===1?'discovery-mosaic-single':''}`} onClick={()=>goMix(featured)} aria-label={`Explorar ${featured.label}`}>
        {heroArt.map((t,i)=><CoverImg key={t.id+i} src={t.cover} alt="" size={512} radius={0}/>) }
        <span className="discovery-mosaic-caption"><small>SELECCIÓN PARA TI</small><strong>{featured.label}</strong><span>{featured.tracks.length} canciones</span></span>
      </button>
    </section>
    <section className="discovery-songs"><header><div><span className="discovery-eyebrow">DALE PLAY</span><h2>Tu próxima favorita</h2></div><span className="discovery-detail">De tus recomendaciones</span></header>
      <div className="discovery-song-grid">{songs.map((t,i)=><div className="discovery-song" key={t.id}>
        <button className="discovery-song-main" onClick={()=>play(t,songs.map(s=>s.id))} aria-label={`Reproducir ${t.title}`}><span className="discovery-number">{String(i+1).padStart(2,'0')}</span><CoverImg src={t.cover} alt="" size={128} radius={8}/><span><strong>{t.title}</strong><small>{t.artist}</small></span></button>
        <button className="discovery-icon" aria-label={favs.includes(t.id)?`Quitar Me gusta de ${t.title}`:`Me gusta ${t.title}`} aria-pressed={favs.includes(t.id)} onClick={()=>onToggleFav?.(t.id)}><Icon.Heart sz={18}/></button>
        <button className="discovery-icon" aria-label={`Opciones de ${t.title}`} onClick={()=>onMenu?.(t.id)}><Icon.Dots sz={18}/></button>
      </div>)}</div>
    </section>
    {rows.filter(s=>s.mixes?.length).map((section,index)=><section className="discovery-section" key={section.section}>
      <header><div><span className="discovery-eyebrow">{String(index+1).padStart(2,'0')} / EXPLORA TU SONIDO</span><h2>{section.section}</h2></div><span className="discovery-detail">{section.mixes.length} selecciones</span></header>
      <div className="discovery-mixes">{section.mixes.map((mix,i)=><article className="discovery-mix" key={mix.label+i}>
        <div className="discovery-mix-art"><button onClick={()=>goMix(mix)} aria-label={`Abrir ${mix.label}`}><CoverImg src={mix.tracks[0]?.cover} alt="" size={512} radius={0}/></button><span className="discovery-mix-index">MIX / {String(i+1).padStart(2,'0')}</span><button className="discovery-mix-play" aria-label={`Reproducir mix ${mix.label}`} onClick={()=>start(mix)}><Icon.Play sz={20}/></button></div>
        <button className="discovery-mix-title" onClick={()=>goMix(mix)}>{mix.label}</button><p>{[...new Set(mix.tracks.map(t=>t.artist))].slice(0,3).join(' · ')}</p>
      </article>)}</div>
    </section>)}
  </div>;
}
