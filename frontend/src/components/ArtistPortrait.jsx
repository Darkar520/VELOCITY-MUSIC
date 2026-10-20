import React,{useEffect,useRef,useState} from 'react';
import {CoverImg} from '../components.jsx';
import {getCachedPortrait,requestArtistPortrait} from '../feed/artistPortraits.js';
export function ArtistPortrait({artist,active,accent}){
  const ref=useRef(null);
  const retryCount=useRef(0);
  const [portrait,setPortrait]=useState(()=>artist.thumbnail||getCachedPortrait(artist.name)?.thumbnail||'');
  const [visible,setVisible]=useState(false),[failed,setFailed]=useState(false),[retryKey,setRetryKey]=useState(0);
  useEffect(()=>{
    retryCount.current=0;
    setPortrait(artist.thumbnail||getCachedPortrait(artist.name)?.thumbnail||'');setFailed(false);
    if(!ref.current)return;
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:'120px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[artist.name,artist.thumbnail]);
  useEffect(()=>{
    if(!visible||portrait)return;
    const controller=new AbortController();let cancelled=false,failedOnce=false,retryTimer=null;
    const recover=()=>{
      if(!failedOnce||cancelled||navigator.onLine===false||document.visibilityState==='hidden')return;
      if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
      retryCount.current=0;
      setRetryKey(value=>value+1);
    };
    window.addEventListener('online',recover);
    document.addEventListener('visibilitychange',recover);
    const failAndRetry=()=>{
      failedOnce=true;setFailed(true);
      if(retryCount.current>=2)return;
      const delay=[2500,10000][retryCount.current++];
      retryTimer=setTimeout(()=>{
        retryTimer=null;
        if(!cancelled&&navigator.onLine!==false&&document.visibilityState!=='hidden')setRetryKey(value=>value+1);
      },delay);
    };
    requestArtistPortrait(artist,controller.signal).then(data=>{
      if(cancelled)return;
      if(data?.thumbnail){retryCount.current=0;setFailed(false);setPortrait(data.thumbnail);}
      else failAndRetry();
    }).catch(()=>{if(!cancelled)failAndRetry();});
    return()=>{
      cancelled=true;controller.abort();
      if(retryTimer!==null)clearTimeout(retryTimer);
      window.removeEventListener('online',recover);
      document.removeEventListener('visibilitychange',recover);
    };
  },[visible,artist.name,artist.artistId,portrait,retryKey]);
  return <span ref={ref} aria-hidden="true" style={{display:'block',width:56,height:56,borderRadius:'50%',overflow:'hidden',boxShadow:active?`0 0 0 2.5px ${accent}`:'none'}}>
    {portrait?<CoverImg src={portrait} alt="" radius={999} size={128} style={{width:56,height:56}}/>:<span aria-label={failed?'Foto no disponible':'Cargando foto'} style={{width:56,height:56,display:'grid',placeItems:'center',background:'var(--surf-2)',color:active?accent:'var(--txt-2)',fontSize:failed?18:10,fontWeight:800}}>{failed?artist.name.split(/\s+/).slice(0,2).map(n=>n[0]).join(''):'···'}</span>}
  </span>;
}
