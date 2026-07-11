import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  hideRecoverDelays,
  shouldYieldAudioFocus,
  mediaSessionPlaybackState,
  shouldRestoreInterruptPosition,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  shouldFadeIn,
  shouldSuspendPreloads,
  shouldPreExtendQueue,
  isDocumentVisible,
} from '../frontend/src/audioContinuity.js';

test('playSyncStrategy', () => {
  assert.equal(playSyncStrategy({ playing: true, hasSrc: true }), 'soft-play');
  assert.equal(playSyncStrategy({ playing: false, hasSrc: true }), 'pause');
});

test('hideRecoverDelays: pocos intentos tempranos (no bucle infinito)', () => {
  const d = hideRecoverDelays();
  assert.ok(d.length <= 3);
  assert.equal(d[0], 0);
  assert.ok(d[d.length - 1] < 1000);
});

test('shouldYieldAudioFocus: ceder tras agotar intentos (no pelear con Facebook)', () => {
  assert.equal(shouldYieldAudioFocus({
    attemptIndex: 0, maxAttempts: 1, stillPaused: true, userWantsPlay: true,
  }), false);
  assert.equal(shouldYieldAudioFocus({
    attemptIndex: 1, maxAttempts: 1, stillPaused: true, userWantsPlay: true,
  }), true);
  assert.equal(shouldYieldAudioFocus({
    attemptIndex: 99, maxAttempts: 1, stillPaused: false, userWantsPlay: true,
  }), false);
});

test('mediaSessionPlaybackState: yielded → paused', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: false }), 'playing');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: true }), 'paused');
});

test('shouldRestoreInterruptPosition: no clavar el mismo segundo', () => {
  assert.equal(shouldRestoreInterruptPosition(5, 5), false);
  assert.equal(shouldRestoreInterruptPosition(2, 40), true);
});

test('shouldResumeOnForeground / canForceReacquire / external pause', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    systemPaused: true, timeStuck: false, volume: 1, targetVolume: 1,
  }), true);
  assert.equal(canForceReacquire(false), false);
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
});

test('misc', () => {
  assert.equal(shouldFadeIn(false), false);
  assert.equal(shouldSuspendPreloads(false), true);
  assert.equal(shouldPreExtendQueue(0, 1), true);
  assert.equal(isDocumentVisible({ visibilityState: 'hidden' }), false);
});
