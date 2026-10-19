import {artistIdentity, genreArtists} from './tasteProfile.js';
import {balancedMix} from './deepMixes.js';
import {dedupeByTitle} from '../helpers.js';
import {MIX_MIN, fullSelection} from './seededMix.js';

export const recentQueries = searches => [...new Map((searches || [])
  .filter(q => typeof q === 'string' && q.trim().length >= 2)
  .map(q => [q.trim().toLocaleLowerCase(), q.trim()])).values()].slice(0, 3);
const usable = tracks => [...new Map(dedupeByTitle((tracks || []).filter(t => t?.id && t.title && t.artist)).map(t => [t.id, t])).values()];

// Reasons describe observable actions or shared selected labels. These are
// editorial connections, not inferred acoustic similarity or listening events.
export function personalizedShelves({pool = [], prefs, recentTracks = [], favoriteIds = [], searches = [], searchResults = {}}) {
  const catalog = usable(pool);
  const genres = Array.isArray(prefs) ? prefs : prefs?.genres || [];
  const selected = prefs?.artists || [];
  const curiosity = [], connections = [];
  const seen = new Set(recentTracks.map(t => t.id));
  const favoriteArtists = new Set(catalog.filter(t => favoriteIds.includes(t.id)).map(t => artistIdentity(t.artist)));
  const selectedKeys = new Set(selected.map(a => artistIdentity(a.name)));
  const rank = t => favoriteArtists.has(artistIdentity(t.artist)) ? 0 : selectedKeys.has(artistIdentity(t.artist)) ? 1 : 2;
  const ranked = [...catalog].sort((a, b) => Number(seen.has(a.id))-Number(seen.has(b.id)) || rank(a) - rank(b));
  const make = (id, label, reason, tracks, tag) => ({id, label, reason, tag, tracks: usable(tracks).slice(0, 50)});

  for (const query of recentQueries(searches)) {
    const selection = searchResults[query];
    if (selection?.tracks?.length === MIX_MIN && selection.seed?.id && selection.tracks[0].id === selection.seed.id) {
      curiosity.push({...make('search:' + query, query, `Desde «${selection.seed.title}» · ${selection.seed.artist}`, selection.tracks, 'TU BÚSQUEDA'),seedId:selection.seed.id,seedArtist:selection.seed.artist});
    } else curiosity.push({id:'search:'+query,label:query,tag:'TU BÚSQUEDA',pending:!selection?.error,error:!!selection?.error,tracks:[],reason:selection?.error?'No pudimos reunir 50 canciones relacionadas.':'Preparando 50 canciones desde una grabación concreta…'});
  }
  for (const genre of genres) {
    if (curiosity.length >= 4) break;
    const allowed = new Set(genreArtists([genre]).map(a => a._key));
    const tracks = fullSelection(balancedMix(ranked.filter(t => allowed.has(artistIdentity(t.artist))), '', curiosity.length + 7).concat(ranked.filter(t => allowed.has(artistIdentity(t.artist)))));
    if (tracks.length === MIX_MIN) curiosity.push(make('tag:' + genre.q, genre.label + ' en otra dirección', `Etiqueta que elegiste: ${genre.label}`, tracks, 'TU ETIQUETA'));
  }
  for (const artist of selected) {
    if (curiosity.length >= 4) break;
    const seedGenres = genres.filter(g=>genreArtists([g]).some(a=>a._key===artistIdentity(artist.name)));
    const allowed = new Set([...genreArtists(seedGenres).map(a=>a._key),artistIdentity(artist.name)]);
    const tracks = fullSelection(ranked.filter(t => allowed.has(artistIdentity(t.artist))), ranked.find(t=>artistIdentity(t.artist)===artistIdentity(artist.name)));
    if (tracks.length === MIX_MIN) curiosity.push(make('artist:' + artistIdentity(artist.name), 'Otra cara de ' + artist.name, 'Artista que elegiste', tracks, 'TU ARTISTA'));
  }

  const seeds = [];
  const seedKeys = new Set();
  for (const seed of [
    ...recentTracks.map(t => ({name: t.artist, track: t})),
    ...selected.map(a => ({name: a.name})),
  ]) {
    const key = artistIdentity(seed.name);
    if (key && !seedKeys.has(key)) { seedKeys.add(key); seeds.push(seed); }
  }
  const pairs = new Set();
  const neighborArtists = new Set();
  for (const seed of seeds) {
    if (connections.length >= 4) break;
    const key = artistIdentity(seed.name);
    const shared = genres.filter(g => genreArtists([g]).some(a => a._key === key));
    const allowed = new Set(shared.flatMap(g => genreArtists([g]).map(a => a._key)));
    const candidates = ranked.filter(t => allowed.has(artistIdentity(t.artist)) && artistIdentity(t.artist) !== key);
    const neighbor = candidates.find(t => !neighborArtists.has(artistIdentity(t.artist)) && !pairs.has([key, artistIdentity(t.artist)].sort().join(':')));
    if (!neighbor) continue;
    const neighborKey = artistIdentity(neighbor.artist);
    pairs.add([key, neighborKey].sort().join(':'));
    const common = shared.find(g => genreArtists([g]).some(a => a._key === neighborKey));
    const continuation = ranked.filter(t => allowed.has(artistIdentity(t.artist)));
    const seedTrack = ranked.find(t => artistIdentity(t.artist) === key && !seen.has(t.id));
    const tracks = fullSelection([...(seedTrack ? [seedTrack] : []), ...continuation], neighbor);
    if (tracks.length !== MIX_MIN) continue;
    neighborArtists.add(neighborKey);
    const basis = seed.track ? `Desde «${seed.track.title}», que escuchaste` : `Elegiste a ${seed.name}`;
    connections.push(make('cross:' + key, `${seed.name} → ${neighbor.artist}`, `${basis} · conexión por ${common.label}`, tracks, 'EL SIGUIENTE CRUCE'));
  }
  return [
    {id: 'curiosity', title: 'Tu curiosidad tiene continuación', eyebrow: 'LO QUE TE MUEVE', description: 'Tus búsquedas y etiquetas abren otra ruta.', cards: curiosity},
    {id: 'connections', title: 'El siguiente cruce', eyebrow: 'DE UNA ESCUCHA A OTRA', description: 'Conexiones desde tus artistas, con un motivo para cada selección.', cards: connections},
  ].filter(s => s.cards.length);
}

export function settlePendingShelves(locked, current) {
  const cards = new Map(current.flatMap(s=>s.cards).map(c=>[c.id,c]));
  return locked.map(s=>({...s,cards:s.cards.map(c=>(c.pending||c.error)?cards.get(c.id)||c:c)}));
}
