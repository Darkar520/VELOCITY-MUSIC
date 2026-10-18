/**
 * Inicio: preferences first, bounded work, progressive publication.
 * Download availability is not a listening preference.
 */
import {useEffect,useMemo,useRef} from 'react';
import {api,getToken} from '../api.js';
import {cacheIdentity} from '../favoriteOutbox.js';
import {dedupeByTitle,capPerArtist} from '../helpers.js';
import {SEED_ROWS} from '../constants.js';
import {trackById,normalizeTrack,cacheTrack} from '../catalog.js';
import {loadFeedCache,saveFeedCache} from '../feed/feedCache.js';
import {preferenceKey,starterQueries,genreArtists,artistIdentity} from '../feed/tasteProfile.js';
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
  const signature=useMemo(()=>JSON.stringify({
    account,preferences:preferenceKey(onboardPrefs),favs:lib.favs,recent:lib.recent,
    playlists:lib.playlists.map(p=>[p.id,p.trackIds]),saved:lib.savedPlaylists.map(p=>[p.playlistId,p.trackIds]),
    downloads:offline?[...downloads]:[],nonce:lib.feedNonce,offline,
  }),[account,onboardPrefs,lib.favs,lib.recent,lib.playlists,lib.savedPlaylists,downloads,recentSearches,lib.feedNonce,offline]);
  const previousProfile=useRef(null);
  useEffect(()=>{
    if(!authed)return;
    const store=useLibraryStore.getState();
    const profile=account+':home2:'+preferenceKey(onboardPrefs);
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
      store.setHomeRows(visible);store.setHomeLoading(false);
      if(!firstSaved){saveFeedCache(visible,profile);firstSaved=true;}
    };
    const add=(section,mix)=>{
      if(!alive()||!mix?.tracks?.length)return;
      const tracks=dedupeByTitle(mix.tracks).filter(t=>t?.id&&t.title).slice(0,60);
      if(!tracks.length)return;
      tracks.forEach(cacheTrack);
      let row=rows.find(s=>s.section===section);
      if(!row){row={section,mixes:[]};rows.push(row);}
      const existing=row.mixes.find(m=>m.label===mix.label);
      if(existing)existing.tracks=dedupeByTitle([...existing.tracks,...tracks]).slice(0,60);
      else row.mixes.push({...mix,tracks});
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
    if(!store.homeRows.length){
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
      }finally{
        clearTimeout(safety);
        if(alive()){store.setHomeLoading(false);if(rows.length)saveFeedCache(rows,profile);}
      }
    })();
    return ()=>{cancelled=true;clearTimeout(safety);controllers.forEach(c=>c.abort());};
  },[authed,signature]); // signature covers semantic values, not transient object identity
  useEffect(()=>{
    const refresh=()=>useLibraryStore.getState().setFeedNonce(useLibraryStore.getState().feedNonce+1);
    window.addEventListener('online',refresh);return()=>window.removeEventListener('online',refresh);
  },[]);
}
export default useHomeFeed;
