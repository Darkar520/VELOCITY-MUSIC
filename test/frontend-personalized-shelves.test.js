import test from 'node:test';
import assert from 'node:assert/strict';
import {personalizedShelves, recentQueries, settlePendingShelves} from '../frontend/src/feed/personalizedShelves.js';
import {composeSeedMix} from '../frontend/src/feed/seededMix.js';
const names = ['Metallica', 'Iron Maiden', 'Deftones', 'Korn', 'Queen', 'Radiohead', 'Miles Davis'];
const pool = names.flatMap(artist => Array.from({length:30}, (_, i) => ({id:artist+i,title:artist+' song '+i,artist,cover:'https://cover.test/'+artist+i})));
const prefs = {genres:[{label:'Metal',q:'metal'},{label:'Rock',q:'rock'}],artists:[{name:'Metallica'}]};
const recentTracks = [pool[0]];

test('tail shelves expose actual search and listening reasons, without fabricating history', () => {
  const seed=pool.find(t=>t.artist==='Queen');
  const rows = personalizedShelves({pool,prefs,recentTracks,searches:['Queen'],searchResults:{Queen:{seed,tracks:composeSeedMix(seed,{radioTracks:pool.filter(t=>['Queen','Radiohead'].includes(t.artist))})}}});
  assert.deepEqual(rows.map(r=>r.id),['curiosity','connections']);
  assert.equal(rows[0].cards[0].reason,'Desde «Queen song 0» · Queen');
  assert.ok(rows[0].cards[0].tracks.every(t=>['Queen','Radiohead'].includes(t.artist)));
  const cross = rows[1].cards[0];
  assert.match(cross.reason,/Desde «Metallica song 0», que escuchaste/);
  assert.ok(cross.tracks.every(t=>t.artist!=='Miles Davis'));
  assert.ok(cross.tracks.every(t=>t.id!==recentTracks[0].id));
  assert.ok(cross.label.endsWith('→ '+cross.tracks[0].artist));
  assert.equal(cross.tracks[1].artist,'Metallica');
  const destinations = rows[1].cards.map(c=>c.tracks[0].artist);
  assert.equal(new Set(destinations).size,destinations.length);
});

test('interacting with the feed freezes ready selections but still lets pending search mixes complete',()=>{
 const frozen={id:'tag:rock',tracks:pool.slice(0,50)};
 const pending={id:'search:Creep',pending:true,tracks:[]};
 const ready={id:'search:Creep',tracks:pool.slice(50,100)};
 const result=settlePendingShelves([{id:'curiosity',cards:[pending,frozen]}],[{id:'curiosity',cards:[ready,{...frozen,tracks:pool.slice(100,150)}]}]);
 assert.equal(result[0].cards[0],ready);assert.equal(result[0].cards[1],frozen);
});
test('search intervention changes the search selection; empty signals produce no generic shelves', () => {
  const selection=name=>{const seed=pool.find(t=>t.artist===name);return {seed,tracks:composeSeedMix(seed,{radioTracks:pool.filter(t=>['Queen','Radiohead'].includes(t.artist))})};};
  const a = personalizedShelves({pool,searches:['Queen'],searchResults:{Queen:selection('Queen')}});
  const b = personalizedShelves({pool,searches:['Radiohead'],searchResults:{Radiohead:selection('Radiohead')}});
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
  for(const row of first){assert.ok(row.cards.length<=4);for(const card of row.cards){assert.ok(card.pending?card.tracks.length===0:card.tracks.length===50);assert.equal(new Set(card.tracks.map(t=>t.id)).size,card.tracks.length);}}
  assert.deepEqual(recentQueries([' Queen ','queen','',null,'Radiohead','Korn','Deftones']),['queen','Radiohead','Korn']);
});
