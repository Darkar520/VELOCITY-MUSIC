import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDjSeeds, orderDjStation } from '../frontend/src/feed/aiDj.js';
const tracks = [{ id: 'a', artist: 'Alpha', title: 'One' }, { id: 'b', artist: 'Beta', title: 'Two' }, { id: 'c', artist: 'Alpha', title: 'Three' }];
test('DJ personalization responds to explicit preference and previous station exposure', () => {
  const base = { recent: ['a', 'b', 'c'], tracks };
  assert.equal(rankDjSeeds(base)[0].id, 'a');
  assert.equal(rankDjSeeds({ ...base, favorites: ['b'] })[0].id, 'b');
  assert.equal(rankDjSeeds({ ...base, previous: ['a', 'c'] })[0].id, 'b');
  assert.deepEqual(rankDjSeeds(base), rankDjSeeds(base));
});
test('DJ ordering preserves the qualified candidate set and promotes unseen related music', () => {
  const ordered = orderDjStation(tracks, { recent: ['a'] });
  assert.equal(ordered[0].id, 'b');
  assert.deepEqual(ordered.map(t => t.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(orderDjStation([]), []);
});
