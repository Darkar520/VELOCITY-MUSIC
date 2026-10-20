import test from 'node:test';
import assert from 'node:assert/strict';
import { belongsToArtist, exactArtistMatch, rankAlbumsByTopSongs, rankArtistResults } from '../src/lib/catalogSearchRanking.js';
import { SEARCH_FILTERS } from '../src/lib/searchPagination.js';

const browsePage = (contents) => ({ contents: { singleColumnBrowseResultsRenderer: {
  tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents } } } }],
} } });
const searchPage = (row, continuation) => {
  const shelf = { musicShelfRenderer: { contents: [row], continuations: [{ nextContinuationData: { continuation } }] } };
  const sectionListRenderer = { contents: [shelf] };
  const tabRenderer = { content: { sectionListRenderer } };
  return { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer }] } } };
};

test('exact artist result ranks above a channel whose name merely contains the query', () => {
  const results = [
    { artistId: 'UC-fan', name: 'Pink Floyd Floydhead' },
    { artistId: 'UC-artist', name: 'PINK FLOYD' },
    { artistId: 'UC-cover', name: 'Pink Floyd Covers' },
  ];
  const ranked = rankArtistResults('Pink Floyd', results);
  assert.equal(ranked[0].artistId, 'UC-artist');
  assert.equal(exactArtistMatch('pink floyd', ranked).artistId, 'UC-artist');
});

test('artist search membership uses the catalog ID or an exact credited name', () => {
  const artist = { artistId: 'UC-pink', name: 'Pink Floyd' };
  assert.equal(belongsToArtist({ artistId: 'UC-pink', artist: 'Pink Floyd Tribute' }, artist), true);
  assert.equal(belongsToArtist({ artistId: 'UC-other', artist: 'Pink Floyd' }, artist), false);
  assert.equal(belongsToArtist({ artist: 'Pink Floyd, David Gilmour' }, { name: 'Pink Floyd' }), true);
  assert.equal(belongsToArtist({ artist: 'Pink Floyd Floydhead' }, { name: 'Pink Floyd' }), false);
});

test('artist albums follow the strongest provider-ranked song before album track counts', () => {
  const albums = [
    { albumId: 'wall', name: 'The Wall' },
    { albumId: 'wish', name: 'Wish You Were Here' },
    { albumId: 'dark', name: 'The Dark Side of the Moon' },
  ];
  const songs = [
    { id: 'wish-1', albumId: 'wish' },
    { id: 'dark-1', albumId: 'dark' },
    { id: 'wall-1', albumId: 'wall' },
    { id: 'wall-2', albumId: 'wall' },
    { id: 'wall-3', albumId: 'wall' },
  ];
  assert.deepEqual(rankAlbumsByTopSongs(albums, songs).map((album) => album.albumId), ['wish', 'dark', 'wall']);
});

test('combined exact artist search suppresses title homonyms and returns the real catalog', async () => {
  const { searchAllWithClient } = await import('../src/extractors/ytmusic.js');
  const card = (id, name) => ({ musicTwoRowItemRenderer: {
    navigationEndpoint: { browseEndpoint: { browseId: id } },
    title: { runs: [{ text: name }] },
    subtitle: { runs: [{ text: 'Album • 1979' }] },
    thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `${id}.jpg` }] } } },
  } });
  const albumPage = browsePage([
    { musicShelfRenderer: { contents: [card('MPREb_wall', 'The Wall'), card('UC-fan', 'PINK FLOYD')] } },
  ]);
  const track = { musicResponsiveListItemRenderer: {
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'time-track-1' } } } } } },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Time' }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'PINK FLOYD' }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'The Dark Side of the Moon', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_darkside' } } }] } } },
    ],
    fixedColumns: [], thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'time.jpg' }] } } },
  } };
  const artistPage = browsePage([
    { musicShelfRenderer: { title: { runs: [{
      text: 'Top songs',
      navigationEndpoint: { browseEndpoint: { browseId: 'VLOLAK5uy-top', params: 'top-params' } },
    }] } } },
    { musicCarouselShelfRenderer: {
      header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{
        text: 'Albums', navigationEndpoint: { browseEndpoint: { browseId: 'MPAD-pink' } },
      }] } } },
    } },
  ]);
  const client = {
    searchSongs: async () => [
      { videoId: 'fan-track-1', name: 'PINK FLOYD', artist: { artistId: 'UC-fan', name: 'Ghostdog Jino' }, album: { albumId: 'MPREb_fan', name: 'PINK FLOYD' } },
      { videoId: 'direct-time', name: 'Time', artist: { artistId: 'UC-pink', name: 'PINK FLOYD' }, album: { albumId: 'MPREb_darkside', name: 'The Dark Side of the Moon' } },
    ],
    searchAlbums: async () => [{ albumId: 'MPREb_fan', name: 'PINK FLOYD', artist: { name: 'Ghostdog Jino' } }],
    searchArtists: async () => [
      { artistId: 'UC-fan', name: 'Ghostdog Jino' },
      { artistId: 'UC-pink', name: 'PINK FLOYD' },
    ],
    getArtist: async () => ({ name: 'PINK FLOYD', artistId: 'UC-pink', thumbnails: [], topSongs: [], topAlbums: [] }),
    constructRequest: async (_endpoint, body) => {
      if (body.params === SEARCH_FILTERS.songs) return searchPage(track, 'song-next');
      if (body.params === SEARCH_FILTERS.albums) return searchPage(card('MPREb_wall', 'The Wall'), 'album-next');
      if (body.params === SEARCH_FILTERS.artists) return searchPage(card('UC-pink', 'PINK FLOYD'), 'artist-next');
      if (body.browseId === 'MPAD-pink') return albumPage;
      if (body.browseId === 'VLOLAK5uy-top') return browsePage([{ musicPlaylistShelfRenderer: { contents: [track] } }]);
      return artistPage;
    },
  };
  const result = await searchAllWithClient(client, 'Pink Floyd', 20);
  assert.equal(result.context.kind, 'artist');
  assert.equal(result.artists[0].artistId, 'UC-pink');
  assert.ok(result.songs.length >= 1);
  assert.ok(result.songs.every((song) => song.artistId === 'UC-pink'));
  assert.ok(result.songs.some((song) => song.title === 'Time'));
  assert.deepEqual(result.albums.map((album) => album.albumId), ['MPREb_wall']);
});
