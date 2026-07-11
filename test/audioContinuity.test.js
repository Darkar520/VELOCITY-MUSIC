import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playSyncStrategy,
  shouldYieldOnExternalPause,
  mediaSessionPlaybackState,
  shouldRestoreInterruptPosition,
  shouldResumeOnForeground,
  canForceReacquire,
  isExternalPause,
  hideRecoverDelays,
} from '../frontend/src/audioContinuity.js';

test('playSyncStrategy: NUNCA soft-play si no visible (A7 Chrome superposición)', () => {
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: false,
  }), 'noop', 'hidden + playing → no play() (no robar a Instagram)');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: true, visible: false,
  }), 'noop');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: true,
  }), 'soft-play');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: true, visible: true,
  }), 'soft-play', 'visible + cedimos → soft-play para reanudar');
  assert.equal(playSyncStrategy({
    playing: false, hasSrc: true, yieldedFocus: false, visible: true,
  }), 'pause');
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: false, yieldedFocus: false, visible: true,
  }), 'noop');
  // visible omitido / undefined → noop (fail-safe, no soft-play accidental)
  assert.equal(playSyncStrategy({
    playing: true, hasSrc: true, yieldedFocus: false, visible: undefined,
  }), 'noop');
});

test('shouldYieldOnExternalPause: ceder YA en background, no selfPause', () => {
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), true);
  assert.equal(shouldYieldOnExternalPause({
    hidden: false, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false, 'foreground no cede al primer pause (ducking)');
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: true, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false);
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: true, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: true,
  }), false);
  assert.equal(shouldYieldOnExternalPause({
    hidden: true, userWantsPlay: false, selfPause: false, pendingFade: false,
    audioEnded: false, alreadyYielded: false,
  }), false);
});

test('hideRecoverDelays vacío: cero soft-play tras hide (anti A7)', () => {
  assert.deepEqual(hideRecoverDelays(), []);
});

test('mediaSessionPlaybackState: paused al ceder aunque userWantsPlay', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: true }), 'paused');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, yieldedFocus: false }), 'playing');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: false, yieldedFocus: false }), 'paused');
});

test('shouldRestoreInterruptPosition no clava el mismo segundo', () => {
  assert.equal(shouldRestoreInterruptPosition(5, 5), false);
  assert.equal(shouldRestoreInterruptPosition(1, 40), true);
  assert.equal(shouldRestoreInterruptPosition(39.5, 40), false);
});

test('shouldResumeOnForeground: solo si hace falta (no play() gratis)', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    systemPaused: true, timeStuck: false, volume: 1, targetVolume: 1,
  }), true);
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: false,
    systemPaused: false, timeStuck: false, volume: 1, targetVolume: 1,
  }), false, 'ya sonando y no yielded → no forzar play');
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: false, audioEnded: false, audioPaused: true,
    systemPaused: false, timeStuck: false, volume: 1, targetVolume: 1,
  }), false);
  assert.equal(canForceReacquire(false), false);
  assert.equal(canForceReacquire(true), true);
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
  assert.equal(isExternalPause({
    selfPause: true, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), false);
});
