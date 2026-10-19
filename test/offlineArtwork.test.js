import test from 'node:test';
import assert from 'node:assert/strict';
import '../frontend/public/offline-artwork.js';
const art = globalThis.VelocityOfflineArtwork;
const image = 'data:image/png;base64,aGVsbG8=';

test('offline artwork preserves proxy ids, wraps external URLs once and rejects non-image schemes', () => {
  assert.equal(art.source('/img?u=https%3A%2F%2Fcdn.test%2Fa&id=track', 'track'), '/img?u=https%3A%2F%2Fcdn.test%2Fa&id=track');
  const url = new URL(art.source('https://cdn.test/a', 'track'), 'https://velocity.test');
  assert.equal(url.searchParams.get('u'), 'https://cdn.test/a');
  assert.equal(url.searchParams.get('id'), 'track');
  assert.equal(art.source('javascript:alert(1)'), null);
});

test('missing/broken/oversized artwork does not prevent audio metadata from being saved', async () => {
  const fetcher = globalThis.fetch;
  try {
    for (const response of [new Response('bad', { status: 404 }), new Response('html'), new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '2000000' } })]) {
      globalThis.fetch = async () => response;
      const meta = await art.prepare({ id: 'track', title: 'Title', cover: 'https://cdn.test/bad' });
      assert.equal(meta.artworkStatus, 'pending');
      assert.equal(meta.title, 'Title');
      assert.equal(meta.cover, 'https://cdn.test/bad');
    }
  } finally { globalThis.fetch = fetcher; }
});

test('concurrent copies of one cover share a request and keep original image bytes', async () => {
  const fetcher = globalThis.fetch;
  let count = 0;
  try {
    globalThis.fetch = async () => { count++; return new Response(Buffer.from('hello'), { headers: { 'content-type': 'image/png' } }); };
    const metas = await Promise.all(Array.from({ length: 8 }, (_, i) => art.prepare({ id: 'same-' + i, cover: '/shared-art.png' })));
    assert.equal(count, 1);
    assert.ok(metas.every(meta => meta.cover === image && meta.artworkStatus === 'ready'));
  } finally { globalThis.fetch = fetcher; }
});

test('the offline image route works without remote fetch and returns 404 for absent artwork', async () => {
  const store = { getSavedMeta: async id => id === 'saved' ? { cover: image } : null };
  const response = await art.respond('saved', store);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(await response.text(), 'hello');
  assert.equal((await art.respond('missing', store)).status, 404);
});

test('a partial replacement preserves already saved artwork and known text without network work', async () => {
  const fetcher = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('offline'); };
    const meta = await art.prepare({ id: 'saved', title: '', cover: 'https://cdn.test/other' }, { id: 'saved', title: 'Known', artist: 'Artist', album: 'Album', durationSeconds: 123, cover: image });
    assert.equal(meta.cover, image);
    assert.equal(meta.title, 'Known');
    assert.equal(meta.artist, 'Artist');
    assert.equal(meta.durationSeconds, 123);
    assert.equal(meta.artworkStatus, 'ready');
  } finally { globalThis.fetch = fetcher; }
});

test('a list-sized cached cover repairs original-size metadata without network access', async () => {
  const fetcher = globalThis.fetch, cacheStorage = globalThis.caches;
  let network = 0;
  const original = '/img?u=' + encodeURIComponent('https://lh3.googleusercontent.com/album=w1200-h1200-l90-rj') + '&id=saved';
  const cached = new Request('https://velocity.invalid/img?u=' + encodeURIComponent('https://lh3.googleusercontent.com/album=w512-h512-l90-rj') + '&id=saved');
  try {
    globalThis.fetch = async () => { network++; throw new Error('server unavailable'); };
    globalThis.caches = {
      keys: async () => ['velocity-v91'],
      open: async () => ({ keys: async () => [cached], match: async request => (request.url || request) === cached.url ? new Response('hello', { headers: { 'content-type': 'image/png' } }) : undefined }),
    };
    const meta = await art.prepare({ id: 'saved', cover: original });
    assert.equal(meta.cover, image);
    assert.equal(meta.artworkStatus, 'ready');
    assert.equal(network, 0);
  } finally { globalThis.fetch = fetcher; globalThis.caches = cacheStorage; }
});

test('many new covers share one cache enumeration and newly saved variants enter the index',async()=>{
  const previous=globalThis.caches;
  const url=(name,size)=>'https://velocity.invalid/img?u='+encodeURIComponent(`https://lh3.googleusercontent.com/${name}=w${size}-h${size}-l90-rj`);
  let scans=0;
  const stored=new Set(Array.from({length:1000},(_,i)=>url('cached'+i,128)));
  const cache={keys:async()=>{scans++;return [...stored].map(value=>new Request(value));},match:async request=>stored.has(request.url||request)?new Response('image',{headers:{'content-type':'image/jpeg'}}):undefined};
  try{
    globalThis.caches={keys:async()=>[art.CACHE],open:async()=>cache};
    await Promise.all(Array.from({length:20},(_,i)=>art.cached(url('missing'+i,256))));
    assert.equal(scans,1);
    const added=url('just-saved',128);stored.add(added);await art.remember(art.CACHE,added);
    assert.equal((await art.cached(url('just-saved',256))).status,200);
    assert.equal(scans,1);
  }finally{globalThis.caches=previous;}
});

test('cached variant matching never substitutes a different album or another explicit fallback id', async () => {
  const cacheStorage = globalThis.caches;
  try {
    const wrong = new Request('https://velocity.invalid/img?u=' + encodeURIComponent('https://lh3.googleusercontent.com/other=w512-h512-l90-rj') + '&id=saved');
    const otherId = new Request('https://velocity.invalid/img?u=' + encodeURIComponent('https://lh3.googleusercontent.com/album=w512-h512-l90-rj') + '&id=other');
    globalThis.caches = { keys: async () => ['velocity-v91'], open: async () => ({ keys: async () => [wrong, otherId], match: async request => [wrong.url, otherId.url].includes(request.url || request) ? new Response('hello', { headers: { 'content-type': 'image/png' } }) : undefined }) };
    const url = '/img?u=' + encodeURIComponent('https://lh3.googleusercontent.com/album=w900-h900-l90-rj') + '&id=saved';
    assert.equal(await art.cached(url), null);
  } finally { globalThis.caches = cacheStorage; }
});
