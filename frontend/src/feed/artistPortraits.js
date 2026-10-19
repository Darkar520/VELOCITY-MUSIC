import {api} from '../api.js';
import {artistIdentity} from './tasteProfile.js';
const KEY='velocity.artistPortraits.v1',TTL=7*86400000;
const cache=new Map();
let active=0;
const queue=[];
function drain(){
  while(active<3&&queue.length){
    const task=queue.shift();active++;
    task.run().then(task.resolve,()=>task.resolve(null)).finally(()=>{active--;drain();});
  }
}
function remember(key,value){
  cache.set(key,{...value,at:Date.now()});
  try{localStorage.setItem(KEY,JSON.stringify([...cache].slice(-160)));}catch{/* optional public metadata cache */}
}
export function getCachedPortrait(name){
  if(!cache.size){try{for(const [key,value] of JSON.parse(localStorage.getItem(KEY)||'[]'))cache.set(key,value);}catch{/* invalid optional cache */}}
  const found=cache.get(artistIdentity(name));
  return found?.thumbnail&&Date.now()-found.at<TTL?found:null;
}
export function requestArtistPortrait(artist,signal){
  const key=artistIdentity(artist.name),cached=getCachedPortrait(artist.name);
  if(cached)return Promise.resolve(cached);
  return new Promise(resolve=>{queue.push({resolve,run:async()=>{
    if(signal?.aborted)return null;
    const existing=getCachedPortrait(artist.name);if(existing)return existing;
    const controller=new AbortController();
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,8000);
    try{
      const data=await api.searchAll(artist.name,controller.signal);
      const candidates=(data.artists||[]).filter(a=>artistIdentity(a.name)===key);
      const match=candidates.find(a=>a.artistId===artist.artistId)||candidates[0];
      let portrait=match;
      const id=match?.artistId||artist.artistId;
      if(!portrait?.thumbnail&&id){
        const profile=await api.artist(id,controller.signal);
        if(artistIdentity(profile.name)===key)portrait=profile;
      }
      if(controller.signal.aborted||!portrait?.thumbnail)return null;
      const result={name:artist.name,artistId:portrait.artistId||id,thumbnail:portrait.thumbnail};
      remember(key,result);return result;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }});drain();});
}
