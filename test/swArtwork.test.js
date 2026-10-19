import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({ copyFails = false, networkImage = false, consumeImmediately = false } = {}) {
  const origin = 'https://velocity.test';
  const imageUrl = size => origin + '/img?u=' + encodeURIComponent('https://lh3.googleusercontent.com/album=w' + size + '-h' + size + '-l90-rj') + '&id=saved';
  const stores = new Map();
  const keyOf = request => new URL(request.url || request, origin).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    open: async name => {
      if (consumeImmediately && name === 'velocity-artwork-v1') await new Promise(resolve => setTimeout(resolve, 0));
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        keys: async () => [...entries.keys()].map(url => new Request(url)),
        match: async request => entries.get(keyOf(request))?.clone(),
        put: async (request, response) => {
          if (copyFails && name === 'velocity-artwork-v1') throw new Error('quota');
          entries.set(keyOf(request), response.clone());
        },
      };
    },
  };
  stores.set('velocity-v91', new Map([
    [imageUrl(512), new Response('album bytes', { headers: { 'content-type': 'image/jpeg' } })],
    [origin + '/assets/old.js', new Response('old shell')],
    [origin + '/img?u=bad', new Response('html', { headers: { 'content-type': 'text/html' } })],
  ]));
  stores.set('unrelated-app', new Map());
  const listeners = new Map();
  let network = 0;
  const self = { location: { origin }, clients: { claim: async () => {}, matchAll: async () => [] }, addEventListener: (type, listener) => listeners.set(type, listener) };
  const context = vm.createContext({ self, caches, URL, URLSearchParams, Response, Request, AbortController, setTimeout, clearTimeout, location: self.location, fetch: async () => { network++; if (networkImage) return new Response('fresh artwork', {headers:{'content-type':'image/jpeg'}}); throw new Error('server down'); } });
  self.importScripts = () => {
    vm.runInContext(readFileSync(new URL('../frontend/public/offline-artwork.js', import.meta.url), 'utf8'), context);
    self.VelocityOfflineArtwork = context.VelocityOfflineArtwork;
  };
  vm.runInContext(readFileSync(new URL('../frontend/public/sw.js', import.meta.url), 'utf8'), context);
  return {
    stores, imageUrl, network: () => network,
    activate: () => new Promise((resolve, reject) => listeners.get('activate')({ waitUntil: promise => promise.then(resolve, reject) })),
    fetch: async url => {
      let response, work;
      listeners.get('fetch')({ request: new Request(url), respondWith: promise => { response = promise; }, waitUntil: promise => { work = promise; } });
      const result = await response;
      const bytes = consumeImmediately ? await result.arrayBuffer() : null;
      await work;
      return bytes ? new Response(bytes,{status:result.status,headers:result.headers}) : result;
    },
  };
}

test('network artwork is cached even when the browser consumes the response before CacheStorage opens', async () => {
  const f = fixture({networkImage:true,consumeImmediately:true});
  const url = f.imageUrl(128).replace('album','fresh');
  const response = await f.fetch(url);
  assert.equal(await response.text(),'fresh artwork');
  assert.equal(await f.stores.get('velocity-artwork-v1')?.get(url)?.clone().text(),'fresh artwork');
});

test('worker update retains artwork, discards old shell, and leaves other caches alone', async () => {
  const f = fixture();
  await f.activate();
  assert.equal(f.stores.has('velocity-v91'), false);
  assert.equal(f.stores.has('unrelated-app'), true);
  const images = f.stores.get('velocity-artwork-v1');
  assert.equal(images.size, 1);
  assert.equal(await images.get(f.imageUrl(512)).clone().text(), 'album bytes');
  for (const size of [96, 900, 1200]) {
    const response = await f.fetch(f.imageUrl(size));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'album bytes');
  }
  assert.equal(f.network(), 0);
});

test('failed artwork migration retains the old cache and can still serve another image size', async () => {
  const f = fixture({ copyFails: true });
  await f.activate();
  assert.equal(f.stores.has('velocity-v91'), true);
  const response = await f.fetch(f.imageUrl(96));
  assert.equal(await response.text(), 'album bytes');
  assert.equal(f.network(), 0);
});

test('an absent image returns a controlled error without substituting another cover', async () => {
  const f = fixture();
  const response = await f.fetch(f.imageUrl(96).replace('album', 'other'));
  assert.equal(response.status, 503);
  assert.equal(f.network(), 1);
});
