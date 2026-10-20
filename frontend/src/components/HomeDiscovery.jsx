import React,{useEffect,useRef,useState} from 'react';
import {CoverImg} from '../components.jsx';
import {Icon} from '../Icons.jsx';
import './homeDiscovery.css';
import {DiscoverySongs} from './DiscoverySongs.jsx';
import {useFeedLoop} from '../hooks/useFeedLoop.js';
import {preferenceKey} from '../feed/tasteProfile.js';
import {PersonalizedShelves} from './PersonalizedShelves.jsx';
import {bestCoverFor} from '../catalog.js';
import {settlePendingShelves} from '../feed/personalizedShelves.js';

const mixArtwork = tracks => {
  const track = tracks.find(t => t.cover) || tracks[0];
  return bestCoverFor(track?.id, track?.cover);
};

export function HomeDiscovery({rows,prefs,personalShelves=[],shelfKey='',play,goMix,onMenu,onToggleFav,favs=[],loading,retry,onEditPrefs,offline=false}) {
  const {firstRef,repeatRef}=useFeedLoop(rows.length);
  const songSnapshot=useRef(null);
  const shelfSnapshot=useRef(null);
  const moreRef=useRef(null);
  const observedCount=useRef(-1);
  const rowCountRef=useRef(rows.length);
  const armedRef=useRef(true);
  const [moreStatus,setMoreStatus]=useState('idle');
  const pending=rows.some(row=>row.mixes?.some(m=>m.pending));
  rowCountRef.current=rows.length;
  useEffect(()=>{
    const onResult=e=>setMoreStatus(e.detail?.added?'idle':'empty');
    window.addEventListener('velocity:feed-more-result',onResult);
    return()=>window.removeEventListener('velocity:feed-more-result',onResult);
  },[]);
  useEffect(()=>{
    const node=moreRef.current;
    if(!node||!rows.some(row=>row.mixes?.some(m=>!m.pending&&m.tracks?.length))||loading||pending||offline||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{
      if(entries.every(e=>!e.isIntersecting)){armedRef.current=true;return;}
      if(armedRef.current&&observedCount.current!==rowCountRef.current){
        armedRef.current=false;
        observedCount.current=rowCountRef.current;
        setMoreStatus('loading');
        window.dispatchEvent(new Event('velocity:feed-more'));
      }
    },{rootMargin:'300px'});
    observer.observe(node);return()=>observer.disconnect();
  },[rows.length,loading,pending,offline]);
  const readyRows=rows.map(row=>({...row,mixes:(row.mixes||[]).filter(m=>!m.pending)})).filter(row=>row.mixes.length);
  const mixes=readyRows.flatMap(s=>s.mixes).filter(m=>m.tracks?.length);
  const preferred=(prefs?.artists||[]).map(a=>a.name.toLocaleLowerCase());
  const fullMixes=mixes.filter(m=>m.tracks.length===50);
  const featured=fullMixes.find(m=>m.featured)||fullMixes.find(m=>preferred.includes(m.label.toLocaleLowerCase()))||fullMixes[0]||null;
  const ordered=featured?[featured,...mixes.filter(m=>m!==featured)]:mixes;
  const candidates=[],seenSongs=new Set(),artistCounts=new Map();
  for(let i=0;i<60&&candidates.length<72;i++)for(const mix of ordered){
    const t=mix.tracks[i];if(!t||seenSongs.has(t.id)||(artistCounts.get(t.artist)||0)>=8)continue;
    candidates.push(t);seenSongs.add(t.id);artistCounts.set(t.artist,(artistCounts.get(t.artist)||0)+1);
    if(candidates.length===72)break;
  }
  const profile=preferenceKey(prefs);
  const shelfProfile=profile+shelfKey;
  const tailShelves=shelfSnapshot.current?.profile===shelfProfile?settlePendingShelves(shelfSnapshot.current.shelves,personalShelves):personalShelves;
  const lockShelves=()=>{shelfSnapshot.current={profile:shelfProfile,shelves:tailShelves};};
  const songs=songSnapshot.current?.profile===profile?songSnapshot.current.tracks:candidates;
  const lockSongs=()=>{songSnapshot.current={profile,tracks:songs};lockShelves();};
  const playSong=(...args)=>{lockSongs();play(...args);};
  const toggleSongFav=id=>{lockSongs();onToggleFav?.(id);};
  const songMenu=id=>{lockSongs();onMenu?.(id);};
  const uniqueArt=[...new Map((featured?.tracks||[]).filter(t=>t.cover).map(t=>[t.cover,t])).values()].slice(0,4);
  const heroArt=uniqueArt.length===4?uniqueArt:[uniqueArt[0]||featured?.tracks[0]].filter(Boolean);
  const genres=Array.isArray(prefs)?prefs:prefs?.genres || [];
  const start=m=>play(m.tracks[0],m.tracks.map(t=>t.id),{mixLabel:m.label});
  const content=<>
    {!featured&&<section className="discovery-empty" aria-live="polite">
      <span className="discovery-eyebrow">TU SELECCIÓN PERSONAL</span>
      <h2 style={{color:'#f4f7f5'}}>{loading?'Afinando tu selección…':offline?'Tu frecuencia volverá al conectar.':'Tu música empieza contigo.'}</h2>
      <p>{loading?'Buscamos canciones de los géneros y artistas que elegiste.':offline?'Tus playlists guardadas siguen disponibles abajo. La mezcla personalizada necesita conexión para completar 50 canciones.':'No pudimos cargar las recomendaciones. Tus preferencias están guardadas.'}</p>
      {onEditPrefs&&<button onClick={onEditPrefs}>Ajustar gustos</button>}
      {loading?<div className="discovery-skeleton" aria-label="Cargando recomendaciones"/>:<button onClick={retry}>Volver a intentar</button>}
    </section>}
    {featured&&<section className="discovery-hero" aria-label="Selección destacada">
      <div className="discovery-hero-copy">
        <span className="discovery-eyebrow">EN TU FRECUENCIA</span>
        <h2>Un mundo por<br/><em>escuchar.</em></h2>
        <p>Empieza con {featured.label}. Sigue con todo lo que conecta con tu música.</p>
        <div className="discovery-tags">{genres.slice(0,5).map(g=><span key={g.q}>{g.label}</span>)}{onEditPrefs&&<button className="discovery-tune" onClick={onEditPrefs}>Ajustar gustos</button>}</div>
        <div className="discovery-hero-actions"><button className="discovery-play" onClick={()=>start(featured)}><Icon.Play sz={18}/> Reproducir selección</button><button className="discovery-link" onClick={()=>goMix(featured)}>Explorar mix <span aria-hidden="true">↗</span></button></div>
      </div>
      <button className={`discovery-mosaic ${heroArt.length===1?'discovery-mosaic-single':''}`} onClick={()=>goMix(featured)} aria-label={`Explorar ${featured.label}`}>
        {heroArt.map((t,i)=><CoverImg key={t.id+i} src={bestCoverFor(t.id,t.cover)} alt="" size={256} eager priority="high" radius={0}/>) }
        <span className="discovery-mosaic-caption"><small>SELECCIÓN PARA TI</small><strong>{featured.label}</strong><span>{featured.tracks.length} canciones</span></span>
      </button>
    </section>}
    {featured&&<DiscoverySongs tracks={songs.slice(0,36)} play={playSong} onMenu={songMenu} onToggleFav={toggleSongFav} favs={favs}/>}
    {readyRows.filter(s=>!s.mixes.every(m=>m.featured)).map(section=><section className="discovery-section" key={section.section}>
      <header><div><span className="discovery-eyebrow">EXPLORA TU SONIDO</span><h2>{section.section}</h2></div><span className="discovery-detail">{section.mixes.length} selecciones</span></header>
      <div className="discovery-mixes">{section.mixes.map((mix,i)=><article className="discovery-mix" key={mix.label+i}>
        <div className="discovery-mix-art"><button onClick={()=>goMix(mix)} aria-label={`Abrir ${mix.label}`}><CoverImg src={mixArtwork(mix.tracks)} alt="" size={256} radius={0}/></button><button className="discovery-mix-play" aria-label={`Reproducir mix ${mix.label}`} onClick={()=>start(mix)}><Icon.Play sz={20}/></button></div>
        <button className="discovery-mix-title" onClick={()=>goMix(mix)}>{mix.label}</button><p>{[...new Set(mix.tracks.map(t=>t.artist))].slice(0,3).join(' · ')}</p>
      </article>)}</div>
    </section>)}
    {featured&&<DiscoverySongs tracks={songs.slice(36,72)} title="Más canciones para ti" eyebrow="SIGUE ESCUCHANDO" play={playSong} onMenu={songMenu} onToggleFav={toggleSongFav} favs={favs}/>}
    <PersonalizedShelves shelves={tailShelves} play={playSong} goMix={goMix} onInteract={lockShelves}/>
  </>;
  return <div className="discovery">
    <div className="discovery-cycle" ref={firstRef}>
    {content}
    <div ref={moreRef} className="discovery-more" aria-hidden="true"/>
    {!offline&&moreStatus==='loading'&&<p className="discovery-more-status" role="status">Buscando más música…</p>}
    {!offline&&moreStatus==='empty'&&<div className="discovery-more-status"><p>Por ahora no encontramos más selecciones nuevas.</p><button onClick={()=>{setMoreStatus('loading');window.dispatchEvent(new Event('velocity:feed-more'));}}>Intentar de nuevo</button></div>}
    </div>
    <div className="discovery-cycle discovery-repeat" ref={repeatRef} aria-hidden="true" inert="">{content}</div>
  </div>;
}
