import test from 'node:test';
import assert from 'node:assert/strict';
import { createCancellableInflight, withAbortableTimeout } from '../src/lib/concurrency.js';

test('deduplicated work survives one caller aborting while another still waits', async () => {
  const dedupe = createCancellableInflight();
  const first = new AbortController();
  const second = new AbortController();
  let workSignal;
  let resolveWork;
  const work = () => new Promise((resolve) => { resolveWork = resolve; });
  const p1 = dedupe('track', (signal) => { workSignal = signal; return work(); }, first.signal);
  const p2 = dedupe('track', () => assert.fail('the shared work should run once'), second.signal);

  await new Promise((resolve) => setImmediate(resolve));
  first.abort();
  await assert.rejects(p1, { name: 'AbortError' });
  assert.equal(workSignal.aborted, false);
  resolveWork('resolved');
  assert.equal(await p2, 'resolved');
});

test('deduplicated work is aborted after every caller has left', async () => {
  const dedupe = createCancellableInflight();
  const first = new AbortController();
  const second = new AbortController();
  let workSignal;
  const p1 = dedupe('track', (signal) => {
    workSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true }));
  }, first.signal);
  const p2 = dedupe('track', () => assert.fail('the shared work should run once'), second.signal);
  await new Promise((resolve) => setImmediate(resolve));
  first.abort();
  second.abort();
  await assert.rejects(p1, { name: 'AbortError' });
  await assert.rejects(p2, { name: 'AbortError' });
  assert.equal(workSignal.aborted, true);
});

test('abortable timeout cancels slow best-effort work and returns its fallback', async () => {
  let workSignal;
  let observedAbort = false;
  const result = await withAbortableTimeout((signal) => {
    workSignal = signal;
    signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
    return new Promise(() => {});
  }, 10, []);

  assert.deepEqual(result, []);
  assert.equal(workSignal.aborted, true);
  assert.equal(observedAbort, true);
});

test('abortable timeout clears its timer after successful work', async () => {
  let observedAbort = false;
  const result = await withAbortableTimeout(async (signal) => {
    signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
    return ['ok'];
  }, 50, []);

  assert.deepEqual(result, ['ok']);
  assert.equal(observedAbort, false);
});
