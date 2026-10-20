import {describe,it,expect} from 'vitest';
import {readFeedMixCycle,FEED_MIX_CYCLE_MS} from '../feedCycle.js';

function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
}

describe('three-day home mix rotation',()=>{
  it('keeps a profile stable for three days and advances at the boundary',()=>{
    const local=storage(),start=1_800_000_000_000;
    expect(readFeedMixCycle('account:profile',start,local)).toEqual({cycle:0,nextAt:start+FEED_MIX_CYCLE_MS});
    expect(readFeedMixCycle('account:profile',start+FEED_MIX_CYCLE_MS-1,local).cycle).toBe(0);
    expect(readFeedMixCycle('account:profile',start+FEED_MIX_CYCLE_MS,local)).toEqual({cycle:1,nextAt:start+2*FEED_MIX_CYCLE_MS});
    expect(readFeedMixCycle('account:profile',start+FEED_MIX_CYCLE_MS+1,local).cycle).toBe(1);
  });

  it('keeps separate rotation anchors for separate taste profiles',()=>{
    const local=storage(),start=1_800_000_000_000;
    readFeedMixCycle('metal',start,local);
    expect(readFeedMixCycle('rock',start+FEED_MIX_CYCLE_MS,local).cycle).toBe(0);
    expect(readFeedMixCycle('metal',start+FEED_MIX_CYCLE_MS,local).cycle).toBe(1);
  });

  it('recovers from a malformed saved cycle value',()=>{
    const local={getItem:()=> 'null',setItem:()=>{}};
    expect(readFeedMixCycle('profile',1_800_000_000_000,local).cycle).toBe(0);
  });
});
