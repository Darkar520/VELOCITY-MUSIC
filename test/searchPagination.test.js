import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_FILTERS, parseSearchRows } from '../src/lib/searchPagination.js';
import { searchAllWithClient } from '../src/extractors/ytmusic.js';

const text = (...runs) => ({ runs: runs.map(([value, browseId]) => ({ text: value, ...(browseId ? { navigationEndpoint: { browseEndpoint: { browseId } } } : {}) })) });
const firstPage = (item) => ({ contents: [{ musicShelfRenderer: { contents: [item], continuations: [{ nextContinuationData: { continuation: 'next-token' } }] } }] });

test('search pagination defines distinct provider filters for each catalog type', () => {
  assert.deepEqual(Object.keys(SEARCH_FILTERS), ['songs', 'albums', 'artists']);
  assert.equal(new Set(Object.values(SEARCH_FILTERS)).size, 3);
});

test('parses a song row and returns its next-page cursor', () => {
  const row = { musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: text(['Comfortably Numb']) } },
      { musicResponsiveListItemFlexColumnRenderer: { text: text(['Pink Floyd', 'UC-pink'], ['The Wall', 'MPRE-wall'], ['6:23']) } },
    ],
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'comfortably-numb' } } } } } },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://img.test/wall.jpg' }] } } },
  } };
  const page = parseSearchRows(firstPage(row), 'songs');
  assert.equal(page.results[0].videoId, 'comfortably-numb');
  assert.equal(page.results[0].artists[0].artistId, 'UC-pink');
  assert.equal(page.results[0].album.albumId, 'MPRE-wall');
  assert.equal(page.continuation, 'next-token');
});

test('parses album and artist shelves from continuation responses', () => {
  const album = { musicTwoRowItemRenderer: {
    title: text(['The Wall']),
    navigationEndpoint: { browseEndpoint: { browseId: 'MPRE-wall' } },
    subtitle: text(['Album', 'Pink Floyd', 'UC-pink', '1979']),
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://img.test/wall.jpg' }] } } },
  } };
  const artist = { musicTwoRowItemRenderer: {
    title: text(['Pink Floyd']), navigationEndpoint: { browseEndpoint: { browseId: 'UC-pink' } },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://img.test/pink.jpg' }] } } },
  } };
  const response = (row) => ({ continuationContents: { musicShelfContinuation: { contents: [row], continuations: [{ nextContinuationData: { continuation: 'next-again' } }] } } });
  assert.equal(parseSearchRows(response(album), 'albums').results[0].albumId, 'MPRE-wall');
  assert.equal(parseSearchRows(response(artist), 'artists').results[0].artistId, 'UC-pink');
  assert.equal(parseSearchRows(response(artist), 'artists').continuation, 'next-again');
});

test('the combined search preserves provider cursors for category-specific follow-up pages', async () => {
  const client = { constructRequest: async (_endpoint, body) => {
    const type = Object.keys(SEARCH_FILTERS).find((key) => SEARCH_FILTERS[key] === body.params);
    const row = type === 'songs'
      ? { musicResponsiveListItemRenderer: { flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: text(['Song']) } }, { musicResponsiveListItemFlexColumnRenderer: { text: text(['Artist', 'UC-artist']) } }], overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'song-id' } } } } } } } }
      : { musicTwoRowItemRenderer: { title: text([type === 'albums' ? 'Album' : 'Artist']), navigationEndpoint: { browseEndpoint: { browseId: type === 'albums' ? 'MPRE-album' : 'UC-artist' } } } };
    return firstPage(row);
  } };
  const result = await searchAllWithClient(client, 'ambient', 20);
  assert.deepEqual(result.continuations, { songs: 'next-token', albums: 'next-token', artists: 'next-token' });
  assert.equal(result.songs[0].id, 'song-id');
  assert.equal(result.albums[0].albumId, 'MPRE-album');
  assert.equal(result.artists[0].artistId, 'UC-artist');
});
