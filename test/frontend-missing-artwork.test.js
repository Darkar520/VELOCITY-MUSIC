import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const {bestCoverFor,cacheTrack,trackById}=await import('../frontend/src/catalog.js');
test('missing artwork displays an exact-recording fallback without inventing album metadata',()=>{
  const id='PkiIPzG37vQ';
  cacheTrack({id,title:'Mirror',artist:'Porter Robinson',cover:''});
  const fallback=new URL(bestCoverFor(id),'https://velocitymusic.uk');
  assert.equal(fallback.pathname,'/img');
  assert.equal(fallback.searchParams.get('u'),'https://i.ytimg.com/vi/PkiIPzG37vQ/hqdefault.jpg');
  assert.equal(trackById(id).cover,'');
  const official='https://lh3.googleusercontent.com/official.jpg';
  cacheTrack({id,cover:official});
  assert.equal(bestCoverFor(id),official);
});
test('fallback cannot turn foreign IDs or SoundCloud recordings into YouTube artwork',()=>{
  for(const id of ['bad/../id','https://evil.test','short',''])assert.equal(bestCoverFor(id),'');
  cacheTrack({id:'12345678901',source:'soundcloud',cover:''});
  assert.equal(bestCoverFor('12345678901'),'');
});
