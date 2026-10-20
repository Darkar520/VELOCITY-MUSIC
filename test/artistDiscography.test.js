import test from 'node:test';
import assert from 'node:assert/strict';
import {
  artistDiscographyCards,
  artistDiscographyEndpoints,
  artistTopSongsEndpoint,
  artistTopSongsItems,
  mapArtistDiscographyItems,
  mapArtistTopSongs,
} from '../src/lib/artistDiscography.js';

const run = (text, navigationEndpoint) => ({ text, ...(navigationEndpoint ? { navigationEndpoint } : {}) });
const browsePage = (contents) => ({ contents: { singleColumnBrowseResultsRenderer: {
  tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents } } } }],
} } });
const albumCard = (albumId, name, year) => ({ musicTwoRowItemRenderer: {
  navigationEndpoint: { browseEndpoint: { browseId: albumId } },
  title: { runs: [run(name)] },
  subtitle: { runs: [run(`Album • ${year}`)] },
  thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: `${albumId}.jpg` }] } } },
} });

function artistPage() {
  const titleShelf = (name, browseId, params = '') => {
    const title = { runs: [run(name, { browseEndpoint: { browseId, params } })] };
    return { musicCarouselShelfRenderer: {
      header: { musicCarouselShelfBasicHeaderRenderer: { title } },
      contents: [],
    } };
  };
  const topSongs = { musicShelfRenderer: {
    title: { runs: [run('Top songs', { browseEndpoint: { browseId: 'VLOLAK5uy-top', params: 'songs' } })] },
  } };
  return browsePage([
    topSongs,
    titleShelf('Albums', 'MPAD-artist', 'albums'),
    titleShelf('Singles & EPs', 'MPAD-artist-singles', 'singles'),
    titleShelf('Fans might also like', 'UC-neighbor'),
  ]);
}

test('artist discography reads only real Albums and Singles shelves', () => {
  const endpoints = artistDiscographyEndpoints(artistPage());
  assert.deepEqual(endpoints.map(({ label, endpoint }) => [label, endpoint.browseId]), [
    ['albums', 'MPAD-artist'],
    ['singles & eps', 'MPAD-artist-singles'],
  ]);
});

test('artist profile maps actual album browse IDs, never the artist ID returned by broken package parser', () => {
  const page = browsePage([
    { musicShelfRenderer: { contents: [albumCard('MPREb_dark-side', 'The Dark Side of the Moon', 1973), albumCard('UC-artist', 'Broken parser result', 1973)] } },
  ]);
  const albums = mapArtistDiscographyItems(artistDiscographyCards(page), 'Pink Floyd');
  assert.equal(albums.length, 1);
  assert.equal(albums[0].albumId, 'MPREb_dark-side');
  assert.equal(albums[0].artist.name, 'Pink Floyd');
  assert.equal(albums[0].year, 1973);
});

test('top-songs shelf requires its browse params and maps all provider-ranked tracks', () => {
  const endpoint = artistTopSongsEndpoint(artistPage());
  assert.equal(endpoint.browseId, 'VLOLAK5uy-top');
  assert.equal(endpoint.params, 'songs');
  const rawTrack = {
    musicResponsiveListItemRenderer: {
      overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'track-id-01' } } } } } },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('Time')] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('Pink Floyd')] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('The Dark Side of the Moon', { browseEndpoint: { browseId: 'MPREb_dark-side' } })] } } },
      ],
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [run('6:53')] } } }],
      thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'cover.jpg' }] } } },
    },
  };
  const page = browsePage([
    { musicPlaylistShelfRenderer: { contents: [rawTrack] } },
  ]);
  assert.equal(artistTopSongsItems(page).length, 1);
  assert.deepEqual(mapArtistTopSongs([rawTrack], 'UC-pink-floyd', 'Pink Floyd'), [{
    id: 'track-id-01', title: 'Time', artist: 'Pink Floyd', artistId: 'UC-pink-floyd',
    album: 'The Dark Side of the Moon', albumId: 'MPREb_dark-side', durationSeconds: '6:53',
    cover: 'cover.jpg', artworkUrl: 'cover.jpg', mainstream: true,
  }]);
});
