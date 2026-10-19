import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedMix,deepRecommendationRows} from '../frontend/src/feed/deepMixes.js';
import {genreArtists} from '../frontend/src/feed/tasteProfile.js';
const names=['Deftones','Metallica','Iron Maiden','Queen','Radiohead','Pink Floyd','Avicii','Calvin Harris','Skrillex','Madeon','Paramore','Korn'];
const pool=names.flatMap(artist=>Array.from({length:20},(_,i)=>({id:artist+i,title:artist+' song '+i,artist})));
test('deep mixes contain 50 real unique songs and different selections',()=>{
 const first=balancedMix(pool,'Deftones',0),next=balancedMix(pool,'Queen',3);
 assert.equal(first.length,50);assert.equal(new Set(first.map(t=>t.id)).size,50);
 assert.ok(first.every(t=>pool.some(p=>p.id===t.id)));
 assert.ok(new Set(first.map(t=>t.artist)).size>=10);
 assert.ok(Math.max(...names.map(name=>first.filter(t=>t.artist===name).length))<=5);
 assert.ok(first.every((t,i)=>i===0||t.artist!==first[i-1].artist));
 assert.notDeepEqual(new Set(first.map(t=>t.id)),new Set(next.map(t=>t.id)));
});
test('scarce catalogs do not pretend to provide a varied 50-song mix',()=>{
 const scarce=pool.filter(t=>['Queen','Radiohead','Pink Floyd'].includes(t.artist));
 assert.equal(balancedMix(scarce,'Queen').length,15);
 assert.equal(deepRecommendationRows(scarce,{genres:[{label:'Rock'}],artists:[]}).length,0);
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
