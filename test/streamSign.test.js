import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  signStreamParams,
  verifyStreamParams,
  buildSignedStreamQuery,
  DEFAULT_STREAM_TTL_SECONDS,
} from '../src/lib/streamSign.js';

const SECRET = 'test-stream-secret-do-not-use-in-prod';
const RUNS = { numRuns: 80 };

test('streamSign: round-trip estable con mismos inputs', () => {
  const params = { artist: 'Daft Punk', title: 'One More Time', id: 'vid1', quality: 'high' };
  const nowMs = 1_700_000_000_000;
  const a = signStreamParams(params, SECRET, { nowMs });
  const b = signStreamParams(params, SECRET, { nowMs });
  assert.equal(a.exp, b.exp);
  assert.equal(a.sig, b.sig);
  assert.equal(typeof a.sig, 'string');
  assert.ok(a.sig.length > 20);
  assert.ok(
    verifyStreamParams({ ...params, exp: a.exp, sig: a.sig }, SECRET, { nowMs }),
  );
});

test('streamSign: cambiar un param invalida la firma', () => {
  const params = { artist: 'A', title: 'B', id: 'x', quality: 'high' };
  const nowMs = 1_700_000_000_000;
  const { exp, sig } = signStreamParams(params, SECRET, { nowMs });
  assert.equal(
    verifyStreamParams({ ...params, title: 'C', exp, sig }, SECRET, { nowMs }),
    false,
  );
});

test('streamSign: exp en el pasado → false', () => {
  const params = { artist: 'A', title: 'B' };
  const nowMs = 1_700_000_000_000;
  const { exp, sig } = signStreamParams(params, SECRET, { nowMs, ttlSeconds: 60 });
  const later = nowMs + 120_000;
  assert.equal(
    verifyStreamParams({ ...params, exp, sig }, SECRET, { nowMs: later }),
    false,
  );
});

test('streamSign: tampering de sig → false', () => {
  const params = { artist: 'A', title: 'B', id: '1' };
  const nowMs = 1_700_000_000_000;
  const { exp, sig } = signStreamParams(params, SECRET, { nowMs });
  const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  assert.equal(
    verifyStreamParams({ ...params, exp, sig: flipped }, SECRET, { nowMs }),
    false,
  );
});

test('streamSign: sin sig/exp → false', () => {
  assert.equal(verifyStreamParams({ artist: 'A', title: 'B' }, SECRET), false);
  assert.equal(verifyStreamParams({ artist: 'A', title: 'B', exp: 9999999999 }, SECRET), false);
});

test('streamSign: buildSignedStreamQuery incluye exp y sig', () => {
  const { exp, sig, query } = buildSignedStreamQuery(
    { artist: 'X', title: 'Y', id: 'z', quality: 'low' },
    SECRET,
    { nowMs: 1_700_000_000_000 },
  );
  assert.ok(query.includes('artist=X'));
  assert.ok(query.includes(`exp=${exp}`));
  assert.ok(query.includes(`sig=${sig}`));
  assert.equal(typeof DEFAULT_STREAM_TTL_SECONDS, 'number');
});

test('PBT: sign/verify round-trip para artist/title imprimibles', () => {
  fc.assert(
    fc.property(
      fc.record({
        artist: fc.string({ minLength: 1, maxLength: 40 }),
        title: fc.string({ minLength: 1, maxLength: 40 }),
        id: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
        quality: fc.option(fc.constantFrom('high', 'medium', 'low'), { nil: undefined }),
      }),
      (params) => {
        const nowMs = 1_700_000_000_000;
        const { exp, sig } = signStreamParams(params, SECRET, { nowMs });
        assert.ok(verifyStreamParams({ ...params, exp, sig }, SECRET, { nowMs }));
      },
    ),
    RUNS,
  );
});
