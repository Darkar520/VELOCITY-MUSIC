/**
 * Inicio: preferences first, bounded work, progressive publication.
 * Download availability is not a listening preference.
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import {api,getToken} from '../api.js';
import {cacheIdentity} from '../favoriteOutbox.js';
import {dedupeByTitle,capPerArtist} from '../helpers.js';
import {SEED_ROWS} from '../constants.js';
import {trackById,normalizeTrack,cacheTrack} from '../catalog.js';
import {loadFeedCache,saveFeedCache} from '../feed/feedCache.js';
import {readFeedMixCycle} from '../feed/feedCycle.js';
import {preferenceKey,starterQueries,genreArtists,artistIdentity} from '../feed/tasteProfile.js';
import {balancedMix,contextualPool,deepRecommendationRows,MIX_TARGET} from '../feed/deepMixes.js';
import {offlineMixes,favArtistMixes,recentSliceMixes} from '../feed/mixBuilders.js';
import {useLibraryStore} from '../store/libraryStore.js';
import {usePlayerStore} from '../store/playerStore.js';

async function pool(items,limit,fn){
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(items.length,limit)},async()=>{
    while(cursor<items.length){const item=items[cursor++];try{await fn(item);}catch{/* isolate a failed collection */}}
  }));
}
export function useHomeFeed({authed,downloaded,recentSearches=[],onboardPrefs,offline=false}){
  const account=cacheIdentity(localStorage.getItem('velocity.email')||'',getToken());
  const lib=useLibraryStore(s=>s);
  const storedDownloads=usePlayerStore(s=>s.downloaded);
  const downloads=downloaded||storedDownloads;
  const hasExplicitTaste=starterQueries(onboardPrefs).length>0;
  const baseProfile=account+':home5:'+preferenceKey(onboardPrefs);
  const [rotation,setRotation]=useState(()=>({profile:baseProfile,...readFeedMixCycle(baseProfile)}));
  const mixCycle=rotation.profile===baseProfile?rotation.cycle:readFeedMixCycle(baseProfile).cycle;
  useEffect(()=>{
    const current=readFeedMixCycle(baseProfile);
    if(rotation.profile!==baseProfile||rotation.cycle!==current.cycle)setRotation({profile:baseProfile,...current});
    const timer=setTimeout(()=>setRotation({profile:baseProfile,...readFeedMixCycle(baseProfile)}),Math.max(1,current.nextAt-Date.now()+25));
    return()=>clearTimeout(timer);
  },[baseProfile,mixCycle]);
  const signature=useMemo(()=>JSON.stringify({
    account,preferences:preferenceKey(onboardPrefs),favs:hasExplicitTaste?null:lib.favs,recent:hasExplicitTaste?null:lib.recent,
    playlists:lib.playlists.map(p=>[p.id,p.trackIds]),saved:lib.savedPlaylists.map(p=>[p.playlistId,p.trackIds]),
    downloads:offline?[...downloads]:[],nonce:lib.feedNonce,offline,mixCycle,
  }),[account,onboardPrefs,hasExplicitTaste,lib.favs,lib.recent,lib.playlists,lib.savedPlaylists,downloads,recentSearches,lib.feedNonce,offline,mixCycle]);
  const previousProfile=useRef(null);
  useEffect(()=>{
    if(!authed)return;
    const store=useLibraryStore.getState();
    const profile=baseProfile+':cycle:'+mixCycle;
    const savedExtra=(loadFeedCache(profile)||[]).filter(s=>/^Más por descubrir \d+$/.test(s.section));
    if(previousProfile.current!==null && previousProfile.current!==profile)store.setHomeRows([]);
    previousProfile.current=profile;
    let cancelled=false,firstSaved=false;
    const requests=new Map(),controllers=new Set(),rows=[];
    const alive=()=>!cancelled;
    const localOnly=offline||navigator.onLine===false;
    const prefs=Array.isArray(onboardPrefs)?onboardPrefs:onboardPrefs?.genres||[];
    const artists=onboardPrefs?.artists||[];
    const allowed=new Set([...genreArtists(prefs).map(a=>a._key),...artists.map(a=>artistIdentity(a.name))]);
    const publish=()=>{
      if(!alive())return;
      const visible=rows.filter(s=>s.mixes.length).map(s=>({...s,mixes:s.mixes.map(m=>({...m,tracks:[...m.tracks]}))}));
      if(!visible.length)return;
      store.setHomeRows(visible);
      if(visible.some(row=>row.mixes.some(m=>!m.pending)))store.setHomeLoading(false);
      if(!firstSaved){saveFeedCache(visible,profile);firstSaved=true;}
    };
    const add=(section,mix)=>{
      if(!alive()||!mix?.tracks?.length)return;
      const tracks=dedupeByTitle(mix.tracks).filter(t=>t?.id&&t.title).slice(0,200);
      if(!tracks.length)return;
      tracks.forEach(cacheTrack);
      let row=rows.find(s=>s.section===section);
      if(!row){row={section,mixes:[]};rows.push(row);}
      const existing=row.mixes.find(m=>m.label===mix.label);
      if(existing)existing.tracks=dedupeByTitle([...existing.tracks,...tracks]).slice(0,200);
      else row.mixes.push({...mix,tracks,pending:!['Tus playlists','Escuchado recientemente','De tus Me gusta','Listas para offline'].includes(section)});
      publish();
    };
    const request=(key,fn)=>{
      if(requests.has(key))return requests.get(key);
      const controller=new AbortController();controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),10000);
      const work=Promise.resolve().then(()=>alive()?fn(controller.signal):[]).catch(()=>[]).finally(()=>{
        clearTimeout(timer);controllers.delete(controller);
      });
      requests.set(key,work);return work;
    };
    const search=q=>request('search:'+q,signal=>api.search(q,signal));
    const knownArtist=(track,name)=>{
      const key=artistIdentity(track.artist);
      return key===artistIdentity(name) || String(track.artist||'').split(/,| feat\.? | featuring | & /i).some(a=>artistIdentity(a)===artistIdentity(name));
    };
    store.setHomeLoading(true);
    if(!store.homeRows.length && !store.feedNonce){
      const cached=loadFeedCache(profile);
      if(cached){for(const row of cached)for(const m of row.mixes)for(const t of m.tracks)cacheTrack(t);store.setHomeRows(cached);store.setHomeLoading(false);}
    }
    // Local collections are real user actions, never synthetic history.
    const recent=recentSliceMixes(store.recent);
    recent.forEach(m=>add('Escuchado recientemente',m));
    favArtistMixes(store.favs).forEach(m=>add('De tus Me gusta',m));
    for(const p of [...store.playlists,...store.savedPlaylists].slice(0,8)){
      const tracks=(p.trackIds||[]).map(trackById).filter(Boolean);
      if(tracks.length)add('Tus playlists',{label:p.name||'Tu playlist',tracks});
    }
    if(localOnly)offlineMixes([...downloads]).forEach(m=>add('Listas para offline',m));
    const safety=setTimeout(()=>{if(alive())store.setHomeLoading(false);},30000);
    (async()=>{
      try{
        if(localOnly)return;
        let queries=starterQueries(onboardPrefs);
        const hasHistory=store.recent.length||store.favs.length||store.playlists.some(p=>p.trackIds?.length);
        if(!queries.length&&hasHistory){
          const names=[...new Set([...store.recent,...store.favs].map(trackById).filter(Boolean).map(t=>t.artist))].slice(0,6);
          queries=names.map(name=>({label:name,q:name,kind:'artist'}));
        }
        if(!queries.length&&onboardPrefs!==null){
          queries=SEED_ROWS.slice(0,4).map(g=>({label:g.label,q:g.q,kind:'genre'}));
        }
        await pool(queries,3,async query=>{
          if(!alive())return;
          let tracks=(await search(query.q)).map(normalizeTrack);
          const name=query.artist || (query.kind==='artist'?query.q:null);
          if(name)tracks=tracks.filter(t=>knownArtist(t,name));
          tracks=capPerArtist(dedupeByTitle(tracks),query.kind==='genre'?20:60);
          const section=query.kind==='artist'?'Tus artistas, desde el primer día':'El sonido que elegiste';
          add(section,{label:query.label,tracks,reason:query.kind==='artist'?'Artista que elegiste':'Por tus géneros'});
        });
        // A genre needs many recording artists; three seed searches can only
        // produce a long playlist made of repeated blocks from those artists.
        const genreGroups=prefs.map(g=>genreArtists([g]).slice(0,10).map(a=>({...a,label:g.label})));
        const genreSeeds=[];
        for(let i=0;i<10;i++)for(const group of genreGroups)if(group[i])genreSeeds.push(group[i]);
        const extraSeeds=genreSeeds.filter(a=>!queries.some(q=>artistIdentity(q.q)===a._key)).slice(0,40);
        await pool(extraSeeds,4,async a=>{
          if(!alive())return;
          const tracks=capPerArtist(dedupeByTitle((await search(a.name)).map(normalizeTrack).filter(t=>knownArtist(t,a.name))),10);
          if(tracks.length)add('El sonido que elegiste',{label:a.label,tracks,reason:'Por tus géneros'});
        });
        // Separate discovery within the selected genres; do not derive tastes
        // from unrelated files that happen to be downloaded on the device.
        const discoveries=genreArtists(prefs).filter(a=>!queries.some(q=>artistIdentity(q.q)===a._key));
        const usedGenres=new Set(),chosen=[];
        for(const a of discoveries){if(!usedGenres.has(a.genre)){usedGenres.add(a.genre);chosen.push(a);}}
        await pool(chosen.slice(0,6),3,async a=>{
          if(!alive())return;
          const tracks=(await search(a.name)).map(normalizeTrack).filter(t=>knownArtist(t,a.name));
          add('Sigue descubriendo',{label:a.name,tracks,reason:'Más de '+a.genre});
        });
        // A few radio continuations from genuine listening history only.
        const seeds=[...new Set([...store.recent,...store.favs])].map(trackById).filter(Boolean).slice(0,3);
        await pool(seeds,2,async seed=>{
          if(!alive())return;
          const raw=await request('radio:'+seed.id,signal=>api.radio(seed.id,50,signal));
          const tracks=capPerArtist(dedupeByTitle(raw.map(normalizeTrack)),4).filter(t=>!allowed.size||allowed.has(artistIdentity(t.artist)));
          if(tracks.length>=3)add('A partir de lo que escuchas',{label:'Como '+seed.artist,tracks});
        });
        if(alive()){
          const catalog=dedupeByTitle(rows.filter(s=>!['Tus playlists','Escuchado recientemente','De tus Me gusta'].includes(s.section)).flatMap(s=>s.mixes).flatMap(m=>m.tracks));
          const familiarTracks=[...store.recent.slice(0,10),...store.favs.slice(0,10)].map(trackById).filter(Boolean);
          const expanded=deepRecommendationRows(catalog,onboardPrefs,store.feedNonce+mixCycle,{familiarTracks});
          const local=rows.filter(s=>['Tus playlists','Escuchado recientemente','De tus Me gusta'].includes(s.section));
          rows.splice(0,rows.length,...local,...expanded,...savedExtra);
          if(rows.length)publish();else store.setHomeRows([]);
        }
      }finally{
        clearTimeout(safety);
        if(alive()){store.setHomeLoading(false);if(rows.length)saveFeedCache(rows,profile);}
      }
    })();
    return ()=>{cancelled=true;clearTimeout(safety);controllers.forEach(c=>c.abort());};
  },[authed,signature,baseProfile,mixCycle]); // signature covers semantic values, not transient object identity
  useEffect(()=>{
    const refresh=()=>useLibraryStore.getState().setFeedNonce(useLibraryStore.getState().feedNonce+1);
    window.addEventListener('online',refresh);return()=>window.removeEventListener('online',refresh);
  },[]);
  useEffect(()=>{
    if(!authed||offline)return;
    const genres=Array.isArray(onboardPrefs)?onboardPrefs:onboardPrefs?.genres||[];
    const initialNames=new Set(starterQueries(onboardPrefs).map(q=>artistIdentity(q.q)));
    const later=genres.flatMap(g=>genreArtists([g]).slice(10).filter(a=>!initialNames.has(a._key)).map(a=>({...a,genre:g.label})));
    const savedPages=useLibraryStore.getState().homeRows.reduce((max,row)=>{
      const match=/^Más por descubrir (\d+)$/.exec(row.section);
      return match?Math.max(max,Number(match[1])):max;
    },0);
    let cursor=Math.min(later.length,savedPages*12),page=savedPages,busy=false,disposed=false;
    const controllers=new Set();
    const loadMore=async()=>{
      if(busy||disposed)return;
      busy=true;
      let added=false;
      const batch=later.slice(cursor,cursor+12);cursor+=batch.length;
      const fresh=[];
      await pool(batch,4,async artist=>{
        const controller=new AbortController();controllers.add(controller);
        try{
          const result=await api.search(artist.name,controller.signal);
          const key=artistIdentity(artist.name);
          const tracks=dedupeByTitle(result.map(normalizeTrack).filter(t=>artistIdentity(t.artist)===key)).slice(0,10);
          fresh.push(...tracks);
        }catch{/* partial catalog failure */}finally{controllers.delete(controller);}
      });
      const current=useLibraryStore.getState().homeRows;
      const radioPool=dedupeByTitle(current.filter(r=>r.section==='El sonido que elegiste').flatMap(r=>r.mixes).flatMap(m=>m.tracks));
      if(!disposed&&fresh.length<80&&radioPool.length){
        const seeds=Array.from({length:4},(_,i)=>radioPool[(page*17+i*Math.max(1,Math.floor(radioPool.length/4)))%radioPool.length]);
        await pool(seeds,2,async seed=>{
          const controller=new AbortController();controllers.add(controller);
          try{fresh.push(...(await api.radio(seed.id,50,controller.signal)).map(normalizeTrack).filter(t=>t?.id&&t.title));}
          catch{/* a failed radio source does not erase search results */}
          finally{controllers.delete(controller);}
        });
      }
      page++;
      if(!disposed&&fresh.length){
        const existing=new Set(current.flatMap(r=>r.mixes).flatMap(m=>m.tracks).map(t=>t.id));
        const novel=dedupeByTitle(fresh).filter(t=>!existing.has(t.id));
        const catalog=dedupeByTitle([...novel,...current.flatMap(r=>r.mixes).flatMap(m=>m.tracks)]);
        const names=[...new Set([...novel,...catalog].map(t=>t.artist))];
        const novelIds=new Set(novel.map(t=>t.id));
        const mixes=[];
        for(const [i,name] of names.entries()){
          if(mixes.length===10)break;
          const qualified=contextualPool(catalog,name,onboardPrefs);
          for(let attempt=0;attempt<20;attempt++){
            const tracks=balancedMix(qualified,name,i+cursor+attempt);
            if(tracks.length===MIX_TARGET&&tracks.filter(t=>novelIds.has(t.id)).length>=5){
              mixes.push({label:'Descubre '+name,tracks});break;
            }
          }
        }
        if(mixes.length>=8){
          mixes.flatMap(m=>m.tracks).forEach(cacheTrack);
          const sectionNo=current.filter(r=>/^Más por descubrir \d+$/.test(r.section)).length+1;
          const next=[...current,{section:'Más por descubrir '+sectionNo,mixes}];
          useLibraryStore.getState().setHomeRows(next);
          if(current.length<8)saveFeedCache(next,baseProfile+':cycle:'+mixCycle);
          added=true;
        }
      }
      busy=false;
      if(!disposed)window.dispatchEvent(new CustomEvent('velocity:feed-more-result',{detail:{added}}));
    };
    window.addEventListener('velocity:feed-more',loadMore);
    return()=>{disposed=true;controllers.forEach(c=>c.abort());window.removeEventListener('velocity:feed-more',loadMore);};
  },[authed,account,preferenceKey(onboardPrefs),offline,mixCycle]);
}
export default useHomeFeed;
