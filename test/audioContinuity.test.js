/**
 * Anti-regresión: continuidad de audio multi-navegador (móvil).
 */
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
  backgroundKeepAliveDelays,
} from '../frontend/src/audioContinuity.js';

// ── Background: SIEMPRE soft-play si el usuario quiere oír (Chrome/Brave/Safari) ──
test('playSyncStrategy: background + playing → soft-play (seguir al salir de la app)', () => {
  assert.equal(
    playSyncStrategy({ playing: true, hasSrc: true }),
    'soft-play'
  );
});

test('playSyncStrategy: not playing → pause', () => {
  assert.equal(playSyncStrategy({ playing: false, hasSrc: true }), 'pause');
});

test('playSyncStrategy: sin src → noop', () => {
  assert.equal(playSyncStrategy({ playing: true, hasSrc: false }), 'noop');
});

// ── Notificación: playing mientras keep-alive; paused solo si focus loss confirmado ──
test('mediaSessionPlaybackState: sin interrupción confirmada → playing', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, systemInterrupted: false }), 'playing');
});

test('mediaSessionPlaybackState: focus loss confirmado (vídeo) → paused', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, systemInterrupted: true }), 'paused');
});

test('shouldConfirmMediaFocusLoss: solo tras agotar keep-alive', () => {
  assert.equal(shouldConfirmMediaFocusLoss({
    stillPaused: true, userWantsPlay: true, keepAliveAttempt: 2, maxAttempts: 6,
  }), false);
  assert.equal(shouldConfirmMediaFocusLoss({
    stillPaused: true, userWantsPlay: true, keepAliveAttempt: 6, maxAttempts: 6,
  }), true);
  assert.equal(shouldConfirmMediaFocusLoss({
    stillPaused: false, userWantsPlay: true, keepAliveAttempt: 99, maxAttempts: 6,
  }), false);
});

test('backgroundKeepAliveDelays incluye intento inmediato (0)', () => {
  const d = backgroundKeepAliveDelays();
  assert.equal(d[0], 0);
  assert.ok(d.length >= 5);
});

test('shouldRestoreInterruptPosition cuando currentTime se desvió', () => {
  assert.equal(shouldRestoreInterruptPosition(10, 45), true);
  assert.equal(shouldRestoreInterruptPosition(45.2, 45), false);
  assert.equal(shouldRestoreInterruptPosition(0, 30), true);
});

test('shouldResumeOnForeground: systemPaused o paused → true', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    volume: 1, targetVolume: 1, systemPaused: false, timeStuck: false,
  }), true);
});

test('shouldResumeOnForeground: user paused → false', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: false, audioEnded: false, audioPaused: true,
    volume: 0, targetVolume: 1, systemPaused: true, timeStuck: true,
  }), false);
});

test('canForceReacquire solo si visible', () => {
  assert.equal(canForceReacquire(true), true);
  assert.equal(canForceReacquire(false), false);
});

test('isExternalPause: pause del OS con userWantsPlay', () => {
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
  assert.equal(isExternalPause({
    selfPause: true, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), false);
});

test('shouldFadeIn solo visible', () => {
  assert.equal(shouldFadeIn(true), true);
  assert.equal(shouldFadeIn(false), false);
});

test('shouldSuspendPreloads cuando hidden', () => {
  assert.equal(shouldSuspendPreloads(false), true);
  assert.equal(shouldSuspendPreloads(true), false);
});

test('shouldPreExtendQueue en última y penúltima', () => {
  assert.equal(shouldPreExtendQueue(4, 5), true);
  assert.equal(shouldPreExtendQueue(5, 6), true);
  assert.equal(shouldPreExtendQueue(5, 5), false);
  assert.equal(shouldPreExtendQueue(2, 6), false);
  assert.equal(shouldPreExtendQueue(0, 1), true);
});

test('isDocumentVisible con mock', () => {
  assert.equal(isDocumentVisible({ visibilityState: 'visible' }), true);
  assert.equal(isDocumentVisible({ visibilityState: 'hidden' }), false);
});
