import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedMix,contextualPool,deepRecommendationRows} from '../frontend/src/feed/deepMixes.js';
import {genreArtists} from '../frontend/src/feed/tasteProfile.js';
const names=['Deftones','Metallica','Iron Maiden','Queen','Radiohead','Pink Floyd','Avicii','Calvin Harris','Skrillex','Madeon','Paramore','Korn'];
const pool=names.flatMap(artist=>Array.from({length:20},(_,i)=>({id:artist+i,title:artist+' song '+i,artist})));
test('an Oasis selection cannot borrow unrelated selected genres to reach its target',()=>{
 const mixed=['Oasis','Queen','The Doors','Skrillex','Porter Robinson','José José','Unknown artist'].map((artist,i)=>({id:String(i),title:'Track '+i,artist}));
 const qualified=contextualPool(mixed,'Oasis',{genres:[{label:'Rock'},{label:'EDM'},{label:'Baladas'}]});
 assert.deepEqual(qualified.map(t=>t.artist),['Oasis','Queen','The Doors']);
});
test('deep mixes contain 50 real unique songs and different selections',()=>{
 const first=balancedMix(pool,'Deftones',0),next=balancedMix(pool,'Queen',3);
 assert.equal(first.length,50);assert.equal(new Set(first.map(t=>t.id)).size,50);
 assert.ok(first.every(t=>pool.some(p=>p.id===t.id)));
 assert.ok(new Set(first.map(t=>t.artist)).size>=10);
 assert.ok(Math.max(...names.map(name=>first.filter(t=>t.artist===name).length))<=5);
 assert.ok(first.every((t,i)=>i===0||t.artist!==first[i-1].artist));
 assert.notDeepEqual(new Set(first.map(t=>t.id)),new Set(next.map(t=>t.id)));
});
test('the same profile cycle reproduces the same featured list and the next cycle rotates it',()=>{
 const preferences={genres:[],artists:[]};
 const first=deepRecommendationRows(pool,preferences,0).find(row=>row.section==='En tu frecuencia').mixes[0].tracks;
 const sameCycle=deepRecommendationRows(pool,preferences,0).find(row=>row.section==='En tu frecuencia').mixes[0].tracks;
 const nextCycle=deepRecommendationRows(pool,preferences,1).find(row=>row.section==='En tu frecuencia').mixes[0].tracks;
 const ids=tracks=>tracks.map(track=>track.id);
 assert.deepEqual(ids(first),ids(sameCycle));
 assert.equal(first.length,50);assert.equal(nextCycle.length,50);
 assert.notDeepEqual(new Set(ids(first)),new Set(ids(nextCycle)));
});
test('recommendations prefer studio recordings over duplicate live and remastered versions',()=>{
 const candidates=[
  {id:'live-first',title:'Hit Song (Live)',artist:'Artist 0'},
  {id:'studio',title:'Hit Song',artist:'Artist 0',albumId:'album-hit'},
  {id:'dash-remaster',title:'Track A - 2011 Remastered',artist:'Artist 1'},
  {id:'track-a',title:'Track A',artist:'Artist 1'},
  ...Array.from({length:50},(_,i)=>({id:'ordinary-'+i,title:'Ordinary '+i,artist:'Artist '+(i%10)})),
 ];
 const mix=balancedMix(candidates,'Artist 0');
 const ids=new Set(mix.map(track=>track.id));
 assert.equal(mix.length,50);
 assert.ok(ids.has('studio'));
 assert.ok(ids.has('track-a'));
 assert.ok(!ids.has('live-first'));
 assert.ok(!ids.has('dash-remaster'));
});
test('an alternative recording remains available when it is the only catalog version',()=>{
 const candidates=[...Array.from({length:48},(_,i)=>({id:'normal-'+i,title:'Normal '+i,artist:'Artist '+(i%10)})),
  {id:'only-live',title:'Song - Live',artist:'Artist 9'},
  {id:'live-forever',title:'Live Forever',artist:'Artist 8'}];
 const mix=balancedMix(candidates,'Artist 0');
 assert.equal(mix.length,50);
 assert.ok(mix.some(track=>track.id==='only-live'));
 assert.ok(mix.some(track=>track.id==='live-forever'));
});
test('the featured mix puts recent and liked songs into its familiar opening before discovery',()=>{
 const familiar=Array.from({length:10},(_,i)=>({id:'familiar-'+i,title:'Known '+i,artist:names[i]}));
 const unseen=pool.filter(track=>!familiar.some(known=>known.artist===track.artist&&known.title===track.title));
 const rows=deepRecommendationRows(unseen,{genres:[],artists:[]},0,{familiarTracks:familiar});
 const featured=rows.find(row=>row.section==='En tu frecuencia').mixes[0].tracks;
 const ids=new Set(featured.map(track=>track.id));
 for(const track of familiar)assert.ok(ids.has(track.id),track.title+' should stay in the personalized mix');
 assert.equal(featured.length,50);
 assert.ok(featured.some(track=>!familiar.some(known=>known.id===track.id)),'the mix should still include discoveries');
});
test('scarce catalogs do not pretend to provide a varied 50-song mix',()=>{
 const scarce=pool.filter(t=>['Queen','Radiohead','Pink Floyd'].includes(t.artist));
 assert.equal(balancedMix(scarce,'Queen').length,15);
 assert.equal(deepRecommendationRows(scarce,{genres:[{label:'Rock'}],artists:[]}).length,0);
});
test('uneven artist catalogs still produce 50 tracks without adjacent artist repeats',()=>{
 const uneven=Array.from({length:16},(_,a)=>Array.from({length:a===0?5:3},(_,i)=>({id:`${a}-${i}`,title:`Song ${a} ${i}`,artist:`Artist ${a}`}))).flat();
 const mix=balancedMix(uneven,'Artist 0');
 assert.equal(mix.length,50);
 assert.ok(mix.every((t,i)=>i===0||t.artist!==mix[i-1].artist));
});
test('artist and discovery carousels have 8–10 deep mixes, while genre rows follow selected genres',()=>{
 const genreNames=['Metal','Rock','EDM'].flatMap(label=>genreArtists([{label}]).slice(0,12).map(a=>a.name));
 const expanded=[...pool,...genreNames.flatMap(artist=>Array.from({length:8},(_,i)=>({id:'extra-'+artist+i,title:'extra '+artist+' '+i,artist})))];
 const rows=deepRecommendationRows(expanded,{genres:['Metal','Rock','EDM'].map(label=>({label,q:label})),artists:[{name:'Deftones'}]});
 assert.equal(rows[0].mixes[0].featured,true);assert.equal(rows[0].mixes[0].tracks.length,50);
 for(const row of rows.slice(1,3)){assert.ok(row.mixes.length>=8&&row.mixes.length<=10);assert.ok(row.mixes.every(m=>m.tracks.length===50));}
 const recommendations=rows.slice(1,3).flatMap(row=>row.mixes);
 for(let i=0;i<recommendations.length;i++)for(let j=i+1;j<recommendations.length;j++){
   const ids=new Set(recommendations[i].tracks.map(t=>t.id));
   assert.ok(recommendations[j].tracks.filter(t=>ids.has(t.id)).length<=30);
 }
 assert.equal(rows[3].mixes.length,3);
});
