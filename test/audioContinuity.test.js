import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  shouldFadeIn,
  shouldSuspendPreloads,
  shouldPreExtendQueue,
  isDocumentVisible,
  mediaSessionPlaybackState,
  shouldRestoreInterruptPosition,
  shouldConfirmMediaFocusLoss,
  isPlaybackZombie,
} from '../frontend/src/audioContinuity.js';

test('playSyncStrategy: playing → soft-play (también background)', () => {
  assert.equal(playSyncStrategy({ playing: true, hasSrc: true }), 'soft-play');
  assert.equal(playSyncStrategy({ playing: false, hasSrc: true }), 'pause');
  assert.equal(playSyncStrategy({ playing: true, hasSrc: false }), 'noop');
});

test('shouldRestoreInterruptPosition: solo si REBOBINÓ, no si está en el mismo segundo', () => {
  // Pegado en 5 con ancla 5 → NO restaurar (era el bug del “segundo 5 eterno”)
  assert.equal(shouldRestoreInterruptPosition(5, 5), false);
  assert.equal(shouldRestoreInterruptPosition(5.3, 5), false);
  assert.equal(shouldRestoreInterruptPosition(12, 5), false); // por delante
  assert.equal(shouldRestoreInterruptPosition(2, 45), true); // rebobinado
  assert.equal(shouldRestoreInterruptPosition(0, 30), true);
});

test('isPlaybackZombie: playing sin avanzar tiempo', () => {
  assert.equal(isPlaybackZombie({
    userWantsPlay: true, paused: false, ended: false,
    prevTime: 5, currTime: 5.02, stuckTicks: 2, needTicks: 2,
  }), true);
  assert.equal(isPlaybackZombie({
    userWantsPlay: true, paused: false, ended: false,
    prevTime: 5, currTime: 6.5, stuckTicks: 2, needTicks: 2,
  }), false);
  assert.equal(isPlaybackZombie({
    userWantsPlay: true, paused: true, ended: false,
    prevTime: 5, currTime: 5, stuckTicks: 5, needTicks: 2,
  }), false); // pause real, no zombie
});

test('mediaSessionPlaybackState', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, systemInterrupted: false }), 'playing');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, systemInterrupted: true }), 'paused');
});

test('shouldConfirmMediaFocusLoss', () => {
  assert.equal(shouldConfirmMediaFocusLoss({ stillPaused: true, userWantsPlay: true, keepAliveAttempt: 2, maxAttempts: 5 }), false);
  assert.equal(shouldConfirmMediaFocusLoss({ stillPaused: true, userWantsPlay: true, keepAliveAttempt: 5, maxAttempts: 5 }), true);
});

test('shouldResumeOnForeground / canForceReacquire / isExternalPause', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    volume: 1, targetVolume: 1, systemPaused: false, timeStuck: false,
  }), true);
  assert.equal(canForceReacquire(false), false);
  assert.equal(isExternalPause({ selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false }), true);
});

test('shouldFadeIn / preloads / queue / visible', () => {
  assert.equal(shouldFadeIn(false), false);
  assert.equal(shouldSuspendPreloads(false), true);
  assert.equal(shouldPreExtendQueue(4, 5), true);
  assert.equal(isDocumentVisible({ visibilityState: 'hidden' }), false);
});
