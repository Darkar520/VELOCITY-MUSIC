import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpotifyUrl, parseSpotifyResource } from '../frontend/src/spotifyImport.js';

test('isSpotifyUrl detecta open.spotify y URIs', () => {
  assert.equal(isSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd'), true);
  assert.equal(isSpotifyUrl('spotify:playlist:37i9dQZF1DX0XUsuxWHRQd'), true);
  assert.equal(isSpotifyUrl('https://music.youtube.com/playlist?list=PLxxx'), false);
  assert.equal(isSpotifyUrl(''), false);
});

test('parseSpotifyResource: playlist y álbum', () => {
  assert.deepEqual(
    parseSpotifyResource('https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd?si=abc'),
    { type: 'playlist', id: '37i9dQZF1DX0XUsuxWHRQd' },
  );
  assert.deepEqual(
    parseSpotifyResource('https://open.spotify.com/intl-es/playlist/abc123XYZ'),
    { type: 'playlist', id: 'abc123XYZ' },
  );
  assert.deepEqual(
    parseSpotifyResource('spotify:album:5QdJrQY1zM7nXkG1n'),
    { type: 'album', id: '5QdJrQY1zM7nXkG1n' },
  );
  assert.equal(parseSpotifyResource('https://music.youtube.com/playlist?list=PL'), null);
});
