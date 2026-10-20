import {afterEach,it,expect} from 'vitest';
import {loadFeedCache,saveFeedCache,clearFeedCache} from '../feedCache.js';

afterEach(()=>clearFeedCache());

it('does not restore an incomplete featured mix from an older cache',()=>{
  saveFeedCache([{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks:Array.from({length:12},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}))}]}],'profile');
  expect(loadFeedCache('profile')).toBeNull();
});

it('retains a complete 50-track featured mix from cache',()=>{
  const tracks=Array.from({length:50},(_,i)=>({id:String(i),title:'Track '+i,artist:'Artist'}));
  saveFeedCache([{section:'En tu frecuencia',mixes:[{label:'Tu frecuencia',featured:true,tracks}]}],'profile');
  expect(loadFeedCache('profile')[0].mixes[0].tracks).toHaveLength(50);
});
