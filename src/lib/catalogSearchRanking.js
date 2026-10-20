import { normalizeText } from './normalize.js';

const splitArtistCredits = (value) => String(value || '')
  .split(/\s*(?:,|&|\/|\bfeat\.?\b|\bft\.?\b)\s*/i)
  .map(normalizeText)
  .filter(Boolean);

/** Only an exact normalized catalog artist name establishes artist intent. */
export function exactArtistMatch(query, artists = []) {
  const key = normalizeText(query);
  if (!key) return null;
  return artists.find((artist) => normalizeText(artist?.name) === key) || null;
}
/** Strict credit matching prevents homonyms and tribute channels leaking in. */
export function belongsToArtist(item, artist) {
  if (!item || !artist) return false;
  const artistId = artist.artistId;
  if (artistId && item.artistId) return artistId === item.artistId;
  const key = normalizeText(artist.name);
  return Boolean(key && splitArtistCredits(item.artist).includes(key));
}

function artistScore(query, artist, index) {
  const q = normalizeText(query);
  const name = normalizeText(artist?.name);
  if (!q || !name) return -Infinity;
  if (name === q) return 10000 - index;
  if (name.startsWith(q)) return 7000 - index;
  if (name.includes(q)) return 5000 - index;
  const queryTokens = q.split(' ').filter(Boolean);
  const nameTokens = new Set(name.split(' '));
  const overlap = queryTokens.filter((token) => nameTokens.has(token)).length;
  return overlap ? overlap * 100 - index : -index;
}

export function rankArtistResults(query, artists = []) {
  return artists
    .map((artist, index) => ({ artist, index, score: artistScore(query, artist, index) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ artist }) => artist);
}
