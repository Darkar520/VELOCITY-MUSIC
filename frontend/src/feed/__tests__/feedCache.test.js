import {afterEach,it,expect} from 'vitest';
import {loadFeedCache,saveFeedCache,clearFeedCache} from '../feedCache.js';

afterEach(()=>clearFeedCache());

it('does not restore an incomplete featured mix from an older cache',()=>{
  saveFeedCache([{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks:Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}))}]}],'profile');
  expect(loadFeedCache('profile')).toBeNull();
});

it('rejects a legacy 12-track frequency mix even when it has no featured marker',()=>{
  const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
  localStorage.setItem('velocity.feedCache',JSON.stringify({
    ts:Date.now(),context:'profile',format:1,
    sections:[{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',tracks}]}],
  }));
  expect(loadFeedCache('profile')).toBeNull();
});

it('upgrades a complete legacy frequency mix to the featured identity',()=>{
  const tracks=Array.from({length:50},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
  localStorage.setItem('velocity.feedCache',JSON.stringify({
    ts:Date.now(),context:'profile',format:1,
    sections:[{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',tracks}]}],
  }));
  const cached=loadFeedCache('profile');
  expect(cached[0].mixes[0].featured).toBe(true);
  expect(cached[0].mixes[0].tracks).toHaveLength(50);
});

it('retains a complete 50-track featured mix from cache',()=>{
  const tracks=Array.from({length:50},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
  saveFeedCache([{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks}]}],'profile');
  expect(loadFeedCache('profile')[0].mixes[0].tracks).toHaveLength(50);
});
