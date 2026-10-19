import {useEffect, useMemo, useRef, useState} from 'react';
import {api} from '../api.js';
import {cacheTrack, normalizeTrack, trackById} from '../catalog.js';
import {preferenceKey} from '../feed/tasteProfile.js';
import {personalizedShelves, recentQueries} from '../feed/personalizedShelves.js';
import {buildSeedMix, selectSearchSeed, rememberedSearchSeed, MIX_MIN} from '../feed/seededMix.js';

export function usePersonalizedShelves({rows, prefs, recent, favs, searches, account, loading, offline}) {
  const queryKey = JSON.stringify(recentQueries(searches));
  const key = JSON.stringify([account, preferenceKey(prefs), queryKey]);
  const snapshot = useRef(null);
  const [remote, setRemote] = useState({key: null, results: {}});
  const [retry, setRetry] = useState(0);
  const pool = useMemo(() => rows.flatMap(r => r.mixes || []).flatMap(m => m.tracks || []), [rows]);
  const poolRef = useRef(pool);
  poolRef.current = pool;
  useEffect(()=>{const again=()=>setRetry(n=>n+1);window.addEventListener('velocity:retry-personal-mixes',again);return()=>window.removeEventListener('velocity:retry-personal-mixes',again);},[]);
  // A playback/heart action must not reshuffle the page beneath the finger.
  // A new home visit, search context or preference profile takes a new snapshot.
  if ((!snapshot.current || snapshot.current.key !== key) && !loading && rows.length) {
    snapshot.current = {key, recent: recent.map(trackById).filter(Boolean), favs: [...favs]};
  }
  useEffect(() => {
    if (loading || offline) return;
    const queries = JSON.parse(queryKey);
    if (!queries.length) return;
    const controllers = [];
    const timers = [];
    let disposed = false;
    let cursor = 0;
    const normalize = raw => (raw || []).filter(t=>t?.id&&t.title&&t.artist).map(normalizeTrack);
    const publish = (query, result) => { if(!disposed)setRemote(previous=>({key,results:{...(previous.key===key?previous.results:{}),[query]:result}})); };
    const run = async query => {
      const controller = new AbortController();
      controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), 45000);
      timers.push(timer);
      try {
        const explicit = rememberedSearchSeed(query, account);
        let candidates = [];
        if (!explicit) candidates = normalize(await api.search(query, controller.signal));
        if(disposed||controller.signal.aborted)return;
        const resolved = selectSearchSeed(query,[...candidates,...poolRef.current],{explicit,prefs,recentTracks:snapshot.current?.key===key?snapshot.current.recent:[]});
        const seed = resolved ? normalizeTrack(resolved) : null;
        if(!seed){publish(query,{error:true});return;}
        const selection = await buildSeedMix(seed,{
          pool:poolRef.current,prefs,signal:controller.signal,
          radio:(...args)=>api.radio(...args).then(normalize),
          artist:(...args)=>api.artist(...args).then(d=>({...d,topSongs:normalize(d.topSongs)})),
          search:(...args)=>api.search(...args).then(normalize),
        });
        if(disposed||controller.signal.aborted)return;
        selection.tracks.forEach(cacheTrack);
        publish(query,selection.tracks.length===MIX_MIN?selection:{error:true,seed});
      } catch { if(!disposed)publish(query,{error:true}); }
      finally { clearTimeout(timer); }
    };
    Promise.all(Array.from({length:Math.min(2,queries.length)},async()=>{while(!disposed&&cursor<queries.length)await run(queries[cursor++]);}));
    return () => { disposed = true; timers.forEach(clearTimeout); controllers.forEach(c => c.abort()); };
  }, [key, queryKey, loading, offline, retry]);
  const context = snapshot.current?.key === key ? snapshot.current : null;
  return useMemo(() => personalizedShelves({
    pool, prefs, searches: JSON.parse(queryKey), recentTracks: context?.recent || [],
    favoriteIds: context?.favs || [], searchResults: remote.key === key ? remote.results : offline ? Object.fromEntries(JSON.parse(queryKey).map(q=>[q,{error:true}])) : {},
  }), [pool, prefs, queryKey, context, remote, key, offline]);
}
