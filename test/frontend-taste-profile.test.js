import test from 'node:test';
import assert from 'node:assert/strict';
import {genreArtists,preferenceKey,starterQueries} from '../frontend/src/feed/tasteProfile.js';
import {ONBOARDING_GENRES} from '../frontend/src/constants.js';
test('every offered genre has an immediate editorial roster',()=>{
 for(const genre of ONBOARDING_GENRES)assert.ok(genreArtists([genre]).length>=8,genre.label);
});
test('EDM / rock / metal offer a balanced mainstream and discovery roster without duplicates',()=>{
 const artists=genreArtists(['EDM','Rock','Metal'].map(label=>({label})));
 assert.equal(artists.length,48);
 assert.equal(new Set(artists.map(a=>a._key)).size,48);
 for(const name of ['Deftones','Avicii','Pink Floyd','Metallica','Porter Robinson','Paramore']) assert.ok(artists.some(a=>a.name===name));
 assert.deepEqual(artists.slice(0,3).map(a=>a.genre),['EDM','Rock','Metal']);
});
test('artist-only preference changes and genre-only starts are represented',()=>{
 assert.notEqual(preferenceKey({artists:[{name:'Deftones'}]}),preferenceKey({artists:[{name:'Paramore'}]}));
 const queries=starterQueries({genres:[{label:'Metal',q:'metal'}]});
 assert.equal(queries.length,3);
 assert.ok(queries.every(q=>q.kind==='genre'&&q.label==='Metal'&&q.artist));
});
