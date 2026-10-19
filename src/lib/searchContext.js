import { verifiedArtistProfile } from './artistRelations.js';
// Entity relationships are catalog IDs, never title-only album membership.
export async function enrichSearchContext(client, query, data, { normalize, mapSong, mapAlbum, mapArtist, loadAlbum }) {
  const exactAlbum = data.albums.find(album => normalize(album.name) === normalize(query));
  const exactSong = data.songs.find(song => normalize(song.title) === normalize(query));
  const exactArtist = data.artists[0] && normalize(data.artists[0].name) === normalize(query) && normalize(data.songs[0]?.artist) === normalize(query);
  if (exactArtist && !exactAlbum) return data;
  let context = null, album = null;
  const albumCorroborated = !exactSong || normalize(data.artists[0]?.name) === normalize(exactAlbum?.artist) || exactSong.albumId === exactAlbum?.albumId;
  if (exactAlbum && albumCorroborated && typeof client.getAlbum === 'function') {
    try {
      album = await loadAlbum(client, exactAlbum.albumId);
      if (album.tracks.length && normalize(album.name) === normalize(query)) context = { kind: 'album', albumId: album.albumId, artistId: album.artistId, name: album.name };
    } catch { /* retain direct search results */ }
  }
  if (!context && exactSong) context = { kind: 'track', trackId: exactSong.id, albumId: exactSong.albumId, artistId: exactSong.artistId, name: exactSong.title };
  if (!context) return data;
  const unique = (items, key) => [...new Map(items.filter(item => item?.[key]).map(item => [item[key], item])).values()];
  const primarySongs = context.kind === 'album' ? album.tracks : [exactSong];
  let albums = album ? [{ ...exactAlbum, ...album, tracks: undefined }] : [];
  let artists = [], relatedSongs = [];
  if (!album && context.albumId && typeof client.getAlbum === 'function') {
    try { album = await loadAlbum(client, context.albumId); albums.push({ ...album, tracks: undefined }); } catch { /* optional */ }
  }
  if (context.artistId && typeof client.getArtist === 'function') {
    try {
      const profile = await verifiedArtistProfile(client, context.artistId);
      artists.push({ ...mapArtist(profile), artistId: context.artistId });
      albums.push(...(profile.topAlbums || []).map(mapAlbum).filter(item => normalize(item.artist) === normalize(profile.name)));
      relatedSongs = (profile.topSongs || []).map(mapSong).filter(song => song.artistId === context.artistId);
      artists.push(...(profile.similarArtists || []).map(mapArtist).filter(artist => /^UC/.test(artist.artistId || '')));
      // Associate albums through real related artist profiles, with at most
      // two additional calls. These are recommendations, not album membership.
      const neighbors = artists.filter(artist => artist.artistId !== context.artistId).slice(0, 2);
      const relatedAlbums = await Promise.all(neighbors.map(async artist => {
        try {
          const related = await client.getArtist(artist.artistId);
          return (related.topAlbums || []).map(mapAlbum).filter(item => normalize(item.artist) === normalize(artist.name)).slice(0, 2);
        } catch { return []; }
      }));
      const own = albums.splice(1);
      albums.push(...relatedAlbums.flat(), ...own);
    } catch { /* optional */ }
  }
  if (!artists.length) {
    const name = album?.artist || exactSong?.artist;
    artists = data.artists.filter(artist => artist.artistId === context.artistId || normalize(artist.name) === normalize(name));
  }
  return { context, songs: unique([...primarySongs, ...relatedSongs, ...data.songs], 'id'), albums: unique([...albums, ...data.albums], 'albumId'), artists: unique([...artists, ...data.artists], 'artistId') };
}
