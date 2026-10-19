import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSearchSeed,composeSeedMix,buildSeedMix,uniqueSongs,titleKey,rememberSearchSeed,rememberedSearchSeed} from '../frontend/src/feed/seededMix.js';
import {requestedRadioLength} from '../src/lib/radioCohesion.js';
const seed={id:'seed',title:'Creep',artist:'Radiohead',artistId:'radiohead'};
const related=Array.from({length:70},(_,i)=>({id:'radio'+i,title:'Related song '+i,artist:['Radiohead','Muse','Placebo','The Smashing Pumpkins','Nirvana'][i%5]}));

test('search resolves one recording and honors the actual selected recording over homonyms',()=>{
 const wrong={id:'wrong',title:'Creep',artist:'Unrelated rapper'};
 assert.equal(selectSearchSeed('Creep',[wrong,seed],{recentTracks:[seed]}).id,seed.id);
 assert.equal(selectSearchSeed('Creep',[wrong,seed],{explicit:seed}).id,seed.id);
 assert.equal(selectSearchSeed('Infinite Source',[{id:'noise',title:'Something',artist:'Infinite Source'},{id:'deftones',title:'Infinite Source',artist:'Deftones'}]).id,'deftones');
 assert.equal(selectSearchSeed('a song not found',[seed]),null);
});
test('a title-match search is never a candidate pool; related mixes have 50 distinct songs with one seed title',()=>{
 const noise=Array.from({length:20},(_,i)=>({id:'noise'+i,title:'Creep',artist:'Unrelated '+i}));
 const tracks=composeSeedMix(seed,{radioTracks:[...related,...noise],pool:[...noise,{id:'foreign',title:'Foreign song',artist:'Creep'}]});
 assert.equal(tracks.length,50);assert.equal(tracks[0].id,'seed');
 assert.equal(new Set(tracks.map(t=>t.id)).size,50);assert.equal(new Set(tracks.map(t=>titleKey(t.title))).size,50);
 assert.equal(tracks.filter(t=>titleKey(t.title)==='creep').length,1);
 assert.ok(tracks.every(t=>!t.id.startsWith('noise')&&t.id!=='foreign'));
 assert.deepEqual(composeSeedMix(seed,{pool:noise}),[]);
});
test('related-genre completion excludes unrelated selected genres',()=>{
 const band={...seed,id:'metal',title:'Infinite Source',artist:'Deftones'};
 const metal=Array.from({length:60},(_,i)=>({id:'metal'+i,title:'Metal song '+i,artist:['Korn','Metallica'][i%2]}));
 const edm=Array.from({length:80},(_,i)=>({id:'edm'+i,title:'EDM song '+i,artist:'Skrillex'}));
 const result=composeSeedMix(band,{pool:[...metal,...edm],prefs:{genres:[{label:'Metal'},{label:'EDM'}]}});
 assert.equal(result.length,50);assert.ok(result.every(t=>t.artist!=='Skrillex'));
});
test('catalog scarcity does not publish a short mix or pad duplicate recordings',async()=>{
 const calls=[];
 const own=Array.from({length:30},(_,i)=>({id:'own'+i,title:'Own song '+i,artist:'Radiohead'}));
 const result=await buildSeedMix(seed,{radio:async(id,limit)=>{calls.push([id,limit]);return related.slice(0,40);},artist:async()=>({topSongs:own}),search:async q=>{assert.equal(q,'Radiohead');return own;}});
 assert.equal(result.tracks.length,50);assert.equal(calls[0][1],100);
 const scarce=await buildSeedMix(seed,{radio:async()=>[seed,seed],search:async()=>[seed]});
 assert.deepEqual(scarce.tracks,[]);
});
test('seed memory is scoped per account and explicit radio requests can exceed the old 40-track default',()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 rememberSearchSeed('Creep',seed,'a');assert.equal(rememberedSearchSeed('creep','a').id,'seed');assert.equal(rememberedSearchSeed('Creep','b'),null);
 assert.equal(requestedRadioLength(),40);assert.equal(requestedRadioLength(50),50);assert.equal(requestedRadioLength(100),100);assert.equal(requestedRadioLength(900),100);
 assert.equal(uniqueSongs([seed,seed]).length,1);
});

test('homonyms cannot become expansion seeds when a radio response is insufficient',async()=>{
 const calls=[];
 const result=await buildSeedMix(seed,{radio:async id=>{calls.push(id);return [{id:'wrong-cover',title:'Creep',artist:'Unrelated rapper'},{id:'wrong-artist',title:'Other song',artist:'Creep'}];},search:async()=>[]});
 assert.deepEqual(calls,['seed']);assert.deepEqual(result.tracks,[]);
});
