import {useEffect,useMemo,useState} from 'react';
import {api} from '../api.js';
import {genreArtists,artistIdentity} from '../feed/tasteProfile.js';

export function useOnboardingArtists(step,genres) {
  const initial=useMemo(()=>genreArtists(genres).slice(0,120),[genres]);
  const [artists,setArtists]=useState([]),[loading,setLoading]=useState(false);
  useEffect(()=>{
    if(step!==2)return;
    let cancelled=false;
    const base=initial;
    const controllers=new Set();
    setArtists(base);setLoading(true);
    // One result batch per genre; merge by name so IDs cannot duplicate seeds.
    const batches=genres.slice(0,10).map(()=>[]);
    const publish=()=>{
      const merged=new Map(base.map(a=>[a._key,a]));
      for(let i=0;i<16;i++)for(const group of batches){
        const a=group[i];if(!a)continue;
        const key=artistIdentity(a.name),prev=merged.get(key);
        merged.set(key,{...prev,...a,_key:key});
      }
      if(!cancelled)setArtists([...merged.values()].slice(0,120));
    };
    let cursor=0;
    const worker=async()=>{
      while(cursor<Math.min(genres.length,10)) {
        const index=cursor++;
        const controller=new AbortController();controllers.add(controller);
        const timer=setTimeout(()=>controller.abort(),8000);
        try {
          const data=await api.searchAll(genres[index].q.replace(/\b20\d\d\b/g,'').trim(),controller.signal);
          const known=new Set(base.map(a=>a._key));
          const named=(data.artists||[]).filter(a=>a?.name && a.artistId && !/\bhits\b|greatest|mejor m[uú]sica|audio library|mixing|rttwlr/i.test(a.name)).map(a=>({...a,genre:genres[index].label}));
          // Song uploaders are not necessarily recording artists. Use song
          // names only to enrich an already known editorial artist, never to
          // recommend compilation channels as artists.
          const matched=(data.songs||[]).filter(s=>s?.artist && known.has(artistIdentity(s.artist))).map(s=>({name:s.artist,artistId:s.artistId,thumbnail:null}));
          batches[index]=[...named,...matched];
          publish();
        } catch { /* editorial seeds remain selectable */ }
        finally{clearTimeout(timer);controllers.delete(controller);}
        if(cancelled)return;
      }
    };
    Promise.all([worker(),worker(),worker()]).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;controllers.forEach(c=>c.abort());};
  },[step,genres,initial]);
  return {artists:step===2&&!artists.length?initial:artists,loading};
}
