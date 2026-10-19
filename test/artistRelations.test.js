import test from 'node:test';
import assert from 'node:assert/strict';
import { artistCards, verifiedArtistProfile } from '../src/lib/artistRelations.js';
const row = (id, name) => ({ musicTwoRowItemRenderer: { navigationEndpoint: { browseEndpoint: { browseId: id } }, title: { runs: [{ text: name }] } } });
test('artist relations reject stations and albums and deduplicate real artist identities', () => {
  assert.deepEqual(artistCards({ rows: [row('VLR-radio', 'Station'), row('MPRE-album', 'Album'), row('UC-cudi', 'Kid Cudi'), row('UC-cudi', 'Kid Cudi')] }).map(a => a.artistId), ['UC-cudi']);
});
test('a misparsed artist carousel is recovered from actual catalog artist cards', async () => {
  let requested;
  const result = await verifiedArtistProfile({ getArtist: async () => ({ name: 'Primary', similarArtists: [{ artistId: 'VLR-radio', name: 'Station' }] }), constructRequest: async (...args) => { requested = args; return { rows: [row('UC-neighbor', 'Neighbor')] }; } }, 'UC-primary');
  assert.deepEqual(requested, ['browse', { browseId: 'UC-primary' }]);
  assert.equal(result.similarArtists[0].artistId, 'UC-neighbor');
});
