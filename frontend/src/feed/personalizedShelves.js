import {artistIdentity, genreArtists} from './tasteProfile.js';
import {balancedMix} from './deepMixes.js';
import {dedupeByTitle} from '../helpers.js';

export const recentQueries = searches => [...new Map((searches || [])
  .filter(q => typeof q === 'string' && q.trim().length >= 2)
  .map(q => [q.trim().toLocaleLowerCase(), q.trim()])).values()].slice(0, 3);
const textKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
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
  const ranked = [...catalog].sort((a, b) => rank(a) - rank(b));
  const make = (id, label, reason, tracks, tag) => ({id, label, reason, tag, tracks: usable(tracks).slice(0, 50)});

  for (const query of recentQueries(searches)) {
    const terms = textKey(query).split(/\s+/);
    const local = catalog.filter(t => terms.every(term => textKey([t.title, t.artist, t.album, t.genre].join(' ')).includes(term)));
    const tracks = usable(searchResults[query]?.length ? searchResults[query] : local);
    if (tracks.length >= 3) curiosity.push(make('search:' + query, query, `Buscaste «${query}»`, tracks, 'TU BÚSQUEDA'));
  }
  for (const genre of genres) {
    if (curiosity.length >= 4) break;
    const allowed = new Set(genreArtists([genre]).map(a => a._key));
    const tracks = balancedMix(ranked.filter(t => allowed.has(artistIdentity(t.artist)) && !seen.has(t.id)), '', curiosity.length + 7);
    if (tracks.length >= 3) curiosity.push(make('tag:' + genre.q, genre.label + ' en otra dirección', `Etiqueta que elegiste: ${genre.label}`, tracks, 'TU ETIQUETA'));
  }
  for (const artist of selected) {
    if (curiosity.length >= 4) break;
    const tracks = ranked.filter(t => artistIdentity(t.artist) === artistIdentity(artist.name) && !seen.has(t.id));
    if (tracks.length >= 3) curiosity.push(make('artist:' + artistIdentity(artist.name), 'Otra cara de ' + artist.name, 'Artista que elegiste', tracks, 'TU ARTISTA'));
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
    const candidates = ranked.filter(t => allowed.has(artistIdentity(t.artist)) && artistIdentity(t.artist) !== key && !seen.has(t.id));
    const neighbor = candidates.find(t => !neighborArtists.has(artistIdentity(t.artist)) && !pairs.has([key, artistIdentity(t.artist)].sort().join(':')));
    if (!neighbor) continue;
    const neighborKey = artistIdentity(neighbor.artist);
    pairs.add([key, neighborKey].sort().join(':'));
    const common = shared.find(g => genreArtists([g]).some(a => a._key === neighborKey));
    const continuation = balancedMix(ranked.filter(t => allowed.has(artistIdentity(t.artist)) && !seen.has(t.id)), neighbor.artist, connections.length + 19);
    const seedTrack = ranked.find(t => artistIdentity(t.artist) === key && !seen.has(t.id));
    const tracks = usable([neighbor, ...(seedTrack ? [seedTrack] : []), ...continuation]).slice(0, 50);
    if (tracks.length < 3) continue;
    neighborArtists.add(neighborKey);
    const basis = seed.track ? `Desde «${seed.track.title}», que escuchaste` : `Elegiste a ${seed.name}`;
    connections.push(make('cross:' + key, `${seed.name} → ${neighbor.artist}`, `${basis} · conexión por ${common.label}`, tracks, 'EL SIGUIENTE CRUCE'));
  }
  return [
    {id: 'curiosity', title: 'Tu curiosidad tiene continuación', eyebrow: 'LO QUE TE MUEVE', description: 'Tus búsquedas y etiquetas abren otra ruta.', cards: curiosity},
    {id: 'connections', title: 'El siguiente cruce', eyebrow: 'DE UNA ESCUCHA A OTRA', description: 'Conexiones desde tus artistas, con un motivo para cada selección.', cards: connections},
  ].filter(s => s.cards.length);
}
