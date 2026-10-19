import { artistIdentity } from './tasteProfile.js';

// A transparent ranking policy, not a trained model. Recent is a deduplicated
// ordering: it cannot establish play counts, completion rates or skipped songs.
export function rankDjSeeds({ recent = [], favorites = [], tracks = [], prefs, previous = [] }) {
  const favoriteIds = new Set(favorites), previousIds = new Set(previous);
  const selectedArtists = new Set((prefs?.artists || []).map(artist => artistIdentity(artist.name)));
  const affinity = new Map();
  for (const track of tracks) {
    const rank = recent.indexOf(track.id);
    const weight = (rank >= 0 ? 1 / (1 + rank / 8) : 0) + (favoriteIds.has(track.id) ? 1 : 0);
    const key = artistIdentity(track.artist);
    affinity.set(key, (affinity.get(key) || 0) + weight);
  }
  return tracks.filter(track => track?.id && track.artist && track.title).map((track, index) => {
    const rank = recent.indexOf(track.id), artist = artistIdentity(track.artist);
    const score = (rank >= 0 ? 12 / (1 + rank / 8) : 0)
      + (favoriteIds.has(track.id) ? 8 : 0)
      + Math.min(8, affinity.get(artist) || 0)
      + (selectedArtists.has(artist) ? 5 : 0)
      - (previousIds.has(track.id) ? 18 : 0);
    return { track, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.track);
}

export function orderDjStation(tracks, { recent = [], favorites = [], previous = [], prefs } = {}) {
  const preferred = new Set((prefs?.artists || []).map(artist => artistIdentity(artist.name)));
  const favoritesSet = new Set(favorites), recentSet = new Set(recent.slice(0, 20)), previousSet = new Set(previous);
  const remaining = tracks.map((track, index) => ({ track, index, score: 20 - index * .15 + (favoritesSet.has(track.id) ? 6 : 0) + (preferred.has(artistIdentity(track.artist)) ? 4 : 0) - (recentSet.has(track.id) ? 10 : 0) - (previousSet.has(track.id) ? 12 : 0) }));
  const out = [], counts = new Map();
  while (remaining.length) {
    const last = artistIdentity(out.at(-1)?.artist);
    remaining.sort((a, b) => {
      const score = item => item.score - (counts.get(artistIdentity(item.track.artist)) || 0) * 4 - (last && artistIdentity(item.track.artist) === last ? 30 : 0);
      return score(b) - score(a) || a.index - b.index;
    });
    const { track } = remaining.shift();
    out.push(track);
    const artist = artistIdentity(track.artist); counts.set(artist, (counts.get(artist) || 0) + 1);
  }
  return out;
}
