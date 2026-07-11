import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  hideRecoverDelays,
  shouldYieldOnRePause,
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

test('hideRecoverDelays: pocos y cortos (A7: no bucle)', () => {
  const d = hideRecoverDelays();
  assert.ok(d.length <= 3);
  assert.equal(d[0], 0);
  assert.ok(d.every((ms) => ms < 500));
});

// A7: superposición / vídeo sin sonido — ceder si re-pause tras soft-play
test('shouldYieldOnRePause: re-pause pronto en background → ceder a FB/YT', () => {
  assert.equal(shouldYieldOnRePause({
    hidden: true, userWantsPlay: true, alreadyYielded: false,
    msSinceLastBackgroundPlay: 300, rePauseWindowMs: 1600,
  }), true);
  assert.equal(shouldYieldOnRePause({
    hidden: true, userWantsPlay: true, alreadyYielded: false,
    msSinceLastBackgroundPlay: 5000, rePauseWindowMs: 1600,
  }), false);
  assert.equal(shouldYieldOnRePause({
    hidden: false, userWantsPlay: true, alreadyYielded: false,
    msSinceLastBackgroundPlay: 100, rePauseWindowMs: 1600,
  }), false);
  assert.equal(shouldYieldOnRePause({
    hidden: true, userWantsPlay: true, alreadyYielded: true,
    msSinceLastBackgroundPlay: 100, rePauseWindowMs: 1600,
  }), false);
});

test('shouldYieldAudioFocus tras agotar recover', () => {
  assert.equal(shouldYieldAudioFocus({
    attemptIndex: 1, maxAttempts: 1, stillPaused: true, userWantsPlay: true,
  }), true);
  assert.equal(shouldYieldAudioFocus({
    attemptIndex: 0, maxAttempts: 1, stillPaused: true, userWantsPlay: true,
  }), false);
});

test('mediaSessionPlaybackState yielded → paused', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: true }), 'paused');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: false }), 'playing');
});

// A6: no clavar el mismo segundo
test('shouldRestoreInterruptPosition solo si rebobinó', () => {
  assert.equal(shouldRestoreInterruptPosition(5, 5), false);
  assert.equal(shouldRestoreInterruptPosition(5.2, 5), false);
  assert.equal(shouldRestoreInterruptPosition(1, 40), true);
});

test('shouldResumeOnForeground / canForceReacquire / isExternalPause', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    systemPaused: true, timeStuck: false, volume: 1, targetVolume: 1,
  }), true);
  assert.equal(canForceReacquire(false), false);
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
  assert.equal(isExternalPause({
    selfPause: true, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), false);
});

test('misc helpers', () => {
  assert.equal(shouldFadeIn(false), false);
  assert.equal(shouldSuspendPreloads(false), true);
  assert.equal(shouldPreExtendQueue(0, 1), true);
  assert.equal(isDocumentVisible({ visibilityState: 'hidden' }), false);
});
