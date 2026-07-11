/**
 * Anti-regresión: continuidad de audio multi-navegador (móvil).
 * Si estos tests fallan, NO mergear: se reintrodujo un bug de background.
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
} from '../frontend/src/audioContinuity.js';

// ── Bug histórico: forceReacquire en background al cambiar de pista (Chrome) ──
test('playSyncStrategy: background + playing sin interrupción → soft-play', () => {
  assert.equal(
    playSyncStrategy({ playing: true, visible: false, audioPaused: true, hasSrc: true, systemInterrupted: false }),
    'soft-play'
  );
});

test('playSyncStrategy: background + interrupción por vídeo → noop (no pelear con YT)', () => {
  assert.equal(
    playSyncStrategy({ playing: true, visible: false, audioPaused: true, hasSrc: true, systemInterrupted: true }),
    'noop'
  );
});

test('playSyncStrategy: visible + interrupción → soft-play (reanudar al volver)', () => {
  assert.equal(
    playSyncStrategy({ playing: true, visible: true, audioPaused: true, hasSrc: true, systemInterrupted: true }),
    'soft-play'
  );
});

test('playSyncStrategy: not playing → pause', () => {
  assert.equal(
    playSyncStrategy({ playing: false, visible: true, audioPaused: false, hasSrc: true }),
    'pause'
  );
});

test('playSyncStrategy: sin src → noop', () => {
  assert.equal(
    playSyncStrategy({ playing: true, visible: true, audioPaused: true, hasSrc: false }),
    'noop'
  );
});

// ── Notificación: durante vídeo debe verse PAUSADO ──
test('mediaSessionPlaybackState: interrupción → paused aunque userWantsPlay', () => {
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, systemInterrupted: true }), 'paused');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: true, systemInterrupted: false }), 'playing');
  assert.equal(mediaSessionPlaybackState({ userWantsPlay: false, systemInterrupted: false }), 'paused');
});

// ── Posición: restaurar si el browser rebobinó ──
test('shouldRestoreInterruptPosition cuando currentTime se desvió', () => {
  assert.equal(shouldRestoreInterruptPosition(10, 45), true);
  assert.equal(shouldRestoreInterruptPosition(45.2, 45), false);
  assert.equal(shouldRestoreInterruptPosition(0, 30), true);
  assert.equal(shouldRestoreInterruptPosition(12, null), false);
});

// ── Bug: tras vídeo queda silencio zombie; al volver hay que reanudar ──
test('shouldResumeOnForeground: systemPaused o paused → true', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: true,
    volume: 1, targetVolume: 1, systemPaused: false, timeStuck: false,
  }), true);
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: false,
    volume: 1, targetVolume: 1, systemPaused: true, timeStuck: false,
  }), true);
});

test('shouldResumeOnForeground: volume casi 0 (fade roto) → true', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: false, audioPaused: false,
    volume: 0, targetVolume: 0.8, systemPaused: false, timeStuck: false,
  }), true);
});

test('shouldResumeOnForeground: user paused o ended → false', () => {
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: false, audioEnded: false, audioPaused: true,
    volume: 0, targetVolume: 1, systemPaused: true, timeStuck: true,
  }), false);
  assert.equal(shouldResumeOnForeground({
    userWantsPlay: true, audioEnded: true, audioPaused: true,
    volume: 0, targetVolume: 1, systemPaused: true, timeStuck: true,
  }), false);
});

// ── forceReacquire solo foreground ──
test('canForceReacquire solo si visible', () => {
  assert.equal(canForceReacquire(true), true);
  assert.equal(canForceReacquire(false), false);
});

// ── Pause de YouTube no debe setPlaying(false) ──
test('isExternalPause: pause del OS con userWantsPlay', () => {
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), true);
  assert.equal(isExternalPause({
    selfPause: true, pendingFade: false, userWantsPlay: true, audioEnded: false,
  }), false);
  assert.equal(isExternalPause({
    selfPause: false, pendingFade: true, userWantsPlay: true, audioEnded: false,
  }), false);
});

// ── Fade en background = silencio eterno ──
test('shouldFadeIn solo visible', () => {
  assert.equal(shouldFadeIn(true), true);
  assert.equal(shouldFadeIn(false), false);
});

test('shouldSuspendPreloads cuando hidden', () => {
  assert.equal(shouldSuspendPreloads(false), true);
  assert.equal(shouldSuspendPreloads(true), false);
});

// ── Cola: pre-extender penúltima también ──
test('shouldPreExtendQueue en última y penúltima', () => {
  assert.equal(shouldPreExtendQueue(4, 5), true); // penúltima
  assert.equal(shouldPreExtendQueue(5, 6), true); // penúltima (0-based: index 5 of 6)
  assert.equal(shouldPreExtendQueue(5, 5), false); // out of range
  assert.equal(shouldPreExtendQueue(4, 6), true); // penúltima index 4 of 6
  assert.equal(shouldPreExtendQueue(2, 6), false); // mitad
  assert.equal(shouldPreExtendQueue(0, 1), true); // única pista
});

test('isDocumentVisible con mock', () => {
  assert.equal(isDocumentVisible({ visibilityState: 'visible' }), true);
  assert.equal(isDocumentVisible({ visibilityState: 'hidden' }), false);
  assert.equal(isDocumentVisible(null), true);
});
