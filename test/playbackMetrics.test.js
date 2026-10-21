import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackMetrics } from '../src/services/playbackMetrics.js';

test('playback metrics expose aggregate counts and bounded request details only', () => {
  let now = 100;
  const metrics = createPlaybackMetrics({ now: () => now });

  const prepare = metrics.startPrepare();
  now = 145;
  prepare.finish(200);
  prepare.finish(502);

  const first = metrics.startProxy({ identity: 'private-track-title', isRange: true });
  const duplicate = metrics.startProxy({ identity: 'private-track-title', isRange: true });
  first.addBytes(512);
  first.recordRetry();
  now = 200;
  first.finish({ statusCode: 206 });
  duplicate.finish({ statusCode: 503, aborted: true });
  metrics.recordPlaybackError('DIRECT_SOURCE_BLOCKED');
  metrics.recordPlaybackError('token=must-not-be-a-label');

  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot.preparations, {
    requests: 1,
    successes: 1,
    failures: 0,
    totalDurationMs: 45,
    maxDurationMs: 45,
    statuses: { 200: 1 },
    averageDurationMs: 45,
  });
  assert.equal(snapshot.proxy.requests, 2);
  assert.equal(snapshot.proxy.rangeRequests, 2);
  assert.equal(snapshot.proxy.duplicateConcurrentRequests, 1);
  assert.equal(snapshot.proxy.repeatedRequests, 1);
  assert.equal(snapshot.proxy.bodyBytesWritten, 512);
  assert.equal(snapshot.proxy.retryAttempts, 1);
  assert.equal(snapshot.proxy.failedResponses, 1);
  assert.equal(snapshot.proxy.abortedResponses, 1);
  assert.deepEqual(snapshot.playbackErrorsByCode, { DIRECT_SOURCE_BLOCKED: 1, UNKNOWN: 1 });
  assert.equal(JSON.stringify(snapshot).includes('private-track-title'), false);
  assert.equal(JSON.stringify(snapshot).includes('must-not-be-a-label'), false);
});
