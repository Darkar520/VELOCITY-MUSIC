import {useEffect, useMemo, useRef, useState} from 'react';
import {api} from '../api.js';
import {cacheTrack, normalizeTrack, trackById} from '../catalog.js';
import {preferenceKey} from '../feed/tasteProfile.js';
import {personalizedShelves, recentQueries} from '../feed/personalizedShelves.js';

export function usePersonalizedShelves({rows, prefs, recent, favs, searches, account, loading, offline}) {
  const queryKey = JSON.stringify(recentQueries(searches));
  const key = JSON.stringify([account, preferenceKey(prefs), queryKey]);
  const snapshot = useRef(null);
  const [remote, setRemote] = useState({key: null, results: {}});
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
    for (const query of queries) {
      const controller = new AbortController();
      controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), 10000);
      timers.push(timer);
      api.search(query, controller.signal).then(raw => {
        if (disposed) return;
        const tracks = raw.filter(t => t?.id && t.title && t.artist).map(normalizeTrack);
        tracks.forEach(cacheTrack);
        setRemote(previous => ({key, results: {...(previous.key === key ? previous.results : {}), [query]: tracks}}));
      }).catch(() => { /* local, relevant catalog matches remain available */ })
        .finally(() => clearTimeout(timer));
    }
    return () => { disposed = true; timers.forEach(clearTimeout); controllers.forEach(c => c.abort()); };
  }, [key, queryKey, loading, offline]);
  const pool = useMemo(() => rows.flatMap(r => r.mixes || []).flatMap(m => m.tracks || []), [rows]);
  const context = snapshot.current?.key === key ? snapshot.current : null;
  return useMemo(() => personalizedShelves({
    pool, prefs, searches: JSON.parse(queryKey), recentTracks: context?.recent || [],
    favoriteIds: context?.favs || [], searchResults: remote.key === key ? remote.results : {},
  }), [pool, prefs, queryKey, context, remote, key]);
}
