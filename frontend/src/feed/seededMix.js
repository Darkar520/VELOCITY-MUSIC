import {artistIdentity, genreArtists} from './tasteProfile.js';

export const MIX_MIN = 50;
export const titleKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s*[([][^]*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const uniqueSongs = tracks => {
  const ids = new Set(), titles = new Set();
  return (tracks || []).filter(t => {
    if (!t?.id || !t.title || !t.artist) return false;
    const key = titleKey(t.title);
    if (ids.has(t.id) || titles.has(key)) return false;
    ids.add(t.id); titles.add(key); return true;
  });
};
export function genreContext(seed, prefs) {
  const genres = Array.isArray(prefs) ? prefs : prefs?.genres || [];
  return new Set(genres.filter(g => genreArtists([g]).some(a => a._key === artistIdentity(seed.artist)))
    .flatMap(g => genreArtists([g]).map(a => a._key)));
}
export function selectSearchSeed(query, results, {recentTracks = [], prefs, explicit} = {}) {
  if (explicit?.id && explicit.title && explicit.artist) return explicit;
  const q = titleKey(query), terms = q.split(' ').filter(Boolean);
  if (!terms.length) return null;
  const preferred = new Set((prefs?.artists || []).map(a => artistIdentity(a.name)));
  const ranked = (results || []).filter(t => t?.id && t.title && t.artist).map((t, index) => {
    const title = titleKey(t.title), artist = titleKey(t.artist);
    const text = `${title} ${artist}`;
    const coverage = terms.filter(term => text.split(' ').includes(term)).length / terms.length;
    const exactTitle = title === q;
    const artistQuery = artist === q;
    const remembered = recentTracks.some(r => titleKey(r.title) === title && artistIdentity(r.artist) === artistIdentity(t.artist));
    return {track:t, index, score:coverage*100 + (exactTitle?100:0) + (artistQuery?40:0) + (remembered?70:0) + (preferred.has(artistIdentity(t.artist))?30:0), eligible:coverage>=0.75};
  }).filter(t => t.eligible).sort((a,b) => b.score-a.score || a.index-b.index);
  return ranked[0]?.track || null;
}

// Round-robin is not a musical relationship. Callers must qualify the pool
// first, through the exact artist, selected genre roster or seed radio graph.
export function fullSelection(tracks, first = null) {
  const clean = uniqueSongs([...(first ? [first] : []), ...(tracks || [])]);
  const groups = new Map();
  for (const t of clean.filter(t => t.id !== first?.id)) {
    const key = artistIdentity(t.artist);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = first ? [first] : [];
  while (out.length < MIX_MIN && [...groups.values()].some(g => g.length)) {
    for (const group of groups.values()) { if (group.length) out.push(group.shift()); if (out.length === MIX_MIN) break; }
  }
  return out.length === MIX_MIN ? out : [];
}

export function composeSeedMix(seed, {radioTracks = [], pool = [], prefs} = {}) {
  if (!seed?.id) return [];
  const key = artistIdentity(seed.artist), song = titleKey(seed.title);
  const related = new Set(radioTracks.map(t => artistIdentity(t.artist)));
  const genre = genreContext(seed, prefs);
  const eligible = t => t?.id && (t.id === seed.id || (titleKey(t.title) !== song && artistIdentity(t.artist) !== artistIdentity(seed.title)));
  const local = pool.filter(t => artistIdentity(t.artist) === key || related.has(artistIdentity(t.artist)) || genre.has(artistIdentity(t.artist)));
  const radio = radioTracks.filter(eligible);
  // Preserve actual radio ordering ahead of broader genre-based completion.
  const primary = uniqueSongs([seed, ...radio]);
  if (primary.length >= MIX_MIN) return primary.slice(0, MIX_MIN);
  return fullSelection([...radio, ...local.filter(eligible)], seed);
}

export async function buildSeedMix(seed, {pool = [], prefs, radio, artist, search, signal}) {
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('cancelled'), {name:'AbortError'}); };
  check();
  let radioTracks = [];
  try { radioTracks = await radio(seed.id, 100, signal); } catch (e) { check(); }
  check();
  let tracks = composeSeedMix(seed, {radioTracks, pool, prefs});
  if (tracks.length === MIX_MIN) return {seed, tracks};
  let own = [];
  try {
    if (seed.artistId && artist) own = (await artist(seed.artistId, signal))?.topSongs || [];
  } catch (e) { check(); }
  if (own.length < MIX_MIN && search) {
    try { own.push(...await search(seed.artist, signal)); } catch (e) { check(); }
  }
  check();
  own = own.filter(t => artistIdentity(t.artist) === artistIdentity(seed.artist));
  tracks = composeSeedMix(seed, {radioTracks, pool:[...pool, ...own], prefs});
  // Expand only from an artist reached by this seed's radio, never from
  // another title-matching search result. Bounded to two additional radios.
  const visited = new Set([artistIdentity(seed.artist)]);
  const neighbors = uniqueSongs(radioTracks).filter(t => {
    const key=artistIdentity(t.artist);
    if(visited.has(key)||key===artistIdentity(seed.title)||titleKey(t.title)===titleKey(seed.title))return false;
    visited.add(key);return true;
  }).slice(0,2);
  if (!tracks.length) for (const neighbor of neighbors) {
    try { radioTracks.push(...await radio(neighbor.id, 100, signal)); } catch (e) { check(); }
    check();
    tracks = composeSeedMix(seed, {radioTracks, pool:[...pool,...own], prefs});
    if (tracks.length) break;
  }
  return {seed, tracks};
}

export function rememberSearchSeed(query, track, account) {
  if (!query?.trim() || !track?.id) return;
  try {
    const key = 'velocity.searchSeeds.' + account;
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    const identity = titleKey(query);
    delete saved[identity];
    const entries = [...Object.entries(saved), [identity, {id:track.id,title:track.title,artist:track.artist,artistId:track.artistId,album:track.album,albumId:track.albumId,source:track.source,durationSeconds:track.durationSeconds,cover:track.cover}]].slice(-8);
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* search remains usable when storage is unavailable */ }
}
export function rememberedSearchSeed(query, account) {
  try { return JSON.parse(localStorage.getItem('velocity.searchSeeds.'+account) || '{}')[titleKey(query)] || null; }
  catch { return null; }
}
