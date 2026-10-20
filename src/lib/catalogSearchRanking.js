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

/**
 * Rank an artist's albums by the provider order of its Top songs shelf.
 * Each distinct song contributes a reciprocal-log rank weight to its real
 * albumId, so the most prominent track matters most while several popular
 * tracks can lift the same album. Original catalog order breaks ties.
 */
export function rankAlbumsByTopSongs(albums = [], songs = []) {
  const albumScores = new Map();
  const seenSongs = new Set();
  songs.forEach((song, index) => {
    const songId = song?.videoId || song?.id;
    const albumId = song?.album?.albumId || song?.albumId;
    if (!albumId || (songId && seenSongs.has(songId))) return;
    if (songId) seenSongs.add(songId);
    const score = albumScores.get(albumId) || { firstRank: index, weight: 0 };
    score.firstRank = Math.min(score.firstRank, index);
    score.weight += 1 / Math.log2(index + 2);
    albumScores.set(albumId, score);
  });

  return albums
    .map((album, index) => ({ album, index, score: albumScores.get(album?.albumId) || { firstRank: Infinity, weight: 0 } }))
    .sort((a, b) => a.score.firstRank - b.score.firstRank || b.score.weight - a.score.weight || a.index - b.index)
    .map(({ album }) => album);
}
