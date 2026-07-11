/**
 * Feed regen gate — evita quedarse solo con "Hecho para ti" tras cancelación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkipFeedRegen } from '../frontend/src/feed/feedSig.js';

test('no skip si aún no hay completedSig (primera carga o gen cancelada a medias)', () => {
  assert.equal(shouldSkipFeedRegen({ completedSig: '', nextSig: 'a|b#0@1' }), false);
  assert.equal(shouldSkipFeedRegen({ completedSig: null, nextSig: 'a|b#0@1' }), false);
  assert.equal(shouldSkipFeedRegen({ completedSig: undefined, nextSig: 'a|b#0@1' }), false);
});

test('skip solo cuando la misma firma ya terminó completa', () => {
  const sig = 't1|t2::q1::pref#0@100';
  assert.equal(shouldSkipFeedRegen({ completedSig: sig, nextSig: sig }), true);
});

test('no skip si la firma cambió (nuevos favs/recent/nonce/slot)', () => {
  assert.equal(
    shouldSkipFeedRegen({ completedSig: 'old#0@1', nextSig: 'new#0@1' }),
    false,
  );
});

test('regresión: firma marcada al INICIO + homeRows parcial no debe saltar regen', () => {
  // Simula el bug: feedSig se setea al empezar; llega "Hecho para ti"; effect re-run.
  // Con la API correcta, completedSig solo existe al final → no skip con parcial.
  const midFlight = { completedSig: '', nextSig: 'seeds::#0@1' };
  assert.equal(
    shouldSkipFeedRegen(midFlight),
    false,
    'gen a medias (sin completedSig) debe regenerar el resto del feed',
  );
});
