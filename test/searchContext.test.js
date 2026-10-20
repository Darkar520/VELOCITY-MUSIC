import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSearchContext } from '../src/lib/searchContext.js';
import { dedupeByRelevance } from '../frontend/src/searchRanking.js';

const adapters = { normalize: s => String(s || '').toLowerCase(), mapSong: s => s, mapAlbum: a => a, mapArtist: a => a, loadAlbum: (client, id) => client.getAlbum(id) };
const album = { albumId: 'album-1', name: 'Graduation', artist: 'Kanye West', artistId: 'UC-kanye', tracks: [{ id: 'lights', title: 'Flashing Lights', artist: 'Kanye West', albumId: 'album-1' }] };
const literal = { id: 'homonym', title: 'Graduation', artist: 'Other' };

test('album intent promotes verified album tracks over literal song homonyms in API and UI', async () => {
  const data = { albums: [album], songs: [literal], artists: [{ artistId: 'UC-kanye', name: 'Kanye West' }, { artistId: 'UC-homonym', name: 'Graduation' }] };
  const result = await enrichSearchContext({ getAlbum: async () => album }, 'Graduation', data, adapters);
  assert.equal(result.context.albumId, album.albumId);
  assert.equal(result.songs[0].id, 'lights');
  assert.equal(dedupeByRelevance('Graduation', result.songs, result.context)[0].id, 'lights');
  assert.ok(result.songs.some(s => s.id === literal.id));
});
test('track intent adds its catalog album, primary artist and actual related artists', async () => {
  const track = { ...album.tracks[0], artistId: album.artistId };
  const related = { artistId: 'UC-cudi', name: 'Kid Cudi' };
  const client = { getAlbum: async () => album, getArtist: async () => ({ name: album.artist, topAlbums: [album], similarArtists: [related, { artistId: 'VLR-radio', name: 'A station' }] }) };
  const continuations = { songs: 's-next', albums: 'a-next', artists: 'r-next' };
  const result = await enrichSearchContext(client, 'Flashing Lights', { songs: [track], albums: [], artists: [], continuations }, adapters);
  assert.equal(result.context.kind, 'track');
  assert.equal(result.albums[0].albumId, album.albumId);
  assert.equal(result.artists[0].artistId, album.artistId);
  assert.ok(result.artists.some(a => a.artistId === related.artistId));
  assert.ok(!result.artists.some(a => a.artistId === 'VLR-radio'));
  assert.equal(result.continuations, continuations);
});
test('artist queries and failed album lookups retain direct search without fabricated membership', async () => {
  const data = { songs: [literal], albums: [album], artists: [] };
  const result = await enrichSearchContext({ getAlbum: async () => { throw new Error('unavailable'); } }, 'Graduation', data, adapters);
  assert.equal(result.songs[0].id, literal.id);
  assert.equal(result.songs[0].albumId, undefined);
  const artistData = { songs: [{ ...literal, artist: 'Graduation' }], albums: [], artists: [{ artistId: 'UC-exact', name: 'Graduation' }] };
  assert.equal(await enrichSearchContext({}, 'Graduation', artistData, adapters), artistData);
});
