import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  shouldYieldOnExternalPause,
  mediaSessionPlaybackState,
  shouldRestoreInterruptPosition,
  canRestoreInterruptPosition,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  hideRecoverDelays,
} from '../frontend/src/audioContinuity.js';

test('playSyncStrategy: A7 — no play oculto SOLO si yielded; next en lock SÍ play', () => {
  // Cedimos a Instagram y seguimos ocultos → no pelear
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: true, visible: false,
  }), 'noop');
  // Música normal con pantalla bloqueada (next/autoplay) → soft-play
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: false,
  }), 'soft-play', 'next desde lock DEBE poder play()');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: true,
  }), 'soft-play');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: true, visible: true,
  }), 'soft-play', 'visible + cedimos → reanudar');
  assert.equal(playSyncStrategy({
    playing: false, hasSrc: true, yieldedFocus: false, visible: true,
  }), 'pause');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: false, yieldedFocus: false, visible: false,
  }), 'noop');
});

test('shouldYieldOnExternalPause: ceder YA en background', () => {
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), true);
  assert.equal(shouldYieldOnExternalPause({
    hidden: false, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false);
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: true, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false);
});

test('hideRecoverDelays vacío', () => {
  assert.deepEqual(hideRecoverDelays(), []);
});

test('mediaSessionPlaybackState', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: true }), 'paused');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: false }), 'playing');
});

test('A10: canRestoreInterruptPosition solo con yield activo', () => {
  // Sin yield: NUNCA restaurar (seek a 0 y pistas nuevas no se clavan al min 2)
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: false, currentTime: 0, savedPosition: 154,
  }), false);
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: false, currentTime: 5, savedPosition: 154,
  }), false);
  // Con yield y rebobinado real: sí
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: true, currentTime: 1, savedPosition: 154,
  }), true);
  // Con yield pero ya en posición: no
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: true, currentTime: 154, savedPosition: 154,
  }), false);
  assert.equal(canRestoreInterruptPosition({
    yieldedFocus: true, currentTime: 39.5, savedPosition: 40,
  }), false);
});

test('shouldRestoreInterruptPosition legacy (sin active flag) sigue midiendo rebobinado', () => {
  assert.equal(shouldRestoreInterruptPosition(5, 5), false);
  assert.equal(shouldRestoreInterruptPosition(1, 40), true);
  assert.equal(shouldRestoreInterruptPosition(0, 154, { active: false }), false);
  assert.equal(shouldRestoreInterruptPosition(0, 154, { active: true }), true);
});

test('shouldResumeOnForeground / canForceReacquire / isExternalPause', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    systemPaused: true, timeStuck: false, volume: 1, targetVolume: 1,
  }), true);
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: false,
    systemPaused: false, timeStuck: false, volume: 1, targetVolume: 1,
  }), false);
  assert.equal(canForceReacquire(false), false);
  assert.equal(canForceReacquire(true), true);
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
});
