import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../frontend/public/downloads-worker.js';

const { createWorker } = globalThis.VelocityDownloadWorker;
const origin = 'https://velocity.test', batchId = 'velocity-download-test';
const url = (id) => `${origin}/api/stream-proxy?id=${id}&exp=9999999999&sig=signature`;
const sha = async (blob) => createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');

function fixture(count = 1) {
  const jobs = new Map(Array.from({ length: count }, (_, i) => {
    const id = `song-${i}`;
    return [id, { id, meta: { id, artist: 'Artist', title: id }, quality: 'high', url: url(id), batchId, status: 'background' }];
  }));
  const audio = new Map(), active = new Map([[batchId, { abort: async () => { active.delete(batchId); } }]]);
  const store = {
    list: async () => [...jobs.values()].map((job) => structuredClone(job)),
    get: async (id) => jobs.has(id) ? structuredClone(jobs.get(id)) : undefined,
    put: async (job) => { jobs.set(job.id, structuredClone(job)); },
    putMany: async (items) => { items.forEach((job) => jobs.set(job.id, structuredClone(job))); },
    remove: async (id) => { jobs.delete(id); }, clear: async () => { jobs.clear(); },
    saveAudio: async (meta, blob) => { audio.set(meta.id, { meta, blob }); },
  };
  const manager = { getIds: async () => [...active.keys()], get: async (id) => active.get(id), fetch: () => { throw new Error('workers must never start new background fetches'); } };
  const worker = () => createWorker({ store, manager, origin });
  const event = (response = () => new Response('original-audio', { headers: { 'content-type': 'audio/webm', 'content-length': '14' } })) => ({
    registration: { id: batchId, matchAll: async () => Array.from({ length: count }, (_, i) => ({ request: { url: url(`song-${i}`) }, responseReady: Promise.resolve(response(i)) })) },
    updateUI: async () => {},
  });
  return { jobs, audio, store, manager, active, worker, event };
}

test('350 browser-owned songs are committed by a new worker without a page or re-encoding', async () => {
  const f = fixture(350);
  await f.worker().finish(f.event());
  assert.equal(f.audio.size, 350);
  assert.equal(f.jobs.size, 0);
  const expected = await sha(new Blob(['original-audio']));
  for (const { blob } of f.audio.values()) assert.equal(await sha(blob), expected);
});

test('a failed playlist keeps successes and retains only failed songs for retry', async () => {
  const f = fixture(3);
  await f.worker().finish(f.event((i) => i === 1 ? new Response('denied', { status: 403 })
    : new Response('original-audio', { headers: { 'content-type': 'audio/webm', 'content-length': '14' } })));
  assert.equal(f.audio.size, 2);
  assert.equal(f.jobs.get('song-1').status, 'failed');
  assert.equal(f.jobs.get('song-1').error, 'http_403');
});

test('truncated and non-audio responses never become offline songs', async () => {
  for (const headers of [{ 'content-type': 'audio/webm', 'content-length': '999' }, { 'content-type': 'text/html' }]) {
    const f = fixture();
    await f.worker().finish(f.event(() => new Response('incomplete', { headers })));
    assert.equal(f.audio.size, 0);
    assert.equal(f.jobs.get('song-0').status, 'failed');
  }
});

test('browser cancellation pauses its playlist and does not restart it', async () => {
  const f = fixture(20);
  f.jobs.set('other-list', { id: 'other-list', batchId: 'velocity-download-other', status: 'background' });
  await f.worker().abort({ registration: { id: batchId } });
  assert.ok([...f.jobs.values()].filter((job) => job.batchId === batchId).every((job) => job.status === 'paused'));
  assert.equal(f.jobs.get('other-list').status, 'background');
});

test('storage quota pauses the affected playlist, retaining metadata for recovery', async () => {
  const f = fixture(20);
  f.store.saveAudio = async () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  await f.worker().finish(f.event());
  assert.equal(f.audio.size, 0);
  assert.equal(f.jobs.size, 20);
  assert.ok([...f.jobs.values()].every((job) => job.status === 'paused' && job.error === 'storage_full'));
});

test('clearing during background transfer cannot resurrect deleted downloads', async () => {
  const f = fixture(5), worker = f.worker();
  await worker.cancelAll();
  await worker.finish(f.event());
  assert.equal(f.jobs.size, 0);
  assert.equal(f.audio.size, 0);
  assert.equal(f.active.size, 0);
});

test('worker replacement after a partial commit reconciles only remaining jobs', async () => {
  const f = fixture(5);
  f.audio.set('song-0', { blob: new Blob(['already saved']) });
  f.jobs.delete('song-0');
  await f.worker().finish(f.event());
  assert.equal(f.audio.size, 5);
  assert.equal(f.jobs.size, 0);
  assert.equal(await f.audio.get('song-0').blob.text(), 'already saved');
});
