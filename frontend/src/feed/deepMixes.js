import {artistIdentity,genreArtists} from './tasteProfile.js';
export const MIX_TARGET=50;
const hash=value=>{let h=2166136261;for(const char of String(value)){h=Math.imul(h^char.charCodeAt(0),16777619);}return h>>>0;};
const gcd=(a,b)=>b?gcd(b,a%b):a;
const ALTERNATE_RECORDING_RE=/\b(?:live|en\s+vivo|en\s+directo|remix(?:ed)?|remaster(?:ed)?|acoustic|ac[uú]stic|unplugged|session|sped[\s-]?up|slowed(?:\s+down)?|karaoke|instrumental|demo|bootleg|unreleased|rare|rarity|alternate\s+take|alt\s+take|b[\s-]?side|radio\s+edit|deluxe\s+edition|bonus\s+track)\b/i;
const recordingBaseTitle=title=>{
  const value=String(title||'').trim();
  const bracket=/^(.*?)(?:\s*[([]([^\])]+)[)\]])$/.exec(value);
  if(bracket&&ALTERNATE_RECORDING_RE.test(bracket[2]))return bracket[1].trim();
  const suffix=/^(.*)\s+[-–—:|]\s+(.+)$/.exec(value);
  if(suffix&&ALTERNATE_RECORDING_RE.test(suffix[2]))return suffix[1].trim();
  return value;
};
const isAlternateRecording=track=>ALTERNATE_RECORDING_RE.test(String(track?.title||''));
function uniqueRecommendationTracks(pool){
  const best=new Map();
  for(const track of pool||[]){
    if(!track?.id||!track.title||!track.artist)continue;
    const key=artistIdentity(track.artist)+'|'+recordingBaseTitle(track.title).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
    const score=(isAlternateRecording(track)?-100:0)+(track.albumId?20:0)+(track.album&&track.album!=='Sencillo'?5:0);
    const current=best.get(key);
    if(!current||score>current.score)best.set(key,{track,score});
  }
  return [...best.values()].map(entry=>entry.track);
}
export function contextualPool(pool,seed,prefs){
  const genres=Array.isArray(prefs)?prefs:prefs?.genres||[];
  const key=artistIdentity(seed);
  const contexts=genres.filter(g=>genreArtists([g]).some(a=>a._key===key));
  const allowed=new Set(genreArtists(contexts).map(a=>a._key));
  allowed.add(key);
  return pool.filter(t=>allowed.has(artistIdentity(t.artist)));
}
export function balancedMix(pool,seed,variant=0,preferredIds=new Set()){
  const unique=uniqueRecommendationTracks(pool);
  const groups=new Map();
  const preferredSet=preferredIds instanceof Set?preferredIds:new Set(preferredIds||[]);
  for(const track of unique){const key=artistIdentity(track.artist);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(track);}
  for(const tracks of groups.values())tracks.sort((a,b)=>Number(preferredSet.has(b.id))-Number(preferredSet.has(a.id)));
  const keys=[...groups.keys()];
  const preferred=artistIdentity(seed);
  const start=keys.indexOf(preferred);
  if(start>0){keys.splice(start,1);keys.unshift(preferred);}
  if(keys.length>1){const offset=variant%keys.length;keys.push(...keys.splice(0,offset));}
  const out=[];
  const cap=5;
  const offsets=new Map(keys.map(key=>[key,groups.get(key).some(track=>preferredSet.has(track.id))?0:hash(key+':'+variant)%groups.get(key).length]));
  const strides=new Map(keys.map(key=>{
    const length=groups.get(key).length;
    let stride=Math.min(7,length-1);
    while(stride>1&&gcd(stride,length)!==1)stride--;
    return [key,Math.max(1,stride)];
  }));
  for(let round=0;round<cap&&out.length<MIX_TARGET;round++){
    for(const key of keys){
      const tracks=groups.get(key);
      const track=tracks[(offsets.get(key)+round*strides.get(key))%tracks.length];
      if(track&&!out.some(t=>t.id===track.id))out.push(track);
      if(out.length===MIX_TARGET)break;
    }
  }
  if(out.some((t,i)=>i>0&&artistIdentity(t.artist)===artistIdentity(out[i-1].artist))){
    const remaining=new Map();
    for(const track of out){const key=artistIdentity(track.artist);if(!remaining.has(key))remaining.set(key,[]);remaining.get(key).push(track);}
    const ordered=[];
    while(ordered.length<out.length){
      const last=artistIdentity(ordered.at(-1)?.artist);
      const candidates=[...remaining].filter(([key,tracks])=>key!==last&&tracks.length).sort((a,b)=>b[1].length-a[1].length);
      if(!candidates.length)break;
      ordered.push(candidates[0][1].shift());
    }
    if(ordered.length===out.length)return ordered;
  }
  return out;
}
export function deepRecommendationRows(pool,prefs,variant=0,{familiarTracks=[]}={}){
  const genres=Array.isArray(prefs)?prefs:prefs?.genres||[];
  const selected=(prefs?.artists||[]).map(a=>a.name);
  const known=[...new Set(pool.map(t=>t.artist).filter(Boolean))];
  const names=[...new Set([...selected,...known])].filter(name=>pool.some(t=>artistIdentity(t.artist)===artistIdentity(name)));
  const used=[];
  const build=(list,prefix,offset)=>{
    const mixes=[];
    for(const [i,name] of list.entries()){
      if(mixes.length===10)break;
      for(let attempt=0;attempt<20;attempt++){
        const tracks=balancedMix(contextualPool(pool,name,prefs),name,variant+i+offset+attempt*7);
        if(tracks.length!==MIX_TARGET)continue;
        const ids=new Set(tracks.map(t=>t.id));
        if(used.some(other=>[...ids].filter(id=>other.has(id)).length>30))continue;
        mixes.push({label:prefix+name,tracks});used.push(ids);break;
      }
    }
    return mixes;
  };
  const rows=[];
  const familiarCatalog=uniqueRecommendationTracks(familiarTracks);
  const featuredPool=uniqueRecommendationTracks([...familiarCatalog,...pool]);
  const familiarIds=new Set(familiarCatalog.map(t=>t.id));
  const featured=balancedMix(featuredPool,selected[0]||names[0],variant,familiarIds);
  if(featured.length===MIX_TARGET)rows.push({section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks:featured}]});
  const artistMixes=build(names,'Con ',0);
  if(artistMixes.length)rows.push({section:'Tus artistas y nuevas conexiones',mixes:artistMixes});
  const discoveryNames=[...names.filter(n=>!selected.includes(n)),...selected];
  const discovery=build(discoveryNames,'Más allá de ',13);
  if(discovery.length)rows.push({section:'Sigue descubriendo',mixes:discovery});
  const genreMixes=genres.map(g=>{
    const allowed=new Set(genreArtists([g]).map(a=>a._key));
    const tracks=pool.filter(t=>allowed.has(artistIdentity(t.artist)));
    return {label:g.label,tracks:balancedMix(tracks,tracks[0]?.artist,variant)};
  }).filter(m=>m.tracks.length===MIX_TARGET);
  if(genreMixes.length)rows.push({section:'El sonido que elegiste',mixes:genreMixes});
  return rows;
}
