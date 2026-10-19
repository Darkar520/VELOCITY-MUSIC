import test from 'node:test';
import assert from 'node:assert/strict';
import {personalizedShelves, recentQueries} from '../frontend/src/feed/personalizedShelves.js';
const names = ['Metallica', 'Iron Maiden', 'Deftones', 'Korn', 'Queen', 'Radiohead', 'Miles Davis'];
const pool = names.flatMap(artist => Array.from({length:12}, (_, i) => ({id:artist+i,title:artist+' song '+i,artist,cover:'https://cover.test/'+artist+i})));
const prefs = {genres:[{label:'Metal',q:'metal'},{label:'Rock',q:'rock'}],artists:[{name:'Metallica'}]};
const recentTracks = [pool[0]];

test('tail shelves expose actual search and listening reasons, without fabricating history', () => {
  const rows = personalizedShelves({pool,prefs,recentTracks,searches:['Queen']});
  assert.deepEqual(rows.map(r=>r.id),['curiosity','connections']);
  assert.equal(rows[0].cards[0].reason,'Buscaste «Queen»');
  assert.ok(rows[0].cards[0].tracks.every(t=>t.artist==='Queen'));
  const cross = rows[1].cards[0];
  assert.match(cross.reason,/Desde «Metallica song 0», que escuchaste/);
  assert.ok(cross.tracks.every(t=>t.artist!=='Miles Davis'));
  assert.ok(cross.tracks.every(t=>t.id!==recentTracks[0].id));
  assert.ok(cross.label.endsWith('→ '+cross.tracks[0].artist));
  assert.equal(cross.tracks[1].artist,'Metallica');
  const destinations = rows[1].cards.map(c=>c.tracks[0].artist);
  assert.equal(new Set(destinations).size,destinations.length);
});
test('search intervention changes the search selection; empty signals produce no generic shelves', () => {
  const a = personalizedShelves({pool,searches:['Queen']});
  const b = personalizedShelves({pool,searches:['Radiohead']});
  assert.notEqual(a[0].cards[0].tracks[0].artist,b[0].cards[0].tracks[0].artist);
  assert.deepEqual(personalizedShelves({pool}),[]);
});
test('removing listening history removes listening claims while retaining selected-label connections', () => {
  const rows = personalizedShelves({pool,prefs});
  assert.ok(rows.flatMap(r=>r.cards).every(c=>!c.reason.includes('que escuchaste')));
  assert.match(rows.find(r=>r.id==='connections').cards[0].reason,/Elegiste a Metallica/);
});
test('results are reproducible, bounded, deduplicated and do not mutate their inputs', () => {
  const input = {pool:[...pool,...pool],prefs,recentTracks,searches:['Queen']};
  const before = JSON.stringify(input);
  const first = personalizedShelves(input);
  assert.deepEqual(first,personalizedShelves(input));
  assert.equal(JSON.stringify(input),before);
  for(const row of first){assert.ok(row.cards.length<=4);for(const card of row.cards){assert.ok(card.tracks.length>=3&&card.tracks.length<=50);assert.equal(new Set(card.tracks.map(t=>t.id)).size,card.tracks.length);}}
  assert.deepEqual(recentQueries([' Queen ','queen','',null,'Radiohead','Korn','Deftones']),['queen','Radiohead','Korn']);
});
